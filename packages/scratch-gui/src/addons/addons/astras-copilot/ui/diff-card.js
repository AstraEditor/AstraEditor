/**
 * Diff card rendering: the text/blocks toggle, the ScratchBlocks preview and the
 * in-chat diff cards. Extracted from the addon entry point so the userscript
 * only wires state together.
 */

export const DIFF_VIEW_TEXT = 'text';
export const DIFF_VIEW_BLOCKS = 'blocks';

/**
 * Create the diff-card renderer.
 * @param {object} options Options.
 * @param {Function} options.msg Localization function.
 * @param {object} options.vm Scratch VM.
 * @param {Function} options.ensureBlockly Resolves the scratch-blocks namespace.
 * @param {Function} options.getDiffViewMode Returns the preferred view mode.
 * @param {Function} options.setDiffViewMode Remembers the preferred view mode.
 * @param {object} options.icons Icons `{text, blocks}`.
 * @param {Function} options.renderBlockPreview Renders Scrathon to SVG.
 * @returns {object} Renderer.
 */
export const createDiffCardRenderer = ({
  msg,
  vm,
  ensureBlockly,
  getDiffViewMode,
  setDiffViewMode,
  icons,
  renderBlockPreview
}) => {
  /**
   * Build the Scrathon/Blocks segmented control.
   * @returns {{element: HTMLElement, update: Function, onSelect: (Function|null)}} Toggle control.
   */
  const buildDiffViewToggle = () => {
    const group = document.createElement('div');
    group.className = 'sa-agent-diff-view-toggle';
    group.setAttribute('role', 'group');
    const buttons = new Map();
    const options = [
      [DIFF_VIEW_TEXT, msg('diff-view-text'), icons.text],
      [DIFF_VIEW_BLOCKS, msg('diff-view-blocks'), icons.blocks]
    ];
    const control = {
      element: group,
      onSelect: null,
      update: (mode) => {
        for (const [key, button] of buttons) {
          const active = key === mode;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
      }
    };
    for (const [mode, label, iconSource] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-agent-diff-view-button';
      button.title = label;
      button.setAttribute('aria-label', label);
      const image = document.createElement('img');
      image.className = 'sa-agent-icon sa-agent-diff-view-icon';
      image.src = typeof iconSource === 'function' ? iconSource() : iconSource;
      image.draggable = false;
      image.alt = '';
      button.appendChild(image);
      button.addEventListener('click', () => {
        if (typeof control.onSelect === 'function') control.onSelect(mode);
      });
      buttons.set(mode, button);
      group.appendChild(button);
    }
    control.update(getDiffViewMode());
    return control;
  };

  /**
   * Render a script as ScratchBlocks SVG.
   * @param {HTMLElement} container Target container.
   * @param {Array<object>} pairs Script pairs `{label, code, kind}`.
   */
  const renderScratchBlocksView = async (container, pairs) => {
    container.textContent = '';
    const grid = document.createElement('div');
    grid.className = 'sa-agent-blocks-grid';
    container.appendChild(grid);
    let blockly;
    try {
      blockly = await ensureBlockly();
    } catch (error) {
      const note = document.createElement('div');
      note.className = 'sa-agent-blocks-error';
      note.textContent = msg('blocks-preview-error', {
        message: error && error.message ? error.message : String(error)
      });
      grid.appendChild(note);
      return;
    }
    for (const pair of pairs) {
      if (!pair || typeof pair.code !== 'string' || !pair.code.trim()) continue;
      const section = document.createElement('div');
      section.className = 'sa-agent-blocks-section';
      if (pair.kind) section.classList.add(`is-${pair.kind}`);
      const label = document.createElement('div');
      label.className = 'sa-agent-blocks-label';
      label.textContent = pair.label || '';
      section.appendChild(label);
      try {
        const svg = await renderBlockPreview({
          blockly,
          vm,
          targetName: pair.target,
          code: pair.code
        });
        if (!svg) throw new Error('The preview returned no SVG.');
        section.appendChild(svg);
      } catch (error) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[Astra Copilot] Failed to render block preview:', pair.label, error);
        }
        const reason = error && error.message ? error.message : String(error);
        const note = document.createElement('div');
        note.className = 'sa-agent-blocks-error';
        note.textContent = msg('blocks-preview-error', { message: reason });
        note.title = reason;
        const code = document.createElement('pre');
        code.className = 'sa-agent-blocks-fallback';
        code.textContent = pair.code;
        section.appendChild(note);
        section.appendChild(code);
      }
      grid.appendChild(section);
    }
    if (grid.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-blocks-empty';
      empty.textContent = msg('blocks-preview-empty');
      grid.appendChild(empty);
    }
  };

  /**
   * Attach a text/blocks view switch to a diff card.
   * @param {object} options Options.
   * @param {HTMLElement} options.textView Text view container.
   * @param {HTMLElement} options.blocksView Blocks view container.
   * @param {Array<object>} options.pairs Script pairs.
   * @param {object} options.toggle Toggle control.
   */
  const attachDiffView = ({ textView, blocksView, pairs, toggle }) => {
    let rendered = false;
    let rendering = false;
    const renderBlocks = async () => {
      if (rendered || rendering) return;
      rendering = true;
      try {
        await renderScratchBlocksView(blocksView, pairs);
        // eslint-disable-next-line require-atomic-updates
        rendered = true;
      } finally {
        // eslint-disable-next-line require-atomic-updates
        rendering = false;
      }
    };
    const apply = (mode) => {
      const showBlocks = mode === DIFF_VIEW_BLOCKS;
      textView.style.display = showBlocks ? 'none' : '';
      blocksView.style.display = showBlocks ? 'block' : 'none';
      toggle.update(mode);
      if (showBlocks) renderBlocks().catch(() => {});
    };
    toggle.onSelect = (mode) => {
      setDiffViewMode(mode);
      apply(mode);
    };
    apply(getDiffViewMode());
  };

  /**
   * Build an in-chat visual code diff card.
   * @param {object} diff Diff data produced by computeToolDiff/computeScopeDiff.
   * @returns {HTMLElement} Diff card element.
   */
  const buildDiffCard = (diff) => {
    const card = document.createElement('div');
    card.className = 'sa-agent-diff-card';

    if (!diff || !diff.hasChanges || !Array.isArray(diff.scripts) || diff.scripts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-diff-empty';
      empty.textContent = msg('diff-no-changes');
      card.appendChild(empty);
      return card;
    }

    const header = document.createElement('div');
    header.className = 'sa-agent-diff-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'sa-agent-diff-title';
    if (diff.target) {
      const targetBadge = document.createElement('span');
      targetBadge.className = 'sa-agent-diff-target-badge';
      targetBadge.textContent = diff.target;
      titleGroup.appendChild(targetBadge);
    }
    const headerText = document.createElement('span');
    headerText.className = 'sa-agent-diff-header-text';
    headerText.textContent = msg('diff-title');
    titleGroup.appendChild(headerText);

    const stats = document.createElement('div');
    stats.className = 'sa-agent-diff-stats';
    if (diff.totalAdd > 0) {
      const statAdd = document.createElement('span');
      statAdd.className = 'sa-agent-diff-stat-add';
      statAdd.textContent = `+${diff.totalAdd}`;
      stats.appendChild(statAdd);
    }
    if (diff.totalDel > 0) {
      const statDel = document.createElement('span');
      statDel.className = 'sa-agent-diff-stat-del';
      statDel.textContent = `-${diff.totalDel}`;
      stats.appendChild(statDel);
    }

    const toggle = buildDiffViewToggle();
    header.appendChild(titleGroup);
    header.appendChild(stats);
    header.appendChild(toggle.element);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'sa-agent-diff-body';

    for (const script of diff.scripts) {
      const scriptSection = document.createElement('div');
      scriptSection.className = 'sa-agent-diff-script';

      const scriptHeader = document.createElement('div');
      scriptHeader.className = 'sa-agent-diff-script-header';

      const scriptTitle = document.createElement('span');
      scriptTitle.className = 'sa-agent-diff-script-title';
      scriptTitle.textContent = script.title || 'Script';

      const badge = document.createElement('span');
      badge.className = `sa-agent-diff-script-badge ${
        script.isNew ? 'is-new' : script.isDelete ? 'is-delete' : 'is-modified'
      }`;
      badge.textContent = script.isNew
        ? msg('diff-badge-new')
        : script.isDelete
          ? msg('diff-badge-del')
          : msg('diff-badge-mod');

      scriptHeader.appendChild(scriptTitle);
      scriptHeader.appendChild(badge);
      scriptSection.appendChild(scriptHeader);

      const linesContainer = document.createElement('div');
      linesContainer.className = 'sa-agent-diff-lines';

      const renderLine = (entry) => {
        const lineRow = document.createElement('div');
        lineRow.className = `sa-agent-diff-line sa-agent-diff-line-${entry.type}`;

        const oldNo = document.createElement('span');
        oldNo.className = 'sa-agent-diff-lineno sa-agent-diff-lineno-old';
        oldNo.textContent = entry.oldLineNo !== null ? String(entry.oldLineNo) : '';

        const newNo = document.createElement('span');
        newNo.className = 'sa-agent-diff-lineno sa-agent-diff-lineno-new';
        newNo.textContent = entry.newLineNo !== null ? String(entry.newLineNo) : '';

        const prefix = document.createElement('span');
        prefix.className = 'sa-agent-diff-prefix';
        prefix.textContent = entry.type === 'add' ? '+' : entry.type === 'del' ? '-' : ' ';

        const text = document.createElement('span');
        text.className = 'sa-agent-diff-text';
        text.textContent = entry.line;

        lineRow.appendChild(oldNo);
        lineRow.appendChild(newNo);
        lineRow.appendChild(prefix);
        lineRow.appendChild(text);
        return lineRow;
      };

      const hunks = Array.isArray(script.hunks) && script.hunks.length > 0 ? script.hunks : null;
      if (hunks) {
        for (const hunk of hunks) {
          const hunkHeader = document.createElement('div');
          hunkHeader.className = 'sa-agent-diff-hunk-header';
          hunkHeader.textContent = hunk.header;
          linesContainer.appendChild(hunkHeader);

          for (const lineEntry of hunk.lines) {
            linesContainer.appendChild(renderLine(lineEntry));
          }
        }
      } else if (Array.isArray(script.diff)) {
        for (const lineEntry of script.diff) {
          linesContainer.appendChild(renderLine(lineEntry));
        }
      }

      scriptSection.appendChild(linesContainer);
      body.appendChild(scriptSection);
    }

    card.appendChild(body);

    const blocksView = document.createElement('div');
    blocksView.className = 'sa-agent-blocks-view';
    card.appendChild(blocksView);

    const pairs = [];
    for (const script of diff.scripts) {
      const title = script.title || 'Script';
      if (script.oldCode && script.oldCode.trim()) {
        pairs.push({
          label: `${title} · ${msg('diff-before')}`,
          code: script.oldCode,
          kind: 'before',
          target: diff.target
        });
      }
      if (script.newCode && script.newCode.trim()) {
        pairs.push({
          label: `${title} · ${msg('diff-after')}`,
          code: script.newCode,
          kind: 'after',
          target: diff.target
        });
      }
    }
    attachDiffView({ textView: body, blocksView, pairs, toggle });
    return card;
  };

  return { buildDiffCard, buildDiffViewToggle, attachDiffView };
};
