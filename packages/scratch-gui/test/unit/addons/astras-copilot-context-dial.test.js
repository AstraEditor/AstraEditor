/**
 * @jest-environment node
 */
/* eslint-env jest */
import { JSDOM } from 'jsdom';
import {
  contextRatio,
  createContextDial,
  effortIndex,
  EFFORT_LEVELS,
  formatPercent,
  usageSegments
} from '../../../src/addons/addons/astras-copilot/ui/context-dial';

const messages = {
  'context-dial-title': 'Context usage',
  'context-dial-close': 'Close',
  'context-dial-used': 'used {used} / {total}',
  'context-dial-system': 'System prompt',
  'context-dial-tools': 'Tool definitions',
  'context-dial-messages': 'Conversation',
  'context-dial-effort': 'Reasoning effort',
  'context-dial-effort-value': 'Current thinking effort: {level}',
  'context-dial-effort-default': 'Default',
  'context-dial-effort-low': 'Low',
  'context-dial-effort-high': 'High',
  'context-dial-effort-max': 'Max',
  'context-dial-trigger': 'Context {percent} · thinking {level}',
  'context-usage-estimate': '≈ {tokens} tokens · {messages} messages',
  'context-usage-actual': 'last request {tokens} tokens · {messages} messages'
};

const msg = (key, vars = {}) => {
  const template = messages[key] === undefined ? key : messages[key];
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : vars[name]));
};

describe('context dial helpers', () => {
  test('contextRatio', () => {
    expect(contextRatio(17800, 100000)).toBeCloseTo(0.178, 5);
    expect(contextRatio(0, 100000)).toBe(0);
    expect(contextRatio(200000, 100000)).toBe(1);
    expect(contextRatio(10, 0)).toBe(0);
    expect(contextRatio(NaN, 100)).toBe(0);
    expect(contextRatio(10, NaN)).toBe(0);
  });

  test('usageSegments splits by total and by sum', () => {
    const bySum = usageSegments({ system: 10, tools: 20, messages: 70 });
    expect(bySum.map((segment) => segment.key)).toEqual(['system', 'tools', 'messages']);
    expect(bySum[0].ratio).toBeCloseTo(0.1, 5);
    expect(bySum[2].ratio).toBeCloseTo(0.7, 5);

    const byTotal = usageSegments({ system: 10, tools: 10, messages: 10 }, 120);
    expect(byTotal[0].ratio).toBeCloseTo(10 / 120, 5);
  });

  test('usageSegments tolerates empty input', () => {
    const segments = usageSegments({}, 0);
    expect(segments.every((segment) => segment.ratio === 0)).toBe(true);
    expect(usageSegments(null).map((segment) => segment.tokens)).toEqual([0, 0, 0]);
  });

  test('formatPercent', () => {
    expect(formatPercent(0.178)).toBe('17.8%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(1.4)).toBe('100.0%');
    expect(formatPercent(0.0001)).toBe('<0.1%');
  });

  test('effortIndex', () => {
    expect(EFFORT_LEVELS).toEqual(['default', 'low', 'high', 'max']);
    expect(effortIndex('high')).toBe(2);
    expect(effortIndex('MAX')).toBe(3);
    expect(effortIndex('nonsense')).toBe(0);
    expect(effortIndex(undefined)).toBe(0);
  });
});

describe('context dial component', () => {
  let dial;
  let dom;
  let changes;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    changes = [];
    dial = createContextDial({
      msg,
      formatTokens: (value) => `${Math.round(Number(value) / 1000)}k`,
      getEffort: () => 'low',
      onEffortChange: (level) => changes.push(level)
    });
    document.body.appendChild(dial.element);
  });

  afterEach(() => {
    dial.element.remove();
    delete global.window;
    delete global.document;
  });

  test('update paints percent, ring and legend', () => {
    dial.update({
      tokens: 17800,
      contextWindow: 100000,
      system: 1500,
      tools: 5100,
      messages: 10600,
      messageCount: 12,
      actual: false
    });

    // Ring-only trigger: no text, but the numbers stay available.
    const triggerNode = dial.element.querySelector('.sa-agent-dial-trigger');
    expect(triggerNode.textContent).toBe('');
    expect(triggerNode.title).toContain('17.8%');
    expect(triggerNode.getAttribute('aria-label')).toContain('17.8%');

    const percent = dial.element.querySelector('.sa-agent-dial-summary-percent');
    expect(percent.textContent).toBe('17.8%');

    const ring = dial.element.querySelector('.sa-agent-dial-value');
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(100 - 17.8, 1);
    expect(ring.parentNode.getAttribute('class')).toContain('sa-agent-dial-is-ok');

    const values = [...dial.element.querySelectorAll('.sa-agent-dial-legend-value')].map((node) => node.textContent);
    expect(values).toEqual(['8.4%', '28.7%', '59.6%']);

    expect(dial.element.querySelector('.sa-agent-dial-source').textContent).toBe('≈ 18k tokens · 12 messages');
  });

  test('mid-drag values move the fill without snapping the thumb', () => {
    const slider = dial.element.querySelector('.sa-agent-dial-slider');
    const trackNode = dial.element.querySelector('.sa-agent-dial-slider-track');
    changes.length = 0;

    slider.value = '1.4';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(slider.value).toBe('1.4');
    expect(Number(trackNode.style.getPropertyValue('--sa-agent-slider-value'))).toBeCloseTo(1.4 / 3, 5);
    expect(dial.getEffort()).toBe('low');
    expect(changes).toEqual([]);

    slider.value = '2.2';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(Number(trackNode.style.getPropertyValue('--sa-agent-slider-value'))).toBeCloseTo(2.2 / 3, 5);
    expect(dial.getEffort()).toBe('high');
    expect(changes).toEqual(['high']);

    // Sliding within the same level must not save the config again.
    slider.value = '2.4';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(changes).toEqual(['high']);
  });

  test('track colour escalates with effort', () => {
    const slider = dial.element.querySelector('.sa-agent-dial-slider');
    const effortBlock = dial.element.querySelector('.sa-agent-dial-effort-block');
    const seen = [];
    for (const [index, level] of ['default', 'low', 'high', 'max'].entries()) {
      slider.value = String(index);
      slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      seen.push([slider.dataset.effort, effortBlock.style.getPropertyValue('--sa-agent-slider-color')]);
      expect(slider.dataset.effort).toBe(level);
    }
    expect(seen.map((entry) => entry[1])).toEqual(['#adb5bd', '#4dabf7', '#12b886', '#845ef7']);
  });

  test('ring switches to warn and danger states', () => {
    const ring = dial.element.querySelector('.sa-agent-dial-value').parentNode;
    dial.update({ tokens: 70, contextWindow: 100, system: 70, tools: 0, messages: 0 });
    expect(ring.getAttribute('class')).toContain('sa-agent-dial-is-warn');
    dial.update({ tokens: 95, contextWindow: 100, system: 95, tools: 0, messages: 0 });
    expect(ring.getAttribute('class')).toContain('sa-agent-dial-is-danger');
  });

  test('slider reports effort changes and updates the label', () => {
    const slider = dial.element.querySelector('.sa-agent-dial-slider');
    const effortTitle = dial.element.querySelector('.sa-agent-dial-effort-title');
    expect(slider.value).toBe('1');
    expect(slider.dataset.effort).toBe('low');
    expect(effortTitle.textContent).toBe('Current thinking effort: Low');

    slider.value = '3';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(changes).toEqual(['max']);
    expect(effortTitle.textContent).toBe('Current thinking effort: Max');
    expect(dial.getEffort()).toBe('max');
    expect(dial.element.querySelector('.sa-agent-dial-trigger').title).toContain('Max');

    // The track colour and the highlighted tick follow the level.
    expect(slider.dataset.effort).toBe('max');
    const trackNode = dial.element.querySelector('.sa-agent-dial-slider-track');
    expect(trackNode.style.getPropertyValue('--sa-agent-slider-value')).toBe('1');
    const effortBlock = dial.element.querySelector('.sa-agent-dial-effort-block');
    expect(effortBlock.style.getPropertyValue('--sa-agent-slider-color')).toBe('#845ef7');
    const active = dial.element.querySelectorAll('.sa-agent-dial-tick-active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe('Max');
  });

  test('trigger toggles the popover and outside clicks close it', () => {
    const trigger = dial.element.querySelector('.sa-agent-dial-trigger');
    const popover = dial.element.querySelector('.sa-agent-dial-popover');
    expect(popover.hidden).toBe(true);

    trigger.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    expect(popover.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(popover.style.left).toMatch(/px$/);

    dial.closeIfOutside(dial.element.querySelector('.sa-agent-dial-trigger'));
    expect(popover.hidden).toBe(false);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    dial.closeIfOutside(outside);
    expect(popover.hidden).toBe(true);
  });

  test('Escape closes the popover', () => {
    const popover = dial.element.querySelector('.sa-agent-dial-popover');
    dial.open();
    expect(popover.hidden).toBe(false);
    popover.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover.hidden).toBe(true);
  });
});
