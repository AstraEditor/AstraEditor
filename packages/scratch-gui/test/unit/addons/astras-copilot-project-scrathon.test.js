/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import {
  applyScrathonEdits,
  getProjectScrathon,
  TOOL_DEFINITIONS,
  WRITE_TOOL_NAMES
} from '../../../src/addons/addons/astras-copilot/agent/tools';
import { buildProjectScrathonDocument } from '../../../src/addons/addons/astras-copilot/agent/project-scrathon';
import { setApplier } from '../../../src/addons/addons/astras-copilot/agent/writer';

const FLAG_SCRIPT = ['@when_flag_clicked', 'def main():', '    move(${n:10})'].join('\n');

/**
 * Build a fake VM with one sprite and one script.
 * @returns {object} VM.
 */
const makeVm = () => {
  const stage = {
    id: 'stage-1',
    isStage: true,
    getName: () => 'Stage',
    getCostumes: () => [],
    blocks: { _blocks: {} },
    variables: {}
  };
  const sprite = {
    id: 'sprite-1',
    isStage: false,
    getName: () => 'Sprite1',
    getCostumes: () => [],
    getSounds: () => [],
    blocks: {
      _blocks: {
        s1: {
          id: 's1',
          opcode: 'event_whenflagclicked',
          topLevel: true,
          next: null,
          inputs: {},
          fields: {}
        }
      }
    },
    variables: {}
  };
  const targets = [stage, sprite];
  return {
    runtime: {
      targets,
      getTargetById: (id) => targets.find((target) => target.id === id) || null,
      getTargetForStage: () => stage,
      getProjectId: () => 'project-abc'
    },
    extensionManager: null
  };
};

describe('whole-project Scrathon document', () => {
  test('renders every target with script ids and imports', () => {
    const result = buildProjectScrathonDocument({
      projectId: 'project-abc',
      targets: [
        {
          name: 'Stage',
          isStage: true,
          imports: [],
          scripts: []
        },
        {
          name: 'Sprite1',
          isStage: false,
          imports: ['pen'],
          scripts: [{ id: 's1', label: 'when green flag clicked', code: FLAG_SCRIPT }]
        }
      ]
    });

    expect(result.targets).toBe(2);
    expect(result.scripts).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.document).toContain('# project: project-abc');
    expect(result.document).toContain('## Stage (stage)');
    expect(result.document).toContain('# (no scripts)');
    expect(result.document).toContain('## Sprite1');
    expect(result.document).toContain('# imports: pen');
    expect(result.document).toContain('### s1 · when green flag clicked');
    expect(result.document).toContain('move(${n:10})');
    expect(result.document).toContain('apply_scrathon_edits');
  });

  test('truncates long projects and says so', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      name: `Sprite${index}`,
      isStage: false,
      imports: [],
      scripts: [{ id: `s${index}`, label: 'when green flag clicked', code: FLAG_SCRIPT }]
    }));
    const result = buildProjectScrathonDocument({ projectId: 'p', targets: many, maxChars: 900 });
    expect(result.truncated).toBe(true);
    expect(result.scripts).toBeLessThan(20);
    expect(result.document).toContain('[truncated]');
  });

  test('reads the document from a VM and filters by target', () => {
    const vm = makeVm();
    const all = getProjectScrathon(vm, {});
    expect(all.projectId).toBe('project-abc');
    expect(all.targets).toBe(2);
    expect(all.scripts).toBe(1);

    const spriteOnly = getProjectScrathon(vm, { target: 'sprite1' });
    expect(spriteOnly.targets).toBe(1);
    expect(spriteOnly.document).toContain('## Sprite1');
    expect(spriteOnly.document).not.toContain('## Stage');

    expect(() => getProjectScrathon(vm, { target: 'missing' })).toThrow(/not found/i);
  });

  test('exposes the read tool and the incremental edit tool', () => {
    const names = TOOL_DEFINITIONS.map((definition) => definition.function.name);
    expect(names).toContain('get_project_scrathon');
    expect(names).toContain('apply_scrathon_edits');
    expect(WRITE_TOOL_NAMES).toContain('apply_scrathon_edits');
    const readOnly = names.filter((name) => !WRITE_TOOL_NAMES.includes(name));
    expect(readOnly).toContain('get_project_scrathon');
  });
});

describe('incremental script edits', () => {
  let captured = null;

  beforeEach(() => {
    captured = null;
    setApplier(async (xml, meta) => {
      captured = { xml, meta };
      return { blockIds: ['new-1'], deleted: Array.isArray(meta.deleteScriptIds) ? meta.deleteScriptIds.length : 0 };
    });
  });

  afterEach(() => {
    setApplier(null);
  });

  test('replaces only the listed scripts and tags the project id', async () => {
    const vm = makeVm();
    const result = await applyScrathonEdits(vm, {
      target: 'Sprite1',
      edits: [{ scriptId: 's1', code: FLAG_SCRIPT }]
    });

    expect(result.ok).toBe(true);
    expect(result.replaced).toBe(1);
    expect(result.target).toEqual({ name: 'Sprite1', isStage: false });
    // In-place patching: the applier receives replacement documents instead of a
    // delete-then-append instruction.
    expect(captured.meta.deleteScriptIds).toBeUndefined();
    expect(captured.meta.replaceScripts).toHaveLength(1);
    expect(captured.meta.replaceScripts[0].scriptId).toBe('s1');
    expect(captured.meta.replaceScripts[0].xml).toContain('event_whenflagclicked');
    expect(captured.meta.targetId).toBe('sprite-1');
    expect(captured.meta.projectId).toBe('project-abc');
    expect(captured.xml).toBe('');
  });

  test('rejects unknown, duplicated and empty edits', async () => {
    const vm = makeVm();
    await expect(
      applyScrathonEdits(vm, { target: 'Sprite1', edits: [{ scriptId: 'nope', code: FLAG_SCRIPT }] })
    ).rejects.toThrow(/not a top-level script/i);

    await expect(
      applyScrathonEdits(vm, {
        target: 'Sprite1',
        edits: [
          { scriptId: 's1', code: FLAG_SCRIPT },
          { scriptId: 's1', code: FLAG_SCRIPT }
        ]
      })
    ).rejects.toThrow(/more than once/i);

    await expect(
      applyScrathonEdits(vm, { target: 'Sprite1', edits: [{ scriptId: 's1', code: '   ' }] })
    ).rejects.toThrow(/no code/i);

    await expect(applyScrathonEdits(vm, { target: 'Sprite1', edits: [] })).rejects.toThrow(/edits is required/i);
  });

  test('surfaces compile errors instead of applying', async () => {
    const vm = makeVm();
    await expect(
      applyScrathonEdits(vm, { target: 'Sprite1', edits: [{ scriptId: 's1', code: '@when_flag_clicked\nthis_is_not_a_block()' }] })
    ).rejects.toThrow();
    expect(captured).toBeNull();
  });
});
