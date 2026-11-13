/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import { JSDOM } from 'jsdom';
import { parse } from '../../../src/addons/addons/astras-copilot/agent/scrathon/parser';
import { compileFile } from '../../../src/addons/addons/astras-copilot/agent/scrathon/compiler';
import { buildScriptsXml } from '../../../src/addons/addons/astras-copilot/agent/block-xml';
import {
  nextBlockElement,
  patchScript,
  topLevelBlockElements
} from '../../../src/addons/addons/astras-copilot/agent/script-patcher';

// The repo's jsdom environment pulls in enzyme/undici, which needs TextDecoder.
// A standalone JSDOM instance gives us DOMParser without touching global setup.
const { window: domWindow } = new JSDOM('<!doctype html><html><body></body></html>');
const parseXml = (source) => new domWindow.DOMParser().parseFromString(source, 'text/xml');

/** Name-resolution context for the XML compiler. */
const makeCtx = () => ({
  defaultCostume: 'costume1',
  defaultBackdrop: 'backdrop1',
  defaultSound: '',
  defaultBroadcast: '',
  resolveField(fieldName, name) {
    return { id: `id-${name}`, name: String(name), type: fieldName === 'LIST' ? 'list' : '' };
  },
  drainDeclarations: () => []
});

/**
 * Compile Scrathon source into workspace XML.
 * @param {string} code Scrathon source.
 * @returns {string} XML document.
 */
const compileToXml = (code) => {
  const compiled = compileFile(parse(code), {});
  return buildScriptsXml(compiled.scripts, makeCtx()).xml;
};

/**
 * Connection stub with the subset of the scratch-blocks API the patcher uses.
 * @param {object} owner Owning block.
 * @returns {object} Connection.
 */
const createConnection = (owner) => ({
  owner,
  target: null,
  shadow: null,
  targetBlock() {
    return this.target ? this.target.owner : null;
  },
  connect(other) {
    this.target = other;
    other.target = this;
  },
  disconnect() {
    const other = this.target;
    if (!other) return;
    this.target = null;
    other.target = null;
  },
  setShadowDom(element) {
    this.shadow = element;
  }
});

/**
 * Block stub.
 * @param {string} type Block type.
 * @param {string} id Block id.
 * @param {boolean} [shadow] Whether this is a shadow block.
 * @returns {object} Block.
 */
const createBlock = (type, id, shadow = false) => {
  const nextConnection = createConnection(null);
  const previousConnection = createConnection(null);
  const outputConnection = createConnection(null);
  const block = {
    type,
    id,
    disposed: false,
    fields: new Map(),
    inputs: new Map(),
    inputList: [],
    nextConnection,
    previousConnection,
    outputConnection,
    isShadow() {
      return shadow;
    },
    getField(name) {
      return this.fields.get(name) || null;
    },
    setFieldValue(value, name) {
      const field = this.fields.get(name);
      if (field) field.value = value;
    },
    getInput(name) {
      const connection = this.inputs.get(name);
      return connection ? { name, connection } : null;
    },
    getNextBlock() {
      return this.nextConnection.target ? this.nextConnection.target.owner : null;
    },
    getRelativeToSurfaceXY() {
      return { x: 0, y: 0 };
    },
    moveBy() {},
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      // Real Blockly unplugs the block (healStack=false) before disposing.
      if (this.previousConnection.target) this.previousConnection.disconnect();
      if (this.outputConnection.target) this.outputConnection.disconnect();
      for (const connection of this.inputs.values()) {
        const child = connection.targetBlock();
        if (child) {
          connection.disconnect();
          child.dispose();
        }
      }
      const next = this.getNextBlock();
      if (next) {
        this.nextConnection.disconnect();
        next.dispose();
      }
    }
  };
  nextConnection.owner = block;
  previousConnection.owner = block;
  outputConnection.owner = block;
  return block;
};

/**
 * Fake scratch-blocks namespace backed by a block tree built from XML.
 * @returns {object} Fake environment.
 */
const makeFakeBlockly = () => {
  const created = [];

  const buildFromElement = (element) => {
    const type = element.getAttribute('type');
    const shadow = element.nodeName.toLowerCase() === 'shadow';
    const block = createBlock(type, element.getAttribute('id') || `gen-${created.length}`, shadow);
    created.push(block);

    for (const child of Array.from(element.children)) {
      const tag = child.nodeName.toLowerCase();
      const name = child.getAttribute('name');
      if (tag === 'field') {
        const value = child.getAttribute('id') !== null ? child.getAttribute('id') : child.textContent;
        block.fields.set(name, {
          value,
          getValue() {
            return this.value;
          }
        });
      } else if (tag === 'value' || tag === 'statement') {
        const connection = createConnection(block);
        block.inputs.set(name, connection);
        block.inputList.push({ name, connection });
        const children = Array.from(child.children);
        const shadowElement = children.find((node) => node.nodeName.toLowerCase() === 'shadow') || null;
        const blockElement = children.find((node) => node.nodeName.toLowerCase() === 'block') || null;
        if (shadowElement) connection.setShadowDom(shadowElement);
        const primary = blockElement || shadowElement;
        if (primary) {
          const childBlock = buildFromElement(primary);
          connection.connect(tag === 'statement' ? childBlock.previousConnection : childBlock.outputConnection);
        }
      } else if (tag === 'next') {
        const nextElement = Array.from(child.children).find((node) => node.nodeName.toLowerCase() === 'block');
        if (nextElement) {
          const nextBlock = buildFromElement(nextElement);
          block.nextConnection.connect(nextBlock.previousConnection);
        }
      }
    }
    return block;
  };

  const xml = {
    textToDom: (source) => parseXml(source),
    domToBlock: (element) => buildFromElement(element),
    domToField_: (block, name, fieldElement) => {
      const field = block.getField(name);
      if (!field) return;
      const id = fieldElement.getAttribute('id');
      field.value = id !== null ? id : fieldElement.textContent;
    },
    blockToDom: () => domWindow.document.createElement('block')
  };

  const workspace = {
    blocks: new Map(),
    getBlockById(id) {
      return this.blocks.get(id) || null;
    }
  };

  /**
   * Build an existing script tree from XML and register it in the workspace.
   * @param {string} source XML.
   * @param {string} scriptId Script id to register under.
   * @returns {object} Root block.
   */
  const buildScript = (source, scriptId) => {
    const doc = xml.textToDom(source);
    const [rootElement] = topLevelBlockElements(doc);
    if (!rootElement) throw new Error('test XML has no root block');
    const root = buildFromElement(rootElement);
    root.id = scriptId;
    workspace.blocks.set(scriptId, root);
    return root;
  };

  return { Blockly: { Xml: xml }, created, workspace, buildScript };
};

/**
 * Run one patch.
 * @param {string} oldCode Existing script source.
 * @param {string} newCode Replacement source.
 * @returns {object} Environment, old root and stats.
 */
const runPatch = (oldCode, newCode) => {
  const env = makeFakeBlockly();
  const root = env.buildScript(compileToXml(oldCode), 'script-1');
  const stats = patchScript({
    Blockly: env.Blockly,
    workspace: env.workspace,
    scriptId: 'script-1',
    xml: compileToXml(newCode)
  });
  return { env, root, stats };
};

describe('XML helpers', () => {
  test('finds top-level blocks through the <xml> wrapper', () => {
    const doc = parseXml(
      '<xml xmlns="http://www.w3.org/1999/xhtml"><block type="a"><next><block type="b"/></next></block></xml>',
      'text/xml'
    );
    const roots = topLevelBlockElements(doc);
    expect(roots).toHaveLength(1);
    expect(roots[0].getAttribute('type')).toBe('a');
    expect(nextBlockElement(roots[0]).getAttribute('type')).toBe('b');
    expect(nextBlockElement(roots[0].querySelector('next block'))).toBeNull();
  });
});

describe('in-place script patching', () => {
  test('keeps the hat and existing blocks when only a field changes', () => {
    const { root, stats } = runPatch(
      ['@when_flag_clicked', 'def main():', '    move(${n:10})'].join('\n'),
      ['@when_flag_clicked', 'def main():', '    move(${n:20})'].join('\n')
    );

    expect(stats.replacedRoot).toBe(false);
    expect(stats.removed).toBe(0);
    expect(stats.created).toBe(0);
    expect(stats.reused).toBe(2);
    expect(root.disposed).toBe(false);

    const move = root.getNextBlock();
    expect(move.type).toBe('motion_movesteps');
    expect(move.disposed).toBe(false);
    const shadow = move.getInput('STEPS').connection.targetBlock();
    expect(shadow.getField('NUM').value).toBe('20');
  });

  test('appends only the new tail', () => {
    const { root, stats, env } = runPatch(
      ['@when_flag_clicked', 'def main():', '    move(${n:10})'].join('\n'),
      ['@when_flag_clicked', 'def main():', '    move(${n:10})', '    turn_right(${n:15})'].join('\n')
    );

    const move = root.getNextBlock();
    expect(move.type).toBe('motion_movesteps');
    expect(move.disposed).toBe(false);
    expect(stats.created).toBe(1);
    expect(stats.removed).toBe(0);
    expect(move.getNextBlock().type).toBe('motion_turnright');
    expect(env.created.some((block) => block.type === 'motion_turnright')).toBe(true);
  });

  test('removes only the trailing blocks', () => {
    const env = makeFakeBlockly();
    const root = env.buildScript(
      compileToXml(
        ['@when_flag_clicked', 'def main():', '    move(${n:10})', '    turn_right(${n:15})'].join('\n')
      ),
      'script-1'
    );
    const move = root.getNextBlock();
    const turn = move.getNextBlock();
    const stats = patchScript({
      Blockly: env.Blockly,
      workspace: env.workspace,
      scriptId: 'script-1',
      xml: compileToXml(['@when_flag_clicked', 'def main():', '    move(${n:10})'].join('\n'))
    });

    expect(stats.removed).toBe(1);
    expect(stats.created).toBe(0);
    expect(move.disposed).toBe(false);
    expect(turn.disposed).toBe(true);
    expect(move.getNextBlock()).toBeNull();
  });

  test('rebuilds only from the first structural difference', () => {
    const env = makeFakeBlockly();
    const root = env.buildScript(
      compileToXml(
        ['@when_flag_clicked', 'def main():', '    move(${n:10})', '    turn_right(${n:15})', '    say(${s:"a"})'].join(
          '\n'
        )
      ),
      'script-1'
    );
    const move = root.getNextBlock();
    const oldTurn = move.getNextBlock();
    const oldSay = oldTurn.getNextBlock();

    const stats = patchScript({
      Blockly: env.Blockly,
      workspace: env.workspace,
      scriptId: 'script-1',
      xml: compileToXml(
        ['@when_flag_clicked', 'def main():', '    move(${n:10})', '    say(${s:"b"})', '    turn_right(${n:15})'].join('\n')
      )
    });

    expect(move.disposed).toBe(false);
    expect(oldTurn.disposed).toBe(true);
    expect(oldSay.disposed).toBe(true);
    expect(stats.created).toBe(1);
    expect(stats.removed).toBe(1);
    expect(move.getNextBlock().type).toBe('looks_say');
    expect(move.getNextBlock().getNextBlock().type).toBe('motion_turnright');
  });

  test('replaces the root only when the hat changed', () => {
    const { root, stats } = runPatch(
      ['@when_flag_clicked', 'def main():', '    move(${n:10})'].join('\n'),
      ['@when_this_sprite_clicked', 'def main():', '    move(${n:10})'].join('\n')
    );

    expect(stats.replacedRoot).toBe(true);
    expect(root.disposed).toBe(true);
    expect(stats.removed).toBe(1);
  });
});
