/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import { buildBlockPreview } from '../../../src/addons/addons/astras-copilot/agent/block-preview';

const makeVm = () => {
  const stage = {
    id: 'stage',
    name: 'Stage',
    isStage: true,
    variables: {},
    getName: () => 'Stage'
  };
  const sprite = {
    id: 'sprite',
    name: 'Sprite1',
    isStage: false,
    variables: {},
    getName: () => 'Sprite1',
    runtime: { getTargetForStage: () => stage }
  };
  return {
    runtime: {
      targets: [stage, sprite],
      getTargetForStage: () => stage,
      getEditingTarget: () => sprite,
      getTargetById: (id) => (id === 'sprite' ? sprite : id === 'stage' ? stage : null)
    }
  };
};

describe('Block preview compilation', () => {
  test('compiles Scrathon into scratch-blocks XML for the requested target', () => {
    const vm = makeVm();
    const source = ['@when_flag_clicked', 'def main():', '    move(${v:local:"speed"})', ''].join('\n');
    const preview = buildBlockPreview(vm, 'Sprite1', source);
    expect(preview.target.getName()).toBe('Sprite1');
    expect(preview.xml).toContain('type="motion_movesteps"');
    expect(preview.xml).toContain('type="data_variable"');
    expect(preview.declarations).toEqual([expect.objectContaining({ name: 'speed', isLocal: true })]);
  });

  test('falls back to the target declared inside the source', () => {
    const vm = makeVm();
    const source = ['target "Sprite1"', '@when_flag_clicked', 'def main():', '    say(${s:"hi"})', ''].join('\n');
    const preview = buildBlockPreview(vm, '', source);
    expect(preview.target.getName()).toBe('Sprite1');
    expect(preview.xml).toContain('type="looks_say"');
  });

  test('rejects empty source', () => {
    expect(() => buildBlockPreview(makeVm(), 'Sprite1', '   ')).toThrow(/No code to preview/);
  });
});
