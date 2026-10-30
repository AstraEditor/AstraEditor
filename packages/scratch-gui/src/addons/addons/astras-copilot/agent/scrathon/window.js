/**
 * Scrathon conversion and debug window.
 *
 * A standalone, draggable DOM window (compact single-pane mode) that converts
 * between Scrathon DSL text and real Scratch blocks:
 *   - "Code -> Blocks": compile the code and apply to the target's workspace.
 *   - "Blocks -> Code": decompile the target's scripts into the editor.
 *   - "Round-Trip Test": test bidirectional conversion and verify fidelity.
 */

import {
  createScratchTools,
  applyScrathonSource,
  decompileTargetScripts,
  compileScrathonCode,
  prepareScrathonCodeAndExtensions
} from '../tools.js';
import { createDecompiler } from './decompiler.js';

/** Turn any thrown value into a display string. */
const errorText = (error) => (error && error.message ? error.message : String(error));

const DEFAULT_CODE = ['@when_flag_clicked', 'def main():', '    move(${n:10})', ''].join('\n');

/**
 * Build the Scrathon conversion window controller.
 * @param {object} options Options.
 * @param {object} options.vm Scratch VM.
 * @param {Function} options.msg Localization function.
 * @returns {object} Controller with `open()`, `close()` and `toggle()`.
 */
export const createScrathonWindow = ({ vm, msg }) => {
  let windowElement = null;
  let codeArea = null;
  let targetSelect = null;
  let statusElement = null;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const t = (key, fallback) => {
    const value = msg(key);
    return value === key ? fallback : value;
  };

  /** Report a message in the window's status strip. */
  const setStatus = (text, isError = false, isSuccess = false) => {
    if (!statusElement) return;
    statusElement.textContent = text;
    statusElement.classList.toggle('sa-agent-scrathon-status-error', Boolean(isError));
    statusElement.classList.toggle('sa-agent-scrathon-status-success', Boolean(isSuccess));
  };

  /** Refresh the target dropdown from the VM. */
  const refreshTargets = () => {
    if (!targetSelect) return;
    const tools = createScratchTools(vm);
    const { targets, currentTarget } = tools.list_targets();
    targetSelect.textContent = '';
    for (const target of targets) {
      const option = document.createElement('option');
      option.value = target.name;
      option.textContent = target.name;
      if (currentTarget && target.name === currentTarget.name) option.selected = true;
      targetSelect.appendChild(option);
    }
  };

  /** The currently selected target name (or undefined for the editing target). */
  const selectedTarget = () => (targetSelect && targetSelect.value ? targetSelect.value : undefined);

  /** Compile the text area and apply it to the selected target. */
  const importCode = async () => {
    if (!codeArea) return;
    const code = codeArea.value;
    if (!code.trim()) {
      setStatus(t('scrathon-empty', 'Enter some Scrathon code first.'), true);
      return;
    }
    try {
      const result = await applyScrathonSource(vm, { code, target: selectedTarget() });
      setStatus(
        `${t('scrathon-applied', 'Applied to')} ${result.target.name}: ${result.applied} ${t('scrathon-blocks', 'block(s)')}.`,
        false,
        true
      );
    } catch (error) {
      setStatus(errorText(error), true);
    }
  };

  /** Decompile the selected target's scripts into the code area. */
  const exportCode = () => {
    try {
      const { target, scripts, imports } = decompileTargetScripts(vm, selectedTarget());
      const importLines =
        Array.isArray(imports) && imports.length > 0
          ? `${imports.map((moduleName) => `import ${moduleName}`).join('\n')}\n\n`
          : '';
      const scriptCode = scripts
        .map((script) => script.code)
        .filter(Boolean)
        .join('\n\n');
      const code = `${importLines}${scriptCode}`;
      if (codeArea) codeArea.value = code;
      setStatus(
        `${t('scrathon-exported', 'Exported')} ${scripts.length} ${t('scrathon-scripts', 'script(s)')} ${t('scrathon-from', 'from')} ${target.name}.`,
        false,
        true
      );
    } catch (error) {
      setStatus(errorText(error), true);
    }
  };

  /**
   * Perform an in-memory round-trip test:
   * Code -> Compiler -> Mock Scratch Blocks -> Decompiler -> Recompiler.
   */
  const roundTripTest = async () => {
    if (!codeArea) return;
    const source = codeArea.value;
    if (!source.trim()) {
      setStatus(t('scrathon-empty', 'Enter some Scrathon code first.'), true);
      return;
    }
    try {
      const preparedCode = await prepareScrathonCodeAndExtensions(vm, source);
      const compiled = compileScrathonCode(vm, preparedCode, { target: selectedTarget() });
      if (!compiled.scripts || compiled.scripts.length === 0) {
        throw new Error('Compilation produced 0 scripts.');
      }

      const mockTarget = {
        id: 'debug-target',
        name: selectedTarget() || 'Sprite1',
        getName: () => selectedTarget() || 'Sprite1',
        blocks: { _blocks: {} }
      };

      let blockIdCounter = 1;
      const addBlockTree = (desc, isTopLevel = false) => {
        const id = `blk_${blockIdCounter++}`;
        const blk = {
          id,
          opcode: desc.opcode,
          topLevel: isTopLevel,
          inputs: {},
          fields: {},
          mutation: desc.mutation,
          next: null
        };
        mockTarget.blocks._blocks[id] = blk;
        if (desc.fields) {
          for (const [fName, fVal] of Object.entries(desc.fields)) {
            blk.fields[fName] = { name: fName, value: fVal };
          }
        }
        if (desc.inputs) {
          for (const [iName, iVal] of Object.entries(desc.inputs)) {
            if (iVal && typeof iVal === 'object' && iVal.opcode) {
              const childId = addBlockTree(iVal, false);
              blk.inputs[iName] = { block: childId };
            } else {
              const sId = `shadow_${blockIdCounter++}`;
              const sVal = iVal && typeof iVal === 'object' && iVal.value !== undefined ? iVal.value : iVal;
              let sOpcode = 'text';
              let sField = 'TEXT';
              if (typeof sVal === 'number' || (!isNaN(Number(sVal)) && sVal !== '')) {
                sOpcode = 'math_number';
                sField = 'NUM';
              }
              if (iVal && iVal.__shadow) {
                sOpcode = iVal.__shadow;
                sField = iVal.__field || 'TEXT';
              }
              mockTarget.blocks._blocks[sId] = {
                id: sId,
                opcode: sOpcode,
                shadow: true,
                fields: { [sField]: { name: sField, value: String(sVal ?? '') } }
              };
              blk.inputs[iName] = { block: sId, shadow: sId };
            }
          }
        }
        if (desc.substack) {
          const subId = addBlockTree(desc.substack[0], false);
          blk.inputs.SUBSTACK = { block: subId };
          let curId = subId;
          for (let j = 1; j < desc.substack.length; j++) {
            const nextId = addBlockTree(desc.substack[j], false);
            mockTarget.blocks._blocks[curId].next = nextId;
            curId = nextId;
          }
        }
        if (desc.next) {
          const nextNodes = Array.isArray(desc.next) ? desc.next : [desc.next];
          let curId = id;
          for (const nextNode of nextNodes) {
            const nextId = addBlockTree(nextNode, false);
            mockTarget.blocks._blocks[curId].next = nextId;
            curId = nextId;
          }
        }
        return id;
      };

      for (const script of compiled.scripts) {
        if (script.blocks && script.blocks.length > 0) {
          let prevId = null;
          for (let i = 0; i < script.blocks.length; i++) {
            const bId = addBlockTree(script.blocks[i], i === 0);
            if (prevId) mockTarget.blocks._blocks[prevId].next = bId;
            prevId = bId;
          }
        }
      }

      const decompiler = createDecompiler(vm, mockTarget);
      const decompiledResult = decompiler.file();

      // Verify that the decompiled code compiles cleanly without errors
      const recompiled = compileScrathonCode(vm, decompiledResult.code, { target: selectedTarget() });
      if (!recompiled.scripts || recompiled.scripts.length === 0) {
        throw new Error('Recompilation produced 0 scripts.');
      }

      setStatus(
        t('scrathon-roundtrip-ok', '✓ Round-trip verified! DSL and blocks convert cleanly both ways.'),
        false,
        true
      );
    } catch (err) {
      setStatus(`[Round-Trip Error] ${errorText(err)}`, true);
    }
  };

  /** Copy text to clipboard. */
  const copyText = (text) => {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setStatus(t('scrathon-copied', 'Copied to clipboard.'), false, true);
  };

  /** Start dragging the window from its header. */
  const onDragStart = (event) => {
    if (!windowElement) return;
    dragging = true;
    const rect = windowElement.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  };

  /** Move the window while dragging. */
  const onDragMove = (event) => {
    if (!dragging || !windowElement) return;
    const width = windowElement.offsetWidth;
    const height = windowElement.offsetHeight;
    const maxX = window.innerWidth - width;
    const maxY = window.innerHeight - height;
    windowElement.style.left = `${Math.min(Math.max(0, event.clientX - dragOffsetX), Math.max(0, maxX))}px`;
    windowElement.style.top = `${Math.min(Math.max(0, event.clientY - dragOffsetY), Math.max(0, maxY))}px`;
  };

  /** Stop dragging. */
  const onDragEnd = () => {
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  };

  /** Allow Tab key to indent 4 spaces in textarea. */
  const setupTabIndent = (textarea) => {
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = `${textarea.value.substring(0, start)}    ${textarea.value.substring(end)}`;
        textarea.selectionStart = textarea.selectionEnd = start + 4;
      }
    });
  };

  /** Build the window DOM once. */
  const build = () => {
    windowElement = document.createElement('div');
    windowElement.className = 'sa-agent-scrathon-window';
    windowElement.style.display = 'none';

    // Header
    const header = document.createElement('div');
    header.className = 'sa-agent-scrathon-header';
    header.addEventListener('mousedown', onDragStart);

    const title = document.createElement('span');
    title.className = 'sa-agent-scrathon-title';
    title.textContent = t('scrathon-window-title', 'Scrathon Converter');
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'sa-agent-scrathon-close';
    closeButton.textContent = '\u00d7';
    closeButton.title = t('scrathon-close', 'Close');
    closeButton.setAttribute('aria-label', t('scrathon-close', 'Close'));
    closeButton.addEventListener('click', () => close());
    header.appendChild(closeButton);

    windowElement.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'sa-agent-scrathon-body';

    // Toolbar Row
    const toolbar = document.createElement('div');
    toolbar.className = 'sa-agent-scrathon-toolbar';

    const targetGroup = document.createElement('div');
    targetGroup.className = 'sa-agent-scrathon-target-group';

    const targetLabel = document.createElement('span');
    targetLabel.className = 'sa-agent-scrathon-label';
    targetLabel.textContent = t('scrathon-target', 'Target');
    targetGroup.appendChild(targetLabel);

    targetSelect = document.createElement('select');
    targetSelect.className = 'sa-agent-scrathon-select';
    targetGroup.appendChild(targetSelect);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'sa-agent-scrathon-panel-btn';
    refreshButton.textContent = t('scrathon-refresh', 'Refresh');
    refreshButton.addEventListener('click', refreshTargets);
    targetGroup.appendChild(refreshButton);

    toolbar.appendChild(targetGroup);

    // Action buttons
    const buttons = document.createElement('div');
    buttons.className = 'sa-agent-scrathon-buttons';

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'sa-agent-button sa-agent-button-primary';
    importButton.textContent = t('scrathon-import', 'Code \u2192 Blocks');
    importButton.title = 'Compile Scrathon code and apply to target';
    importButton.addEventListener('click', importCode);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'sa-agent-button sa-agent-button-secondary';
    exportButton.textContent = t('scrathon-export', 'Blocks \u2192 Code');
    exportButton.title = 'Decompile target scripts into code';
    exportButton.addEventListener('click', exportCode);

    const roundTripButton = document.createElement('button');
    roundTripButton.type = 'button';
    roundTripButton.className = 'sa-agent-button sa-agent-button-secondary';
    roundTripButton.textContent = t('scrathon-roundtrip', 'Round-Trip Test');
    roundTripButton.title = 'Test bidirectional conversion fidelity';
    roundTripButton.addEventListener('click', roundTripTest);

    buttons.appendChild(importButton);
    buttons.appendChild(exportButton);
    buttons.appendChild(roundTripButton);
    toolbar.appendChild(buttons);

    body.appendChild(toolbar);

    // Code area controls row
    const editorHeader = document.createElement('div');
    editorHeader.className = 'sa-agent-scrathon-editor-header';

    const editorTitle = document.createElement('span');
    editorTitle.className = 'sa-agent-scrathon-label';
    editorTitle.textContent = t('scrathon-editor-title', 'Scrathon DSL Code');
    editorHeader.appendChild(editorTitle);

    const editorActions = document.createElement('div');
    editorActions.className = 'sa-agent-scrathon-panel-actions';

    const sampleButton = document.createElement('button');
    sampleButton.type = 'button';
    sampleButton.className = 'sa-agent-scrathon-panel-btn';
    sampleButton.textContent = t('scrathon-sample', 'Sample');
    sampleButton.addEventListener('click', () => {
      if (codeArea) codeArea.value = DEFAULT_CODE;
    });
    editorActions.appendChild(sampleButton);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'sa-agent-scrathon-panel-btn';
    clearButton.textContent = t('scrathon-clear', 'Clear');
    clearButton.addEventListener('click', () => {
      if (codeArea) codeArea.value = '';
    });
    editorActions.appendChild(clearButton);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'sa-agent-scrathon-panel-btn';
    copyButton.textContent = t('scrathon-copy', 'Copy');
    copyButton.addEventListener('click', () => {
      if (codeArea) copyText(codeArea.value);
    });
    editorActions.appendChild(copyButton);

    editorHeader.appendChild(editorActions);
    body.appendChild(editorHeader);

    // Single code textarea
    codeArea = document.createElement('textarea');
    codeArea.className = 'sa-agent-scrathon-code';
    codeArea.spellcheck = false;
    codeArea.value = DEFAULT_CODE;
    setupTabIndent(codeArea);
    body.appendChild(codeArea);

    // Status strip
    statusElement = document.createElement('pre');
    statusElement.className = 'sa-agent-scrathon-status';
    statusElement.textContent = 'Ready.';
    body.appendChild(statusElement);

    windowElement.appendChild(body);
    document.body.appendChild(windowElement);
    return windowElement;
  };

  /** Open (and focus) the window. */
  const open = () => {
    if (!windowElement) build();
    refreshTargets();
    windowElement.style.display = 'flex';
    if (codeArea) codeArea.focus();
  };

  /** Close the window. */
  const close = () => {
    if (windowElement) windowElement.style.display = 'none';
  };

  /** Toggle the window. */
  const toggle = () => {
    if (!windowElement || windowElement.style.display === 'none') open();
    else close();
  };

  return { open, close, toggle };
};

export default createScrathonWindow;
