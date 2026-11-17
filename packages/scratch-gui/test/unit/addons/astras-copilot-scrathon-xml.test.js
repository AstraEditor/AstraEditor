/**
 * @jest-environment node
 */
/* eslint-env jest */
import { JSDOM } from 'jsdom';

import { parse } from '../../../src/addons/addons/astras-copilot/agent/scrathon/parser';
import { compileFile } from '../../../src/addons/addons/astras-copilot/agent/scrathon/compiler';
import { createDecompiler } from '../../../src/addons/addons/astras-copilot/agent/scrathon/decompiler';
import { buildScriptsXml } from '../../../src/addons/addons/astras-copilot/agent/block-xml';

/**
 * Context the XML writer needs; every field resolves to itself.
 * @returns {object} Context.
 */
const makeCtx = () => ({
  defaultCostume: 'costume1',
  defaultBackdrop: 'backdrop1',
  defaultSound: '',
  resolveField: (fieldName, name) => name,
  resolveMenu: (opcode, name, value) => value
});

/**
 * Parse generated XML into a document.
 * @param {string} xml XML string.
 * @returns {object} Document.
 */
const parseXml = (xml) => {
  const { window } = new JSDOM('');
  return new window.DOMParser().parseFromString(xml, 'application/xml');
};

/**
 * Convert generated XML into the VM block shape the decompiler reads.
 *
 * Only the subset the writer emits is supported: fields, value/statement
 * children, next, and mutations. Good enough to exercise the real pipeline
 * without pulling Blockly or the VM into a unit test.
 *
 * @param {string} xml XML string.
 * @returns {{blocks: object, roots: Array<string>}} Blocks and top-level ids.
 */
const xmlToVmBlocks = (xml) => {
  const doc = parseXml(xml);
  const blocks = {};
  const roots = [];
  let counter = 0;

  /**
   * Walk one block or shadow element.
   * @param {object} element Element.
   * @param {?string} parentId Parent block id.
   * @returns {string} Block id.
   */
  const addBlock = (element, parentId) => {
    const id = element.getAttribute('id') || `auto-${++counter}`;
    const shadow = element.tagName === 'shadow';
    const block = {
      id,
      opcode: element.getAttribute('type'),
      parent: parentId || null,
      shadow,
      topLevel: !parentId,
      next: null,
      inputs: {},
      fields: {}
    };
    blocks[id] = block;
    if (!parentId) roots.push(id);

    for (const child of Array.from(element.children)) {
      if (child.tagName === 'field') {
        const name = child.getAttribute('name');
        block.fields[name] = { name, value: child.textContent };
      } else if (child.tagName === 'value' || child.tagName === 'statement') {
        const name = child.getAttribute('name');
        const shadowEl = Array.from(child.children).find((node) => node.tagName === 'shadow');
        const blockEl = Array.from(child.children).find((node) => node.tagName === 'block');
        const shadowId = shadowEl ? addBlock(shadowEl, id) : null;
        const blockId = blockEl ? addBlock(blockEl, id) : null;
        block.inputs[name] = { block: blockId || shadowId, shadow: shadowId };
      } else if (child.tagName === 'next') {
        const inner = Array.from(child.children).find((node) => node.tagName === 'block');
        if (inner) block.next = addBlock(inner, id);
      } else if (child.tagName === 'mutation') {
        block.mutation = {};
        for (const attr of Array.from(child.attributes)) block.mutation[attr.name] = attr.value;
      }
    }
    return id;
  };

  for (const element of Array.from(doc.documentElement.children)) {
    if (element.tagName === 'block') addBlock(element, null);
  }
  return { blocks, roots };
};

const source = [
  '@custom_block("awa ${s:qwq} ${b:awaw} qwqq ${s:awaawa}", warp=True)',
  'def awa(${s:qwq}, ${b:awaw}, ${s:awaawa}):',
  '    if ${b:awaw}:',
  '        repeat(${n:qwq}):',
  '            wait(${n:awaawa})',
  '    else:',
  '        repeat(${n:awaawa}):',
  '            wait(${n:qwq})',
  ''
].join('\n');

describe('XML structure', () => {
  const { xml } = buildScriptsXml(compileFile(parse(source)).scripts, makeCtx());

  test('the root only holds complete scripts', () => {
    const doc = parseXml(xml);
    const topLevelTags = Array.from(doc.documentElement.children).map((node) => node.tagName);
    expect(topLevelTags).toEqual(['block']);
  });

  test('every input carries at most one shadow and one block', () => {
    const doc = parseXml(xml);
    const inputs = Array.from(doc.querySelectorAll('value, statement'));
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const tags = Array.from(input.children).map((node) => node.tagName);
      expect(tags.filter((tag) => tag === 'shadow').length).toBeLessThanOrEqual(1);
      expect(tags.filter((tag) => tag === 'block').length).toBeLessThanOrEqual(1);
    }
  });

  test('wait and repeat use the shadow types scratch-blocks declares', () => {
    const doc = parseXml(xml);
    const shadowTypes = Array.from(doc.querySelectorAll('shadow')).map((node) => node.getAttribute('type'));
    expect(shadowTypes).toEqual(expect.arrayContaining(['math_positive_number', 'math_whole_number']));
    // The whole-number shadow must never sit on control_wait's DURATION input.
    for (const wait of Array.from(doc.querySelectorAll('block[type="control_wait"]'))) {
      const duration = Array.from(wait.children).find((node) => node.getAttribute('name') === 'DURATION');
      expect(duration).toBeTruthy();
      const shadow = Array.from(duration.children).find((node) => node.tagName === 'shadow');
      expect(shadow.getAttribute('type')).toBe('math_positive_number');
    }
  });
});

describe('compile -> xml -> vm blocks -> decompile', () => {
  test('the reported snippet round-trips without unsupported blocks', () => {
    const { xml } = buildScriptsXml(compileFile(parse(source)).scripts, makeCtx());
    const { blocks, roots } = xmlToVmBlocks(xml);

    const target = {
      id: 'target-1',
      name: 'Sprite1',
      blocks: { _blocks: blocks },
      getName: () => 'Sprite1'
    };
    const rootId = roots.find((id) => blocks[id].opcode === 'procedures_definition') || roots[0];
    const { code } = createDecompiler(null, target).script(rootId);

    expect(code).not.toContain('# unsupported block');
    // Parameters must survive as parameters, not degrade into variables.
    expect(code).toContain('${b:awaw}');
    expect(code).toContain('repeat(${n:qwq})');
    expect(code).not.toContain('${v:');
    expect(code).toContain('@custom_block');
    expect(code).toContain('def awa');
    expect(code).toContain('repeat(');
    expect(code).toContain('wait(');
  });

  test('the decompiled text compiles again with the same block types', () => {
    const { xml } = buildScriptsXml(compileFile(parse(source)).scripts, makeCtx());
    const { blocks, roots } = xmlToVmBlocks(xml);
    const target = {
      id: 'target-1',
      name: 'Sprite1',
      blocks: { _blocks: blocks },
      getName: () => 'Sprite1'
    };
    const rootId = roots.find((id) => blocks[id].opcode === 'procedures_definition') || roots[0];
    const { code } = createDecompiler(null, target).script(rootId);

    const recompiled = compileFile(parse(code)).scripts;
    const { xml: xml2 } = buildScriptsXml(recompiled, makeCtx());

    const countTypes = (source) =>
      Array.from(parseXml(source).querySelectorAll('block')).reduce((acc, node) => {
        const type = node.getAttribute('type');
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

    const before = countTypes(xml);
    const after = countTypes(xml2);
    for (const [type, count] of Object.entries(before)) {
      expect(after[type]).toBe(count);
    }
  });
});
