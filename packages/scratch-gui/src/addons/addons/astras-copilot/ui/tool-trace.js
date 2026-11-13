/**
 * Tool activity rendering: the collapsible tool stack, the approval controls and
 * the standalone EDIT card used for code writes.
 */

import { buildSideBySideRows } from '../agent/scrathon/diff.js';

/**
 * Create the tool-trace renderer.
 * @param {object} options Options.
 * @param {Function} options.msg Localization function.
 * @param {object} options.vm Scratch VM.
 * @param {Function} options.getBlockLabel Block label resolver.
 * @param {Function} options.getToolLabel Localized tool name resolver.
 * @param {Set<string>} options.writeToolSet Tools that modify the project.
 * @param {Function} options.buildDiffCard Diff card builder.
 * @param {Function} options.buildDiffViewToggle Diff view toggle builder.
 * @param {Function} options.attachDiffView Text/blocks switcher.
 * @param {Function} options.resolveToolApproval Approval resolver.
 * @param {Function} options.setAutoApproveTools Auto-approve setter.
 * @param {Function} options.rememberDisclosure Disclosure state keeper.
 * @returns {object} Renderer.
 */
export const createTraceRenderer = ({
  msg,
  vm,
  getBlockLabel,
  getToolLabel,
  writeToolSet,
  buildDiffCard,
  buildDiffViewToggle,
  attachDiffView,
  resolveToolApproval,
  setAutoApproveTools,
  rememberDisclosure
}) => {
  /**
   * Format a structured tool-result descriptor.
   * @param {object} summary Descriptor.
   * @returns {string} Localized text.
   */
  const formatTraceSummary = (summary) => {
    switch (summary && summary.kind) {
      case 'project-summary':
        return msg('trace-project-summary', { sprites: summary.sprites });
      case 'target-list':
        return msg('trace-target-list', { count: summary.count });
      case 'target':
        return msg('trace-target', { name: summary.name, scripts: summary.scripts, blocks: summary.blocks });
      case 'script-list':
        return msg('trace-script-list', { name: summary.name, count: summary.count });
      case 'script':
        return msg('trace-script', { name: summary.name, script: summary.script, blocks: summary.blocks });
      case 'search':
        return msg('trace-search', { query: summary.query, count: summary.count });
      case 'extension':
        return msg('trace-extension', {
          name: summary.name,
          blocks: summary.blocks,
          source: msg(summary.hasSource ? 'trace-extension-source-yes' : 'trace-extension-source-no')
        });
      case 'runtime':
        return msg('trace-runtime', {
          state: msg(summary.running ? 'trace-running' : 'trace-stopped'),
          threads: summary.threads
        });
      case 'project-scrathon':
        return msg('trace-project-scrathon', { targets: summary.targets, scripts: summary.scripts });
      case 'apply-scrathon-edits':
        return msg('trace-apply-scrathon-edits', { name: summary.name, count: summary.replaced });
      case 'apply-scripts':
        return msg('trace-apply-scripts', { name: summary.name, scripts: summary.scripts });
      case 'delete-scripts':
        return msg('trace-delete-scripts', { name: summary.name, count: summary.count });
      case 'create-variable':
        return msg(summary.created ? 'trace-create-variable' : 'trace-create-variable-exists', {
          name: summary.name
        });
      case 'rename-target':
        return msg('trace-rename-target', { before: summary.before, after: summary.after });
      case 'block-catalog':
        return msg('trace-block-catalog', { count: summary.count });
      case 'denied':
        return msg('trace-denied-summary');
      case 'error':
        return msg('trace-error', { message: String(summary.message || '').slice(0, 200) });
      default:
        return '';
    }
  };

  /**
   * Resolve a target argument for display without exposing raw IDs.
   * @param {string} value Target name or ID.
   * @returns {string} Display name.
   */
  const describeTraceTarget = (value) => {
    if (!value || typeof value !== 'string') return '';
    const runtime = vm && vm.runtime;
    if (runtime && typeof runtime.getTargetById === 'function') {
      const found = runtime.getTargetById(value);
      if (found) return typeof found.getName === 'function' ? found.getName() : found.name || value;
    }
    if (runtime && Array.isArray(runtime.targets)) {
      const lower = value.toLowerCase();
      const found = runtime.targets.find(
        (target) => typeof target.getName === 'function' && target.getName().toLowerCase() === lower
      );
      if (found) return found.getName();
    }
    return /^[A-Za-z0-9]{12,}$/.test(value) ? '?' : value;
  };

  /**
   * Resolve a script root argument for display without exposing raw IDs.
   * @param {string} value Script root or block ID.
   * @returns {string} Human-readable script label.
   */
  const describeTraceScript = (value) => {
    if (!value || typeof value !== 'string') return '';
    const runtime = vm && vm.runtime;
    const targets = runtime && Array.isArray(runtime.targets) ? runtime.targets : [];
    for (const target of targets) {
      const blocks = target && target.blocks && target.blocks._blocks ? target.blocks._blocks : null;
      const block = blocks ? blocks[value] : null;
      if (block) {
        let rootId = value;
        if (target.blocks && typeof target.blocks.getTopLevelScript === 'function') {
          const topLevel = target.blocks.getTopLevelScript(value);
          if (topLevel) rootId = topLevel;
        }
        const rootBlock = (blocks && blocks[rootId]) || block;
        try {
          return getBlockLabel(vm, rootBlock.opcode, rootBlock.mutation);
        } catch (error) {
          return '';
        }
      }
    }
    return '';
  };

  /**
   * Format the status label for a tool row.
   * @param {string} status Trace status.
   * @returns {string} Localized status.
   */
  const formatTraceStatus = (status) => {
    switch (status) {
      case 'awaiting':
        return msg('trace-status-awaiting');
      case 'pending':
        return msg('trace-status-pending');
      case 'error':
        return msg('trace-status-error');
      case 'denied':
        return msg('trace-status-denied');
      default:
        return msg('trace-status-ok');
    }
  };

  /**
   * Format tool arguments without exposing internal IDs.
   * @param {object} entry Trace entry.
   * @returns {string} Human-readable arguments.
   */
  const formatTraceArgs = (entry) => {
    const args = entry && entry.args ? entry.args : {};
    const parts = [];
    if (args.target) {
      parts.push(msg('trace-args-target', { name: describeTraceTarget(String(args.target)) }));
    }
    if (args.query) {
      parts.push(msg('trace-args-query', { query: String(args.query).slice(0, 120) }));
    }
    if (args.extensionId) {
      parts.push(msg('trace-args-extension', { extension: String(args.extensionId).slice(0, 80) }));
    }
    if (args.blockId) {
      const script = describeTraceScript(String(args.blockId));
      if (script) parts.push(msg('trace-args-script', { script }));
    }
    if (args.limit) {
      parts.push(msg('trace-args-limit', { limit: args.limit }));
    }
    if (args.maxBlocks) {
      parts.push(msg('trace-args-max-blocks', { count: args.maxBlocks }));
    }
    if (Array.isArray(args.edits)) {
      parts.push(msg('trace-args-edits', { count: args.edits.length }));
    }
    return parts.length > 0 ? parts.join(' · ') : msg('trace-args-none');
  };

  /**
   * Build a single tool-call row.
   * @param {object} entry Trace entry.
   * @param {boolean} interactive Whether approval controls are available.
   * @returns {HTMLElement} Tool row.
   */
  const buildToolRow = (entry, interactive) => {
    const status = entry.status || (entry.ok === false ? 'error' : 'ok');
    const row = document.createElement('div');
    row.className = `sa-agent-tool-row sa-agent-trace-${status}`;

    const details = document.createElement('details');
    details.className = 'sa-agent-tool';
    rememberDisclosure(details, entry, false);

    const summary = document.createElement('summary');
    summary.className = 'sa-agent-tool-summary';

    const dot = document.createElement('span');
    dot.className = 'sa-agent-trace-dot';

    const name = document.createElement('span');
    name.className = 'sa-agent-tool-name';
    name.textContent = getToolLabel(entry.name);

    const state = document.createElement('span');
    state.className = 'sa-agent-tool-status';
    state.textContent = formatTraceStatus(status);

    const expand = document.createElement('span');
    expand.className = 'sa-agent-tool-expand';
    expand.textContent = msg('trace-expand');

    const collapse = document.createElement('span');
    collapse.className = 'sa-agent-tool-collapse';
    collapse.textContent = msg('trace-collapse');

    summary.appendChild(dot);
    summary.appendChild(name);
    summary.appendChild(state);
    summary.appendChild(expand);
    summary.appendChild(collapse);
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'sa-agent-tool-body';

    const argsLine = document.createElement('div');
    argsLine.className = 'sa-agent-tool-line';
    const argsLabel = document.createElement('span');
    argsLabel.className = 'sa-agent-tool-line-label';
    argsLabel.textContent = msg('trace-args-label');
    argsLine.appendChild(argsLabel);
    argsLine.appendChild(document.createTextNode(formatTraceArgs(entry)));
    body.appendChild(argsLine);

    const resultText = entry.summary ? formatTraceSummary(entry.summary) : '';
    if (resultText) {
      const resultLine = document.createElement('div');
      resultLine.className = 'sa-agent-tool-line';
      const resultLabel = document.createElement('span');
      resultLabel.className = 'sa-agent-tool-line-label';
      resultLabel.textContent = msg('trace-result-label');
      resultLine.appendChild(resultLabel);
      resultLine.appendChild(document.createTextNode(resultText));
      body.appendChild(resultLine);
    }

    if (entry.preview) {
      const rawLabel = document.createElement('div');
      rawLabel.className = 'sa-agent-tool-line-label';
      rawLabel.textContent = msg('trace-raw-label');
      body.appendChild(rawLabel);
      const pre = document.createElement('pre');
      pre.className = 'sa-agent-trace-pre';
      pre.textContent = entry.preview;
      body.appendChild(pre);
    }

    if (entry.diff && entry.diff.hasChanges && status !== 'awaiting') {
      const diffTitle = document.createElement('div');
      diffTitle.className = 'sa-agent-tool-line-label';
      diffTitle.textContent = msg('diff-title');
      body.appendChild(diffTitle);
      body.appendChild(buildDiffCard(entry.diff));
    }

    details.appendChild(body);
    row.appendChild(details);

    if (interactive && status === 'awaiting' && entry.id) {
      const approval = document.createElement('div');
      approval.className = 'sa-agent-tool-approval';
      const isWrite = writeToolSet.has(entry.name);
      if (isWrite) row.classList.add('sa-agent-tool-write');

      if (entry.diff && entry.diff.hasChanges) {
        approval.appendChild(buildDiffCard(entry.diff));
      }

      const controls = document.createElement('div');
      controls.className = 'sa-agent-tool-approval-controls';

      const hint = document.createElement('span');
      hint.className = 'sa-agent-tool-approval-hint';
      hint.textContent = msg(isWrite ? 'trace-write-approval-hint' : 'trace-approval-hint');

      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'sa-agent-tool-approval-button sa-agent-tool-allow';
      allow.textContent = msg('trace-allow');
      allow.addEventListener('click', () => resolveToolApproval(entry.id, true));

      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'sa-agent-tool-approval-button sa-agent-tool-deny';
      deny.textContent = msg('trace-deny');
      deny.addEventListener('click', () => resolveToolApproval(entry.id, false));

      const allowAll = document.createElement('button');
      allowAll.type = 'button';
      allowAll.className = 'sa-agent-tool-approval-button sa-agent-tool-allow-all';
      allowAll.textContent = msg('trace-allow-all');
      allowAll.addEventListener('click', () => {
        setAutoApproveTools(true);
      });

      controls.appendChild(hint);
      controls.appendChild(allow);
      controls.appendChild(deny);
      controls.appendChild(allowAll);
      approval.appendChild(controls);
      row.appendChild(approval);
    }

    return row;
  };

  /**
   * Build the tool activity panel.
   * @param {Array<object>} trace Trace entries.
   * @param {boolean} [interactive] Whether approval controls are available.
   * @returns {HTMLElement} Trace element.
   */
  const buildTraceElement = (trace, interactive = false) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'sa-agent-trace';
    const awaiting = interactive ? trace.filter((entry) => entry.status === 'awaiting') : [];
    const stacked = trace.filter((entry) => !awaiting.includes(entry));
    if (stacked.length) {
      const stack = document.createElement('details');
      stack.className = 'sa-agent-tool-stack';
      stack.classList.toggle('sa-agent-tool-stack-multiple', stacked.length > 1);
      rememberDisclosure(stack, trace);
      const summary = document.createElement('summary');
      summary.className = 'sa-agent-tool-stack-summary';
      const title = document.createElement('span');
      title.textContent = msg('trace-stack-title', { count: stacked.length });
      const state = document.createElement('span');
      state.className = 'sa-agent-tool-stack-state';
      const latest = stacked[stacked.length - 1];
      const failures = stacked.filter((entry) => entry.status === 'error' || entry.status === 'denied').length;
      state.textContent = failures
        ? msg('trace-stack-errors', { count: failures })
        : `${getToolLabel(latest.name)} · ${formatTraceStatus(latest.status)}`;
      summary.appendChild(title);
      summary.appendChild(state);
      const body = document.createElement('div');
      body.className = 'sa-agent-tool-stack-body';
      for (const entry of stacked) body.appendChild(buildToolRow(entry, false));
      stack.appendChild(summary);
      stack.appendChild(body);
      wrapper.appendChild(stack);
    }
    // Keep pending approval actions reachable even when the completed stack is collapsed.
    for (const entry of awaiting) wrapper.appendChild(buildToolRow(entry, true));
    return wrapper;
  };

  /**
   * Determine whether a tool call represents a code modification.
   * @param {object} entry Tool trace entry.
   * @returns {boolean} True for code write tools.
   */
  const isCodeWriteTool = (entry) =>
    Boolean(
      entry && (entry.name === 'apply_scripts' || entry.name === 'apply_scrathon_edits' || entry.name === 'delete_scripts')
    );

  /**
   * Build a standalone in-chat code edit element with side-by-side split diff.
   * Does not use a collapsible details card or bubble borders; renders directly on the background.
   *
   * Format:
   * EDIT -> Target
   * 10 xxx.xxx()      |  10 xxx.xxx()
   *                   |+ 11 xxxx.xxxx(abc)
   *                   |+ 12 xxx.xxxxxx()
   * 11 xxxx.xx()      |~ 13 xxxx.xx()
   *
   * @param {object} entry Tool trace entry.
   * @param {boolean} interactive Whether approval controls are available.
   * @returns {HTMLElement} Code edit element.
   */
  const buildCodeEditElement = (entry, interactive = false) => {
    const status = entry.status || (entry.ok === false ? 'error' : 'ok');
    const container = document.createElement('div');
    container.className = `sa-agent-code-edit sa-agent-status-${status}`;

    const diff = entry.diff;
    const targetName = (diff && diff.target) || (entry.args && entry.args.target) || '';

    // Header: EDIT -> Target
    const header = document.createElement('div');
    header.className = 'sa-agent-code-edit-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'sa-agent-code-edit-title';

    const label = document.createElement('span');
    label.className = 'sa-agent-code-edit-label';
    label.textContent = 'EDIT';

    const arrow = document.createElement('span');
    arrow.className = 'sa-agent-code-edit-arrow';
    arrow.textContent = '->';

    titleGroup.appendChild(label);
    titleGroup.appendChild(arrow);

    if (targetName) {
      const targetSpan = document.createElement('span');
      targetSpan.className = 'sa-agent-code-edit-target';
      targetSpan.textContent = targetName;
      titleGroup.appendChild(targetSpan);
    }

    header.appendChild(titleGroup);

    const meta = document.createElement('div');
    meta.className = 'sa-agent-code-edit-meta';

    if (diff) {
      const stats = document.createElement('span');
      stats.className = 'sa-agent-code-edit-stats';
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
      meta.appendChild(stats);
    }

    const toggle = buildDiffViewToggle();
    meta.appendChild(toggle.element);

    const badge = document.createElement('span');
    badge.className = `sa-agent-code-edit-status sa-agent-status-${status}`;
    badge.textContent = formatTraceStatus(status);
    meta.appendChild(badge);

    header.appendChild(meta);
    container.appendChild(header);

    // Body: side-by-side split diff
    const content = document.createElement('div');
    content.className = 'sa-agent-code-edit-content';

    const scripts = diff && Array.isArray(diff.scripts) && diff.scripts.length > 0 ? diff.scripts : null;

    if (scripts) {
      for (const script of scripts) {
        if (scripts.length > 1 && script.title) {
          const scriptHeader = document.createElement('div');
          scriptHeader.className = 'sa-agent-code-edit-script-title';
          scriptHeader.textContent = script.title;
          content.appendChild(scriptHeader);
        }

        const table = document.createElement('div');
        table.className = 'sa-agent-split-table';

        const hunks = Array.isArray(script.hunks) && script.hunks.length > 0 ? script.hunks : null;
        const hunkList = hunks || [{ header: null, lines: script.diff || [] }];

        for (const hunk of hunkList) {
          if (hunk.header) {
            const hunkHeader = document.createElement('div');
            hunkHeader.className = 'sa-agent-split-hunk-header';
            hunkHeader.textContent = hunk.header;
            table.appendChild(hunkHeader);
          }

          const splitRows = buildSideBySideRows(hunk.lines || []);
          for (const rowData of splitRows) {
            const row = document.createElement('div');
            row.className = 'sa-agent-split-row';

            // Left column (old code)
            const leftCol = document.createElement('div');
            leftCol.className = `sa-agent-split-col sa-agent-split-left is-${rowData.left.type}`;
            const leftNo = document.createElement('span');
            leftNo.className = 'sa-agent-split-lineno';
            leftNo.textContent = rowData.left.lineNo !== null ? String(rowData.left.lineNo) : '';
            const leftText = document.createElement('span');
            leftText.className = 'sa-agent-split-text';
            leftText.textContent = rowData.left.text;
            leftCol.appendChild(leftNo);
            leftCol.appendChild(leftText);

            // Divider: |
            const divider = document.createElement('div');
            divider.className = 'sa-agent-split-divider';
            divider.textContent = '|';

            // Right column (new code)
            const rightCol = document.createElement('div');
            rightCol.className = `sa-agent-split-col sa-agent-split-right is-${rowData.right.type}`;
            const rightMark = document.createElement('span');
            rightMark.className = `sa-agent-split-mark is-${rowData.right.type}`;
            rightMark.textContent = rowData.right.mark;
            const rightNo = document.createElement('span');
            rightNo.className = 'sa-agent-split-lineno';
            rightNo.textContent = rowData.right.lineNo !== null ? String(rowData.right.lineNo) : '';
            const rightText = document.createElement('span');
            rightText.className = 'sa-agent-split-text';
            rightText.textContent = rowData.right.text;
            rightCol.appendChild(rightMark);
            rightCol.appendChild(rightNo);
            rightCol.appendChild(rightText);

            row.appendChild(leftCol);
            row.appendChild(divider);
            row.appendChild(rightCol);
            table.appendChild(row);
          }
        }

        content.appendChild(table);
      }
    } else if (entry.args && typeof entry.args.code === 'string' && entry.args.code.trim()) {
      // Fallback synthetic diff for plain code string
      const lines = entry.args.code.trim().split('\n');
      const table = document.createElement('div');
      table.className = 'sa-agent-split-table';
      lines.forEach((lineText, idx) => {
        const row = document.createElement('div');
        row.className = 'sa-agent-split-row';

        const leftCol = document.createElement('div');
        leftCol.className = 'sa-agent-split-col sa-agent-split-left is-empty';
        const leftNo = document.createElement('span');
        leftNo.className = 'sa-agent-split-lineno';
        const leftText = document.createElement('span');
        leftText.className = 'sa-agent-split-text';
        leftCol.appendChild(leftNo);
        leftCol.appendChild(leftText);

        const divider = document.createElement('div');
        divider.className = 'sa-agent-split-divider';
        divider.textContent = '|';

        const rightCol = document.createElement('div');
        rightCol.className = 'sa-agent-split-col sa-agent-split-right is-add';
        const rightMark = document.createElement('span');
        rightMark.className = 'sa-agent-split-mark is-add';
        rightMark.textContent = '+';
        const rightNo = document.createElement('span');
        rightNo.className = 'sa-agent-split-lineno';
        rightNo.textContent = String(idx + 1);
        const rightText = document.createElement('span');
        rightText.className = 'sa-agent-split-text';
        rightText.textContent = lineText;
        rightCol.appendChild(rightMark);
        rightCol.appendChild(rightNo);
        rightCol.appendChild(rightText);

        row.appendChild(leftCol);
        row.appendChild(divider);
        row.appendChild(rightCol);
        table.appendChild(row);
      });
      content.appendChild(table);
    } else {
      const empty = document.createElement('div');
      empty.className = 'sa-agent-code-edit-empty';
      empty.textContent = msg('diff-no-changes');
      content.appendChild(empty);
    }

    container.appendChild(content);

    const blocksView = document.createElement('div');
    blocksView.className = 'sa-agent-blocks-view';
    container.appendChild(blocksView);

    const pairs = [];
    if (scripts) {
      for (const script of scripts) {
        const title = script.title || 'Script';
        if (script.oldCode && script.oldCode.trim()) {
          pairs.push({
            label: `${title} · ${msg('diff-before')}`,
            code: script.oldCode,
            kind: 'before',
            target: targetName
          });
        }
        if (script.newCode && script.newCode.trim()) {
          pairs.push({
            label: `${title} · ${msg('diff-after')}`,
            code: script.newCode,
            kind: 'after',
            target: targetName
          });
        }
      }
    } else if (entry.args && typeof entry.args.code === 'string' && entry.args.code.trim()) {
      pairs.push({
        label: msg('diff-after'),
        code: entry.args.code,
        kind: 'after',
        target: targetName
      });
    }
    attachDiffView({ textView: content, blocksView, pairs, toggle });

    // Approval controls when awaiting approval
    if (interactive && status === 'awaiting' && entry.id) {
      const approval = document.createElement('div');
      approval.className = 'sa-agent-code-edit-approval';

      const controls = document.createElement('div');
      controls.className = 'sa-agent-tool-approval-controls';

      const hint = document.createElement('span');
      hint.className = 'sa-agent-tool-approval-hint';
      hint.textContent = msg('trace-write-approval-hint');

      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'sa-agent-tool-approval-button sa-agent-tool-allow';
      allow.textContent = msg('trace-allow');
      allow.addEventListener('click', () => resolveToolApproval(entry.id, true));

      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'sa-agent-tool-approval-button sa-agent-tool-deny';
      deny.textContent = msg('trace-deny');
      deny.addEventListener('click', () => resolveToolApproval(entry.id, false));

      const allowAll = document.createElement('button');
      allowAll.type = 'button';
      allowAll.className = 'sa-agent-tool-approval-button sa-agent-tool-allow-all';
      allowAll.textContent = msg('trace-allow-all');
      allowAll.addEventListener('click', () => {
        setAutoApproveTools(true);
        resolveToolApproval(entry.id, true);
      });

      controls.appendChild(hint);
      controls.appendChild(allow);
      controls.appendChild(deny);
      controls.appendChild(allowAll);
      approval.appendChild(controls);
      container.appendChild(approval);
    }

    // Error message display if failed
    if ((status === 'error' || entry.ok === false) && entry.summary && (entry.summary.error || entry.summary.message)) {
      const errorNotice = document.createElement('div');
      errorNotice.className = 'sa-agent-code-edit-error';
      errorNotice.textContent = entry.summary.error || entry.summary.message;
      container.appendChild(errorNotice);
    }

    return container;
  };

  /**
   * Append trace entries into a message row.
   * Separates normal tool calls (placed into collapsible stack) from code-write tool calls
   * (placed directly as standalone EDIT side-by-side elements without collapsible cards).
   *
   * @param {HTMLElement} container Message row element.
   * @param {Array<object>} trace Tool entries.
   * @param {boolean} interactive Whether approval controls are interactive.
   */
  const appendTraceElements = (container, trace, interactive = false) => {
    let currentNormalGroup = [];
    for (const entry of trace) {
      if (isCodeWriteTool(entry)) {
        if (currentNormalGroup.length > 0) {
          container.appendChild(buildTraceElement(currentNormalGroup, interactive));
          currentNormalGroup = [];
        }
        container.appendChild(buildCodeEditElement(entry, interactive));
      } else {
        currentNormalGroup.push(entry);
      }
    }
    if (currentNormalGroup.length > 0) {
      container.appendChild(buildTraceElement(currentNormalGroup, interactive));
    }
  };

  return { appendTraceElements, buildTraceElement, buildToolRow, isCodeWriteTool };
};
