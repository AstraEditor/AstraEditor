/**
 * Write bridge for Astra Copilot.
 *
 * The agent tools live in plain modules that have no direct access to
 * scratch-blocks. This module is a tiny registry: the addon's userscript
 * installs an `applier` once the editor is ready, and the write tools call
 * `applyXml` to push compiled block XML into the real workspace.
 *
 * Applying through `Blockly.Xml.domToWorkspace` is intentional:
 *   - the GUI forwards every create/delete event to `vm.blockListener`, so the
 *     VM stays the source of truth;
 *   - events are recorded on Blockly's undo stack, so a single Ctrl+Z reverts
 *     the whole injection.
 */

let applier = null;

/**
 * Register the workspace applier.
 * @param {Function} fn Async applier: (xml, meta) => Promise<{blockIds?: Array<string>}>.
 */
export const setApplier = (fn) => {
  applier = typeof fn === 'function' ? fn : null;
};

/**
 * Whether an applier is currently registered.
 * @returns {boolean} Availability.
 */
export const hasApplier = () => typeof applier === 'function';

/**
 * Apply compiled XML through the registered applier.
 * @param {string} xml Block XML (may be empty when only deleting).
 * @param {object} [meta] Extra instructions: targetId, deleteScriptIds.
 * @returns {Promise<object>} Applier result.
 */
export const applyXml = async (xml, meta = {}) => {
  if (typeof applier !== 'function') {
    throw new Error('The editor is not ready to apply changes yet. Try again once the project has loaded.');
  }
  return applier(xml, meta || {});
};
