/**
 * Layout helper for freshly inserted scripts.
 *
 * `Blockly.Xml.domToWorkspace` drops new top blocks at the workspace origin,
 * which lands on top of whatever is already there. This places them in a free
 * column to the right of the existing scripts instead.
 */

const START_X = 40;
const START_Y = 40;
const GAP_X = 80;
const GAP_Y = 60;

/**
 * Read a block's size, tolerating partial block implementations.
 * @param {object} block Block.
 * @returns {{width: number, height: number}} Size.
 */
const blockSize = (block) => {
  if (!block || typeof block.getHeightWidth !== 'function') return { width: 0, height: 0 };
  const size = block.getHeightWidth() || {};
  return { width: Number(size.width) || 0, height: Number(size.height) || 0 };
};

/**
 * Read a block's position on the workspace surface.
 * @param {object} block Block.
 * @returns {{x: number, y: number}} Position.
 */
const blockPosition = (block) => {
  if (!block || typeof block.getRelativeToSurfaceXY !== 'function') return { x: 0, y: 0 };
  const position = block.getRelativeToSurfaceXY() || {};
  return { x: Number(position.x) || 0, y: Number(position.y) || 0 };
};

/**
 * Move the given top blocks into a free column right of the existing scripts.
 * @param {object} workspace Blockly workspace.
 * @param {Array<string>} newIds IDs of the blocks that were just inserted.
 * @returns {Array<{id: string, x: number, y: number}>} Final positions.
 */
export const packNewBlocks = (workspace, newIds) => {
  if (!workspace || !Array.isArray(newIds) || newIds.length === 0) return [];
  const inserted = new Set(newIds);

  const tops = typeof workspace.getTopBlocks === 'function' ? workspace.getTopBlocks(true) || [] : [];
  let right = 0;
  let hasExisting = false;
  for (const block of tops) {
    if (!block || inserted.has(block.id)) continue;
    hasExisting = true;
    const { width } = blockSize(block);
    const { x } = blockPosition(block);
    right = Math.max(right, x + width);
  }

  const startX = hasExisting ? right + GAP_X : START_X;
  let y = START_Y;
  const placed = [];

  for (const id of newIds) {
    const block = typeof workspace.getBlockById === 'function' ? workspace.getBlockById(id) : null;
    if (!block) continue;
    const { height } = blockSize(block);
    const position = blockPosition(block);
    if (typeof block.moveBy === 'function') block.moveBy(startX - position.x, y - position.y);
    placed.push({ id, x: startX, y });
    y += height + GAP_Y;
  }

  return placed;
};
