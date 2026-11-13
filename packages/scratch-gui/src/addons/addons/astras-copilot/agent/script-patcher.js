/**
 * In-place script patching for the Scratch workspace.
 *
 * `apply_scripts` can only append XML, so editing an existing script used to
 * mean "dispose the old script and load a new one". Users see that as the hat
 * block being deleted and the whole stack regenerated: new block ids, new
 * position, lost comments, and a big visual jump.
 *
 * This module instead walks the live Blockly block tree next to the newly
 * compiled XML and patches it:
 *   - a matching block keeps its identity, position and comment; only differing
 *     field values are written;
 *   - statement and value inputs are patched recursively;
 *   - at the first structural difference the old tail is removed and only the
 *     new tail is created;
 *   - the root (hat) is replaced only when the hat type or its mutation changed.
 *
 * Everything runs inside the caller's undo group, so one Ctrl+Z reverts the
 * whole patch. Blockly events keep the VM in sync (`vm.blockListener`).
 */

/** Element children of a node. */
const childElements = (node) =>
  node ? Array.from(node.childNodes || []).filter((child) => child.nodeType === 1) : [];

/**
 * Find a direct child element by tag name.
 * @param {Element} node Parent node.
 * @param {string} tag Lowercase tag name.
 * @returns {?Element} Child element.
 */
const directChild = (node, tag) =>
  childElements(node).find((child) => child.nodeName.toLowerCase() === tag) || null;

/**
 * Top-level `<block>` roots of a parsed XML document.
 * Accepts the parsed Document, its `<xml>` element, or a bare list container.
 * @param {Document|Element} node Parsed XML.
 * @returns {Array<Element>} Root block elements.
 */
export const topLevelBlockElements = (node) => {
  if (!node) return [];
  const element = node.nodeType === 9 ? node.documentElement : node;
  if (!element) return [];
  const container = element.nodeName && element.nodeName.toLowerCase() === 'xml' ? element : node;
  return childElements(container).filter((child) => child.nodeName.toLowerCase() === 'block');
};

/**
 * The block chained after this one via `<next>`.
 * @param {Element} blockEl Block element.
 * @returns {?Element} Next block element.
 */
export const nextBlockElement = (blockEl) => {
  const next = directChild(blockEl, 'next');
  return next ? directChild(next, 'block') : null;
};

/**
 * Normalized attribute signature, used to compare mutations.
 * @param {?Element} el Element.
 * @returns {string} Signature.
 */
export const attributeSignature = (el) => {
  if (!el || !el.attributes) return '';
  return Array.from(el.attributes)
    .map((attr) => `${attr.name}=${attr.value}`)
    .sort()
    .join('&');
};

/**
 * Whether a block is a shadow (literal input) block.
 * @param {object} block Blockly block.
 * @returns {boolean} Shadow state.
 */
const isShadowBlock = (block) => {
  if (!block) return false;
  if (typeof block.isShadow === 'function') return Boolean(block.isShadow());
  return Boolean(block.isShadow_);
};

/**
 * Serialized mutation of a live block.
 * @param {object} Blockly scratch-blocks namespace.
 * @param {object} block Blockly block.
 * @returns {string} Mutation signature ('' when absent).
 */
const mutationSignature = (Blockly, block) => {
  if (typeof block.domToMutation !== 'function' && !block.mutationToDom) return '';
  try {
    const dom = Blockly.Xml.blockToDom(block, true);
    return attributeSignature(directChild(dom, 'mutation'));
  } catch (error) {
    return '';
  }
};

/**
 * Whether patching this block in place is safe. Blocks with a different
 * mutation (custom block signatures, extension menus) are rebuilt instead.
 * @param {object} Blockly scratch-blocks namespace.
 * @param {object} block Live block.
 * @param {Element} el New block element.
 * @returns {boolean} Whether the block can be patched in place.
 */
const canPatchInPlace = (Blockly, block, el) => {
  const newMutation = directChild(el, 'mutation');
  const oldSignature = mutationSignature(Blockly, block);
  const newSignature = attributeSignature(newMutation);
  return oldSignature === newSignature;
};

/**
 * Copy field values from XML into a live block, skipping unchanged fields.
 * @param {object} ctx Patch context.
 * @param {object} block Live block.
 * @param {Element} el New block element.
 */
const patchFields = (ctx, block, el) => {
  for (const child of childElements(el)) {
    const tag = child.nodeName.toLowerCase();
    if (tag !== 'field' && tag !== 'title') continue;
    const name = child.getAttribute('name');
    if (!name) continue;
    const field = typeof block.getField === 'function' ? block.getField(name) : null;
    if (!field) continue;

    const id = child.getAttribute('id');
    const desired = id !== null ? id : child.textContent;
    let current;
    try {
      current = typeof field.getValue === 'function' ? field.getValue() : undefined;
    } catch (error) {
      current = undefined;
    }
    if (current !== undefined && String(current) === String(desired)) continue;

    if (typeof ctx.Blockly.Xml.domToField_ === 'function') {
      ctx.Blockly.Xml.domToField_(block, name, child);
    } else {
      block.setFieldValue(child.textContent, name);
    }
    ctx.stats.fields++;
  }
};

/**
 * Detach whatever is connected to an input, restoring its shadow.
 * @param {object} ctx Patch context.
 * @param {object} input Blockly input.
 * @param {boolean} [dispose] Whether to dispose the detached block.
 */
const clearInput = (ctx, input, dispose = true) => {
  if (!input || !input.connection) return;
  const target = input.connection.targetBlock();
  if (!target) return;
  try {
    input.connection.disconnect();
  } catch (error) {
    // Already disconnected; nothing to restore.
  }
  if (dispose) {
    // Disposing after the disconnect is safe: the connection already restored
    // its shadow, so the detached block (shadow or not) is free to go.
    target.dispose(false);
    ctx.stats.removed++;
  }
};

/**
 * Create a block (or a block chain) from XML.
 * @param {object} ctx Patch context.
 * @param {Element} el Block element.
 * @param {boolean} keepPosition Keep x/y attributes.
 * @returns {?object} Created block.
 */
const createBlock = (ctx, el, keepPosition) => {
  const clone = el.cloneNode(true);
  if (!keepPosition) {
    clone.removeAttribute('x');
    clone.removeAttribute('y');
  }
  const block = ctx.Blockly.Xml.domToBlock(clone, ctx.workspace);
  if (block) ctx.stats.created++;
  return block || null;
};

/**
 * Patch one value input.
 * @param {object} ctx Patch context.
 * @param {object} input Blockly input.
 * @param {Element} el `<value>` element.
 */
const patchValueInput = (ctx, input, el) => {
  const shadowEl = directChild(el, 'shadow');
  const blockEl = directChild(el, 'block');
  const primary = blockEl || shadowEl;
  if (!primary) {
    clearInput(ctx, input);
    return;
  }

  const target = input.connection ? input.connection.targetBlock() : null;
  const wantsShadow = !blockEl && Boolean(shadowEl);
  const sameKind =
    target &&
    target.type === primary.getAttribute('type') &&
    isShadowBlock(target) === wantsShadow &&
    canPatchInPlace(ctx.Blockly, target, primary);

  if (sameKind) {
    patchFields(ctx, target, primary);
    patchInputs(ctx, target, primary);
    return;
  }

  // Replace the shadow definition before detaching the old block so the
  // respawned shadow is the new one, then reconnect the new child.
  if (shadowEl && input.connection.setShadowDom) {
    input.connection.setShadowDom(shadowEl);
  }
  if (target) {
    clearInput(ctx, input, true);
  }
  const created = createBlock(ctx, primary, false);
  if (!created || !input.connection) return;
  if (created.outputConnection) {
    input.connection.connect(created.outputConnection);
  } else if (created.previousConnection) {
    input.connection.connect(created.previousConnection);
  }
};

/**
 * Patch a statement chain (`<next>` chain or a SUBSTACK).
 * @param {object} ctx Patch context.
 * @param {object} connection Connection that owns the chain.
 * @param {?Element} firstNewEl First new block element, if any.
 * @returns {number} Number of blocks that kept their identity.
 */
const patchChain = (ctx, connection, firstNewEl) => {
  let kept = 0;
  let oldBlock = connection && connection.targetBlock ? connection.targetBlock() : null;
  let newEl = firstNewEl;
  let owner = connection;

  while (newEl && oldBlock) {
    const sameType = oldBlock.type === newEl.getAttribute('type');
    if (!sameType || !canPatchInPlace(ctx.Blockly, oldBlock, newEl)) break;
    patchFields(ctx, oldBlock, newEl);
    patchInputs(ctx, oldBlock, newEl);
    kept++;
    owner = oldBlock.nextConnection;
    oldBlock = oldBlock.getNextBlock ? oldBlock.getNextBlock() : null;
    newEl = nextBlockElement(newEl);
  }

  if (!newEl) {
    if (oldBlock) {
      oldBlock.dispose(false);
      ctx.stats.removed++;
    }
    ctx.stats.reused += kept;
    return kept;
  }

  // Structural divergence: drop the old tail and build only the new tail.
  if (oldBlock) {
    oldBlock.dispose(false);
    ctx.stats.removed++;
  }
  const created = createBlock(ctx, newEl, false);
  if (created && created.previousConnection && owner) {
    owner.connect(created.previousConnection);
  }
  ctx.stats.reused += kept;
  return kept;
};

/**
 * Patch every input of a block against its new XML.
 * @param {object} ctx Patch context.
 * @param {object} block Live block.
 * @param {Element} el New block element.
 */
function patchInputs(ctx, block, el) {
  const handled = new Set();
  for (const child of childElements(el)) {
    const tag = child.nodeName.toLowerCase();
    if (tag !== 'value' && tag !== 'statement') continue;
    const name = child.getAttribute('name');
    if (!name) continue;
    handled.add(name);
    const input = typeof block.getInput === 'function' ? block.getInput(name) : null;
    if (!input) continue;
    if (tag === 'statement') {
      patchChain(ctx, input.connection, directChild(child, 'block'));
    } else {
      patchValueInput(ctx, input, child);
    }
  }

  // Inputs that no longer exist in the new source must be emptied (for
  // example, removing an `else` branch while keeping the `if`).
  const inputs = Array.isArray(block.inputList) ? block.inputList : [];
  for (const input of inputs) {
    const name = input && input.name;
    if (!name || handled.has(name)) continue;
    if (!input.connection || !input.connection.targetBlock()) continue;
    if (isShadowBlock(input.connection.targetBlock())) continue;
    clearInput(ctx, input, true);
  }
}

/**
 * Patch one script in place.
 * @param {object} options Options.
 * @param {object} options.Blockly scratch-blocks namespace.
 * @param {object} options.workspace Workspace that owns the script.
 * @param {string} options.scriptId Id of the script root to patch.
 * @param {string} options.xml Compiled XML for the replacement script.
 * @returns {{reused: number, created: number, removed: number, fields: number, replacedRoot: boolean, extras: number}} Stats.
 */
export const patchScript = ({ Blockly, workspace, scriptId, xml }) => {
  if (!Blockly || !Blockly.Xml || typeof Blockly.Xml.textToDom !== 'function') {
    throw new Error('scratch-blocks is not available.');
  }
  if (!workspace || typeof workspace.getBlockById !== 'function') {
    throw new Error('The block workspace is not ready.');
  }
  const doc = Blockly.Xml.textToDom(xml);
  const roots = topLevelBlockElements(doc);
  if (roots.length === 0) throw new Error('The compiled script has no blocks.');

  const oldRoot = workspace.getBlockById(scriptId);
  if (!oldRoot) {
    throw new Error(`Script ${scriptId} is not in the editor workspace for this sprite.`);
  }

  const ctx = { Blockly, workspace, stats: { reused: 0, created: 0, removed: 0, fields: 0 } };
  const newRoot = roots[0];
  const mustReplaceRoot =
    oldRoot.type !== newRoot.getAttribute('type') ||
    oldRoot.type === 'procedures_definition' ||
    !canPatchInPlace(Blockly, oldRoot, newRoot);

  if (mustReplaceRoot) {
    let position = null;
    try {
      position = oldRoot.getRelativeToSurfaceXY();
    } catch (error) {
      position = null;
    }
    oldRoot.dispose(false);
    ctx.stats.removed++;
    const created = createBlock(ctx, newRoot, true);
    if (created && position && typeof created.moveBy === 'function') {
      try {
        const current = created.getRelativeToSurfaceXY();
        created.moveBy(position.x - current.x, position.y - current.y);
      } catch (error) {
        // Positioning is cosmetic; ignore failures.
      }
    }
  } else {
    patchFields(ctx, oldRoot, newRoot);
    patchInputs(ctx, oldRoot, newRoot);
    ctx.stats.reused++;
    patchChain(ctx, oldRoot.nextConnection, nextBlockElement(newRoot));
  }

  // A single edit may declare several hats; the first one replaces the target
  // script and the rest become new scripts.
  const extras = roots.slice(1);
  for (const extra of extras) createBlock(ctx, extra, true);

  return {
    ...ctx.stats,
    replacedRoot: mustReplaceRoot,
    extras: extras.length
  };
};
