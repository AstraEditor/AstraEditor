/**
 * Context dial: a small ring under the composer that shows how much of the
 * model's context window is in use. Clicking it opens a popover with the usage
 * breakdown and the reasoning-effort slider.
 *
 * The ring only needs an SVG circumference trick: `pathLength="100"` makes
 * `stroke-dashoffset` a percentage, so no trigonometry is involved.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Reasoning effort levels, in ascending strength. */
export const EFFORT_LEVELS = ['default', 'low', 'high', 'max'];

/** Track colour per effort level: muted when off, vivid at max. */
export const EFFORT_COLORS = {
  default: '#adb5bd',
  low: '#4dabf7',
  high: '#12b886',
  max: '#845ef7'
};

/** Above this ratio the ring turns amber, above the second one it turns red. */
const WARN_RATIO = 0.6;
const DANGER_RATIO = 0.85;

/**
 * Share of the context window in use.
 * @param {number} tokens Used tokens.
 * @param {number} windowSize Context window size.
 * @returns {number} Ratio between 0 and 1.
 */
export const contextRatio = (tokens, windowSize) => {
  const total = Number(windowSize);
  const used = Number(tokens);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(used) || used <= 0) return 0;
  return Math.min(1, used / total);
};

/**
 * Split a usage estimate into displayable segments.
 * @param {object} usage Usage parts.
 * @param {number} usage.system System prompt tokens.
 * @param {number} usage.tools Tool schema tokens.
 * @param {number} usage.messages Conversation tokens.
 * @param {number} [total] Total to divide by (defaults to the sum of parts).
 * @returns {Array<{key: string, tokens: number, ratio: number}>} Segments.
 */
export const usageSegments = (usage, total) => {
  const source = usage || {};
  const parts = [
    { key: 'system', tokens: Math.max(0, Number(source.system) || 0) },
    { key: 'tools', tokens: Math.max(0, Number(source.tools) || 0) },
    { key: 'messages', tokens: Math.max(0, Number(source.messages) || 0) }
  ];
  const sum = parts.reduce((acc, part) => acc + part.tokens, 0);
  const divisor = Number(total) > 0 ? Number(total) : sum;
  return parts.map((part) => ({
    ...part,
    ratio: divisor > 0 ? Math.min(1, part.tokens / divisor) : 0
  }));
};

/**
 * Format a ratio as a percentage string.
 * @param {number} ratio Ratio between 0 and 1.
 * @returns {string} Percentage, for example "17.8%".
 */
export const formatPercent = (ratio) => {
  const percent = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  if (percent > 0 && percent < 0.1) return '<0.1%';
  return `${percent.toFixed(1)}%`;
};

/**
 * Index of a reasoning-effort level.
 * @param {string} level Effort level.
 * @returns {number} Index, 0 when unknown.
 */
export const effortIndex = (level) => {
  const index = EFFORT_LEVELS.indexOf(String(level || '').toLowerCase());
  return index < 0 ? 0 : index;
};

/**
 * Create the context dial and its popover.
 * @param {object} options Options.
 * @param {Function} options.msg Localization function.
 * @param {Function} options.formatTokens Token count formatter.
 * @param {Function} options.onEffortChange Called with the new effort level.
 * @param {Function} [options.getEffort] Current effort level resolver.
 * @returns {object} Dial controller.
 */
export const createContextDial = ({ msg, formatTokens, onEffortChange, getEffort }) => {
  const format = typeof formatTokens === 'function' ? formatTokens : (value) => String(value);
  let effort = typeof getEffort === 'function' ? getEffort() : 'default';
  /** Last level reported to the caller, so a drag only notifies on changes. */
  let lastNotified = effort;
  let lastState = { tokens: 0, contextWindow: 0, system: 0, tools: 0, messages: 0 };

  const root = document.createElement('div');
  root.className = 'sa-agent-context-dial';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sa-agent-dial-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'sa-agent-dial-ring');
  svg.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'sa-agent-dial-track');
  track.setAttribute('cx', '12');
  track.setAttribute('cy', '12');
  track.setAttribute('r', '9');
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke-width', '3');

  const value = document.createElementNS(SVG_NS, 'circle');
  value.setAttribute('class', 'sa-agent-dial-value');
  value.setAttribute('cx', '12');
  value.setAttribute('cy', '12');
  value.setAttribute('r', '9');
  value.setAttribute('fill', 'none');
  value.setAttribute('stroke-width', '3');
  value.setAttribute('pathLength', '100');
  value.setAttribute('stroke-dasharray', '100');
  value.setAttribute('stroke-dashoffset', '100');

  svg.appendChild(track);
  svg.appendChild(value);

  // The trigger is ring-only so it can sit next to the send button; the exact
  // numbers live in the tooltip, the aria-label and the popover.
  trigger.appendChild(svg);
  root.appendChild(trigger);

  const popover = document.createElement('div');
  popover.className = 'sa-agent-dial-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.hidden = true;

  const popoverHeader = document.createElement('div');
  popoverHeader.className = 'sa-agent-dial-popover-header';
  const popoverTitle = document.createElement('span');
  popoverTitle.className = 'sa-agent-dial-popover-title';
  popoverTitle.textContent = msg('context-dial-title');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'sa-agent-dial-close';
  closeButton.textContent = '×';
  closeButton.title = msg('context-dial-close');
  closeButton.setAttribute('aria-label', msg('context-dial-close'));
  popoverHeader.appendChild(popoverTitle);
  popoverHeader.appendChild(closeButton);
  popover.appendChild(popoverHeader);

  const summaryRow = document.createElement('div');
  summaryRow.className = 'sa-agent-dial-summary';
  const summaryPercent = document.createElement('strong');
  summaryPercent.className = 'sa-agent-dial-summary-percent';
  summaryPercent.textContent = '0%';
  const summaryUsed = document.createElement('span');
  summaryUsed.className = 'sa-agent-dial-summary-used';
  summaryRow.appendChild(summaryPercent);
  summaryRow.appendChild(summaryUsed);
  popover.appendChild(summaryRow);

  const sourceNote = document.createElement('div');
  sourceNote.className = 'sa-agent-dial-source';
  popover.appendChild(sourceNote);

  const bar = document.createElement('div');
  bar.className = 'sa-agent-dial-bar';
  const barSegments = {
    system: document.createElement('span'),
    tools: document.createElement('span'),
    messages: document.createElement('span')
  };
  for (const [key, segment] of Object.entries(barSegments)) {
    segment.className = `sa-agent-dial-bar-segment sa-agent-dial-bar-${key}`;
    segment.style.flexGrow = '0';
    bar.appendChild(segment);
  }
  popover.appendChild(bar);

  const legend = document.createElement('div');
  legend.className = 'sa-agent-dial-legend';
  const legendValues = {};
  for (const key of ['system', 'tools', 'messages']) {
    const row = document.createElement('div');
    row.className = 'sa-agent-dial-legend-row';
    const dot = document.createElement('span');
    dot.className = `sa-agent-dial-legend-dot sa-agent-dial-bar-${key}`;
    const name = document.createElement('span');
    name.className = 'sa-agent-dial-legend-name';
    name.textContent = msg(`context-dial-${key}`);
    const amount = document.createElement('span');
    amount.className = 'sa-agent-dial-legend-value';
    amount.textContent = '0.0%';
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(amount);
    legend.appendChild(row);
    legendValues[key] = amount;
  }
  popover.appendChild(legend);

  const effortBlock = document.createElement('div');
  effortBlock.className = 'sa-agent-dial-effort-block';
  const effortTitle = document.createElement('div');
  effortTitle.className = 'sa-agent-dial-effort-title';
  effortBlock.appendChild(effortTitle);

  // The native range paints its own track and the thumb sits flush against the
  // ends, so the bar and its inset are drawn by a wrapper. The input stays on
  // top, transparent, and only provides the thumb and pointer handling.
  const sliderTrack = document.createElement('div');
  sliderTrack.className = 'sa-agent-dial-slider-track';

  const sliderFill = document.createElement('div');
  sliderFill.className = 'sa-agent-dial-slider-fill';
  sliderTrack.appendChild(sliderFill);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'sa-agent-dial-slider';
  slider.min = '0';
  slider.max = String(EFFORT_LEVELS.length - 1);
  // Continuous internally so the thumb follows the pointer; the level is the
  // rounded value, which keeps dragging smooth between the four stops.
  slider.step = '0.01';
  slider.value = String(effortIndex(effort));
  slider.setAttribute('aria-label', msg('context-dial-effort'));
  sliderTrack.appendChild(slider);
  effortBlock.appendChild(sliderTrack);

  const ticks = document.createElement('div');
  ticks.className = 'sa-agent-dial-ticks';
  const tickNodes = [];
  for (const level of EFFORT_LEVELS) {
    const tick = document.createElement('span');
    tick.className = 'sa-agent-dial-tick';
    tick.textContent = msg(`context-dial-effort-${level}`);
    ticks.appendChild(tick);
    tickNodes.push(tick);
  }
  effortBlock.appendChild(ticks);
  popover.appendChild(effortBlock);
  root.appendChild(popover);

  /**
   * Push the effort level into the trigger, slider and title.
   * @param {string} level Effort level.
   * @param {number} [fraction] Fill position 0..1, defaults to the stop itself.
   */
  const paintEffort = (level, fraction) => {
    const index = effortIndex(level);
    const current = EFFORT_LEVELS[index];
    const label = msg(`context-dial-effort-${current}`);
    effortTitle.textContent = msg('context-dial-effort-value', { level: label });
    // A continuous drag passes a fraction, which must not snap the thumb back.
    if (fraction === undefined && slider.value !== String(index)) slider.value = String(index);
    // The filled part of the track gets stronger as the effort grows; the
    // colour is inherited by the tick labels from the effort block.
    const position = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : index / (EFFORT_LEVELS.length - 1);
    sliderTrack.style.setProperty('--sa-agent-slider-value', String(position));
    slider.dataset.effort = current;
    effortBlock.style.setProperty('--sa-agent-slider-color', EFFORT_COLORS[current] || EFFORT_COLORS.default);
    tickNodes.forEach((node, tickIndex) => {
      node.classList.toggle('sa-agent-dial-tick-active', tickIndex === index);
    });
  };

  /**
   * Render a usage snapshot.
   * @param {object} state Usage state.
   */
  const update = (state) => {
    lastState = state || lastState;
    const ratio = contextRatio(lastState.tokens, lastState.contextWindow);
    const percentText = formatPercent(ratio);
    summaryPercent.textContent = percentText;
    value.setAttribute('stroke-dashoffset', String(100 - ratio * 100));

    const level = ratio >= DANGER_RATIO ? 'danger' : ratio >= WARN_RATIO ? 'warn' : 'ok';
    svg.classList.remove('sa-agent-dial-is-ok', 'sa-agent-dial-is-warn', 'sa-agent-dial-is-danger');
    svg.classList.add(`sa-agent-dial-is-${level}`);

    summaryUsed.textContent = msg('context-dial-used', {
      used: format(lastState.tokens),
      total: format(lastState.contextWindow)
    });
    sourceNote.textContent = msg(lastState.actual ? 'context-usage-actual' : 'context-usage-estimate', {
      tokens: format(lastState.tokens),
      messages: String(lastState.messageCount || 0)
    });

    const segments = usageSegments(lastState, lastState.tokens);
    for (const segment of segments) {
      const node = barSegments[segment.key];
      node.style.flexGrow = String(segment.ratio);
      node.style.display = segment.ratio > 0 ? '' : 'none';
      legendValues[segment.key].textContent = formatPercent(segment.ratio);
    }

    syncTriggerLabel();
  };

  /**
   * Keep the trigger tooltip in sync with the usage and the effort.
   */
  const syncTriggerLabel = () => {
    const tooltip = msg('context-dial-trigger', {
      percent: formatPercent(contextRatio(lastState.tokens, lastState.contextWindow)),
      level: msg(`context-dial-effort-${effort}`)
    });
    trigger.title = tooltip;
    trigger.setAttribute('aria-label', tooltip);
  };

  /**
   * Current effort level.
   * @returns {string} Level.
   */
  const getEffortLevel = () => effort;

  /**
   * Apply an effort level without notifying the caller.
   * @param {string} level Level.
   */
  const setEffort = (level) => {
    effort = EFFORT_LEVELS[effortIndex(level)];
    lastNotified = effort;
    paintEffort(effort);
    syncTriggerLabel();
  };

  /**
   * Place the popover next to the trigger, flipping above/below when needed.
   * Fixed positioning keeps it visible inside the bottom panel, whose content
   * box clips absolutely positioned children.
   */
  const reposition = () => {
    if (popover.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth || 264;
    const height = popover.offsetHeight || 240;
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width));
    let top = rect.top - height - margin;
    if (top < margin) top = Math.min(window.innerHeight - height - margin, rect.bottom + margin);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(Math.max(margin, top))}px`;
  };

  const open = () => {
    if (!popover.hidden) return;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('sa-agent-dial-open');
    reposition();
  };

  const close = () => {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.classList.remove('sa-agent-dial-open');
  };

  const toggle = () => {
    if (popover.hidden) open();
    else close();
  };

  /**
   * Close the popover when the pointer lands outside the dial.
   * @param {Node} node Event target.
   */
  const closeIfOutside = (node) => {
    if (!popover.hidden && node && !root.contains(node)) close();
  };

  trigger.addEventListener('click', toggle);
  closeButton.addEventListener('click', () => {
    close();
    trigger.focus();
  });
  slider.addEventListener('input', () => {
    const raw = Number(slider.value);
    const maxIndex = EFFORT_LEVELS.length - 1;
    const position = Number.isFinite(raw) ? raw : 0;
    const index = Math.max(0, Math.min(maxIndex, Math.round(position)));
    const level = EFFORT_LEVELS[index];
    effort = level;
    paintEffort(level, position / maxIndex);
    if (lastNotified !== level) {
      lastNotified = level;
      syncTriggerLabel();
      if (typeof onEffortChange === 'function') onEffortChange(level);
    }
  });
  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
    }
  });

  paintEffort(effort);
  update(lastState);

  return {
    element: root,
    update,
    setEffort,
    getEffort: getEffortLevel,
    open,
    close,
    reposition,
    closeIfOutside,
    isOpen: () => !popover.hidden
  };
};
