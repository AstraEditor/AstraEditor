/**
 * @jest-environment node
 */
/* eslint-env jest */
import { createScratchTools } from '../../../src/addons/addons/astras-copilot/agent/tools';
import { setApplier } from '../../../src/addons/addons/astras-copilot/agent/writer';

/**
 * Build a VM with one sprite that owns a couple of costumes.
 * @returns {object} Fake VM.
 */
const makeVm = () => {
  const costumes = [
    {
      name: 'costume1',
      assetId: 'asset-1',
      dataFormat: 'svg',
      rotationCenterX: 48,
      rotationCenterY: 50,
      bitmapResolution: 1,
      skinId: 11
    },
    { name: 'costume2', assetId: 'asset-2', dataFormat: 'png', bitmapResolution: 2, skinId: 12 }
  ];

  const target = {
    id: 'sprite-1',
    isStage: false,
    currentCostume: 0,
    getName: () => 'Cat',
    getCostumes: () => costumes,
    renameCostume: (index, name) => {
      costumes[index].name = name;
    },
    setCostume: (index) => {
      target.currentCostume = index;
    },
    deleteCostume: (index) => {
      if (costumes.length <= 1) return null;
      return costumes.splice(index, 1)[0] || null;
    }
  };

  const state = { editing: target };

  return {
    editingTarget: target,
    state,
    runtime: {
      targets: [target],
      getEditingTarget: () => state.editing,
      getTargetById: (id) => (id === 'sprite-1' ? target : null),
      getProjectId: () => 'project-abc'
    },
    renderer: {
      getSkinSize: (skinId) => (skinId === 11 ? [96, 100] : [64, 64])
    },
    renameSprite: jest.fn(),
    duplicateSprite: jest.fn(() => Promise.resolve()),
    deleteSprite: jest.fn()
  };
};

describe('costume and sprite tools', () => {
  let vm;
  let tools;
  let captured;

  beforeEach(() => {
    vm = makeVm();
    tools = createScratchTools(vm);
    captured = null;
    setApplier(async (xml, meta) => {
      captured = { xml, meta };
      // Mirror what applyWrite does in the editor so the tools see real state.
      if (meta.updateCostume) {
        const target = vm.runtime.getTargetById(meta.targetId);
        if (meta.updateCostume.newName) target.renameCostume(meta.updateCostume.index, meta.updateCostume.newName);
        if (meta.updateCostume.setCurrent) target.setCostume(meta.updateCostume.index);
      }
      if (meta.deleteCostume) {
        vm.runtime.getTargetById(meta.targetId).deleteCostume(meta.deleteCostume.index);
      }
      if (meta.createSprite) await vm.duplicateSprite(meta.createSprite.fromTargetId);
      if (meta.deleteSprite) vm.deleteSprite(meta.deleteSprite.targetId);
      return { blockIds: [] };
    });
  });

  afterEach(() => {
    setApplier(null);
  });

  test('list_costumes reports metadata and the visible costume', () => {
    const result = tools.list_costumes({});
    expect(result.target).toEqual({ name: 'Cat', isStage: false });
    expect(result.currentIndex).toBe(0);
    expect(result.costumes).toHaveLength(2);
    expect(result.costumes[0]).toMatchObject({
      index: 0,
      name: 'costume1',
      assetId: 'asset-1',
      dataFormat: 'svg',
      rotationCenterX: 48,
      rotationCenterY: 50,
      current: true,
      size: { width: 96, height: 100 }
    });
    expect(result.costumes[1]).toMatchObject({ name: 'costume2', current: false });
  });

  test('update_costume resolves a costume by name and tags the project id', async () => {
    const result = await tools.update_costume({ name: 'costume2', newName: 'Happy', setCurrent: true });
    expect(captured.meta.updateCostume).toEqual({ index: 1, newName: 'Happy', setCurrent: true });
    expect(captured.meta.targetId).toBe('sprite-1');
    expect(captured.meta.projectId).toBe('project-abc');
    expect(result.costume.name).toBe('Happy');
  });

  test('update_costume rejects empty changes and unknown names', async () => {
    await expect(tools.update_costume({ name: 'costume1' })).rejects.toThrow('Nothing to change');
    await expect(tools.update_costume({ name: 'nope', newName: 'x' })).rejects.toThrow('No costume named');
    await expect(tools.update_costume({ index: 9, newName: 'x' })).rejects.toThrow('No costume at index');
  });

  test('delete_costume keeps at least one costume', async () => {
    vm.editingTarget.getCostumes().pop();
    await expect(tools.delete_costume({ index: 0 })).rejects.toThrow('at least one costume');

    vm = makeVm();
    tools = createScratchTools(vm);
    await tools.delete_costume({ name: 'costume2' });
    expect(captured.meta.deleteCostume).toEqual({ index: 1 });
  });

  test('create_sprite duplicates the source and renames the copy', async () => {
    const copy = { id: 'sprite-2', getName: () => 'Cat copy' };
    vm.duplicateSprite.mockImplementation(() => {
      vm.state.editing = copy;
      return Promise.resolve();
    });

    const result = await tools.create_sprite({ from: 'Cat', name: 'Dog' });
    // The rename is applied by applyWrite in the editor; the tool only tags it.
    expect(captured.meta.createSprite).toEqual({ fromTargetId: 'sprite-1', name: 'Dog' });
    expect(vm.duplicateSprite).toHaveBeenCalledWith('sprite-1');
    expect(result.sprite).toEqual({ name: 'Cat copy', isStage: false });
  });

  test('create_sprite refuses the stage and delete_sprite refuses the stage', async () => {
    vm.runtime.getTargetById = () => ({ id: 'stage', isStage: true, getName: () => 'Stage' });
    await expect(tools.create_sprite({ from: 'Stage' })).rejects.toThrow('stage cannot be duplicated');
    await expect(tools.delete_sprite({ target: 'Stage' })).rejects.toThrow('stage cannot be deleted');
  });

  test('delete_sprite deletes the requested sprite', async () => {
    const result = await tools.delete_sprite({ target: 'Cat' });
    expect(captured.meta.deleteSprite).toEqual({ targetId: 'sprite-1' });
    expect(vm.deleteSprite).toHaveBeenCalledWith('sprite-1');
    expect(result.deleted).toBe('Cat');
  });
});
