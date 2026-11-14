/**
 * @jest-environment node
 */
/* eslint-env jest */
import { packNewBlocks } from '../../../src/addons/addons/astras-copilot/agent/layout';

/**
 * Build a fake Blockly block.
 * @param {string} id Block id.
 * @param {number} x Position x.
 * @param {number} y Position y.
 * @param {number} width Width.
 * @param {number} height Height.
 * @returns {object} Block.
 */
const makeBlock = (id, x, y, width, height) => {
  const position = { x, y };
  return {
    id,
    position,
    getHeightWidth: () => ({ width, height }),
    getRelativeToSurfaceXY: () => ({ x: position.x, y: position.y }),
    moveBy: (dx, dy) => {
      position.x += dx;
      position.y += dy;
    }
  };
};

/**
 * Build a fake workspace over a block list.
 * @param {Array<object>} blocks Blocks.
 * @returns {object} Workspace.
 */
const makeWorkspace = (blocks) => ({
  getTopBlocks: () => blocks,
  getBlockById: (id) => blocks.find((block) => block.id === id) || null
});

describe('packNewBlocks', () => {
  test('places the first script at the origin margin', () => {
    const block = makeBlock('a', 0, 0, 100, 60);
    const workspace = makeWorkspace([block]);

    const placed = packNewBlocks(workspace, ['a']);

    expect(placed).toEqual([{ id: 'a', x: 40, y: 40 }]);
    expect(block.position).toEqual({ x: 40, y: 40 });
  });

  test('stacks several new scripts vertically with a gap', () => {
    const first = makeBlock('a', 0, 0, 100, 60);
    const second = makeBlock('b', 0, 0, 80, 40);
    const workspace = makeWorkspace([first, second]);

    const placed = packNewBlocks(workspace, ['a', 'b']);

    expect(placed[0]).toEqual({ id: 'a', x: 40, y: 40 });
    expect(placed[1]).toEqual({ id: 'b', x: 40, y: 160 });
    expect(second.position.x).toBe(40);
  });

  test('moves new scripts to the right of the existing column', () => {
    const existing = makeBlock('old', 120, 200, 150, 80);
    const inserted = makeBlock('new', 0, 0, 90, 50);
    const workspace = makeWorkspace([existing, inserted]);

    packNewBlocks(workspace, ['new']);

    // 120 + 150 = 270, plus the 80px gap.
    expect(inserted.position.x).toBe(350);
    expect(inserted.position.y).toBe(40);
    expect(existing.position).toEqual({ x: 120, y: 200 });
  });

  test('a second batch lands right of the first batch', () => {
    const first = makeBlock('a', 0, 0, 100, 60);
    const workspace = makeWorkspace([first]);
    packNewBlocks(workspace, ['a']);

    const second = makeBlock('b', 0, 0, 100, 60);
    workspace.getTopBlocks = () => [first, second];
    workspace.getBlockById = (id) => [first, second].find((block) => block.id === id) || null;

    packNewBlocks(workspace, ['b']);

    expect(first.position.x).toBe(40);
    expect(second.position.x).toBe(220);
  });

  test('ignores missing blocks and empty input', () => {
    const workspace = makeWorkspace([]);
    expect(packNewBlocks(workspace, [])).toEqual([]);
    expect(packNewBlocks(workspace, ['ghost'])).toEqual([]);
    expect(packNewBlocks(null, ['a'])).toEqual([]);
  });
});
