/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import fs from 'fs';
import path from 'path';
import { SCRATHON_DOC } from '../../../src/addons/addons/astras-copilot/docs/scrathon-doc';
import { parse } from '../../../src/addons/addons/astras-copilot/agent/scrathon/parser';
import { compileFile } from '../../../src/addons/addons/astras-copilot/agent/scrathon/compiler';
import { createDecompiler } from '../../../src/addons/addons/astras-copilot/agent/scrathon/decompiler';
import { describeScrathonCatalog, FUNCTIONS } from '../../../src/addons/addons/astras-copilot/agent/scrathon/mappings';
import { SCRATHON_EXAMPLE } from '../../../src/addons/addons/astras-copilot/agent/scrathon/example';
import { buildScriptsXml } from '../../../src/addons/addons/astras-copilot/agent/block-xml';
import { ScrathonError } from '../../../src/addons/addons/astras-copilot/agent/scrathon/error';
import {
  createScratchTools,
  makeVarContext,
  prepareScrathonCodeAndExtensions,
  TOOL_DEFINITIONS
} from '../../../src/addons/addons/astras-copilot/agent/tools';

/**
 * A minimal stand-in for the VM-backed resolution context.
 * @param {object} [existing] Pre-declared variables/lists by name.
 * @returns {object} Context.
 */
const makeCtx = (existing = {}) => {
  const declared = [];
  const seen = new Map(Object.entries(existing));
  return {
    defaultCostume: 'costume1',
    defaultBackdrop: 'backdrop1',
    defaultSound: '',
    resolveField(fieldName, name, scope) {
      const isLocal = scope === 'local';
      const key = `${isLocal ? 'local' : 'global'}:${fieldName}:${name}`;
      if (!seen.has(key)) {
        seen.set(key, {
          id: `id-${String(name).replace(/\s+/g, '_')}`,
          name: String(name),
          type: fieldName === 'LIST' ? 'list' : fieldName === 'BROADCAST_OPTION' ? 'broadcast_msg' : ''
        });
        declared.push({ name: String(name), type: seen.get(key).type, id: seen.get(key).id, isLocal });
      }
      return seen.get(key);
    },
    drainDeclarations() {
      const out = declared.slice();
      declared.length = 0;
      return out;
    },
    defaultLiteralFor: () => ''
  };
};

/**
 * Minimal scratch-vm-like target for variable-scope tests.
 * @param {string} name Target name.
 * @param {boolean} isStage Whether this is the stage.
 * @param {Function} getStage Stage getter.
 * @returns {object} Target.
 */
const makeScratchTarget = (name, isStage, getStage) => ({
  name,
  isStage,
  variables: {},
  runtime: { getTargetForStage: getStage },
  getName() {
    return this.name;
  },
  lookupVariableByNameAndType(varName, varType, skipStage) {
    for (const variable of Object.values(this.variables)) {
      if (variable.name === varName && variable.type === varType) return variable;
    }
    if (!skipStage && !this.isStage) {
      const stage = this.runtime.getTargetForStage();
      for (const variable of Object.values(stage ? stage.variables : {})) {
        if (variable.name === varName && variable.type === varType) return variable;
      }
    }
    return null;
  }
});

/**
 * Parse + compile a snippet, returning the scripts array.
 * @param {string} source Scrathon source.
 * @param {object} [options] Compiler options.
 * @returns {Array<object>} Scripts.
 */
const compile = (source, options) => compileFile(parse(source), options).scripts;

/**
 * Capture the thrown ScrathonError from a snippet.
 * @param {string} source Scrathon source.
 * @returns {ScrathonError} Error.
 */
const compileError = (source) => {
  try {
    compile(source);
  } catch (error) {
    return error;
  }
  throw new Error('Expected a compile error.');
};

test('lexer rejects tab indentation', () => {
  expect(() => parse('@when_flag_clicked\ndef main():\n\tmove(${n:1})\n')).toThrow(ScrathonError);
});

test('parses a flag hat with a nested forever loop', () => {
  const scripts = compile(
    ['@when_flag_clicked', 'def main():', '    forever:', '        move(${n:5})', '        bounce_on_edge()', ''].join(
      '\n'
    )
  );
  expect(scripts).toHaveLength(1);
  const hat = scripts[0].blocks[0];
  expect(hat.opcode).toBe('event_whenflagclicked');
  expect(hat.next[0].opcode).toBe('control_forever');
  expect(hat.next[0].substack[0].opcode).toBe('motion_movesteps');
  expect(hat.next[0].substack[1].opcode).toBe('motion_ifonedgebounce');
});

test('compiles a typed numeric input and a boolean condition', () => {
  const scripts = compile(
    ['@when_flag_clicked', 'def main():', '    if ${b:hp < 20}:', '        say(${s:"low"})', ''].join('\n')
  );
  const block = scripts[0].blocks[0].next[0];
  expect(block.opcode).toBe('control_if');
  expect(block.inputs.CONDITION.opcode).toBe('operator_lt');
  expect(block.inputs.CONDITION.inputs.OPERAND2).toBe(20);
  expect(block.substack[0].opcode).toBe('looks_say');
});

test('compiles if/else into control_if_else', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:score >= 100}:',
      '        broadcast(${msg:"win"})',
      '    else:',
      '        change_var(${v:"score"}, ${n:10})',
      ''
    ].join('\n')
  );
  const block = scripts[0].blocks[0].next[0];
  expect(block.opcode).toBe('control_if_else');
  // `>=` has no dedicated Scratch block, so it lowers to `not (< ...)`.
  expect(block.inputs.CONDITION.opcode).toBe('operator_not');
  expect(block.substack[0].opcode).toBe('event_broadcast');
  expect(block.substack2[0].opcode).toBe('data_changevariableby');
});

test('compiles nested arithmetic expressions', () => {
  const scripts = compile(['@when_flag_clicked', 'def main():', '    move(${n:360 / sides})', ''].join('\n'));
  const move = scripts[0].blocks[0].next[0];
  expect(move.opcode).toBe('motion_movesteps');
  expect(move.inputs.STEPS.opcode).toBe('operator_divide');
  expect(move.inputs.STEPS.inputs.NUM2.opcode).toBe('data_variable');
});

test('a custom block definition and call share a proccode', () => {
  const result = compileFile(
    parse(
      [
        '@custom_block(warp=True)',
        'def dash(${n:distance}, ${b:invincible}):',
        '    move(${n:distance})',
        '',
        '@when_flag_clicked',
        'def main():',
        '    dash(${n:50}, ${b:True})',
        ''
      ].join('\n')
    )
  );
  const definition = result.scripts[0].blocks[0];
  const call = result.scripts[1].blocks[0].next[0];
  expect(definition.opcode).toBe('procedures_definition');
  expect(call.opcode).toBe('procedures_call');
  const defineMutation = JSON.parse(definition.mutation.argumentids);
  const callMutation = JSON.parse(call.mutation.argumentids);
  expect(callMutation).toEqual(defineMutation);
  expect(call.mutation.proccode).toBe(definition.mutation.proccode);
  // The parameter is read as an argument reporter inside the body.
  expect(definition.next[0].inputs.STEPS.opcode).toBe('argument_reporter_string_number');
});

test('type mismatch on a custom block argument is reported', () => {
  const error = compileError(
    [
      '@custom_block',
      'def dash(${n:distance}):',
      '    move(${n:distance})',
      '',
      '@when_flag_clicked',
      'def main():',
      '    dash(${s:"far"})',
      ''
    ].join('\n')
  );
  expect(error).toBeInstanceOf(ScrathonError);
  expect(error.type).toBe('TypeMismatchError');
});

test('unimported extension calls are rejected', () => {
  const error = compileError(['@when_flag_clicked', 'def main():', '    pen.penDown()', ''].join('\n'));
  expect(error.type).toBe('UnimportedModuleError');
});

test('unknown instructions are rejected', () => {
  const error = compileError(['@when_flag_clicked', 'def main():', '    fly(${n:1})', ''].join('\n'));
  expect(error.type).toBe('UnknownInstructionError');
});

test('colour sigil on a colour slot is accepted, number rejected', () => {
  const scripts = compile(['@when_flag_clicked', 'def main():', '    touching_color(${c:"#FF0000"})', ''].join('\n'));
  expect(scripts[0].blocks[0].next[0].opcode).toBe('sensing_touchingcolor');
  const error = compileError(['@when_flag_clicked', 'def main():', '    touching_color(${n:50})', ''].join('\n'));
  expect(error.type).toBe('TypeMismatchError');
});

test('the full compiled program emits loadable XML', () => {
  const source = [
    'import pen',
    '@when_flag_clicked',
    'def main():',
    '    set_var(${v:"score"}, ${n:0})',
    '    repeat(${n:10}):',
    '        move(${n:5})',
    '        turn_right(${n:360 / 10})',
    ''
  ].join('\n');
  const { scripts } = compileFile(parse(source));
  const { xml, scripts: count } = buildScriptsXml(scripts, makeCtx());
  expect(count).toBe(1);
  expect(xml).toContain('type="event_whenflagclicked"');
  expect(xml).toContain('type="control_repeat"');
  expect(xml).toContain('type="operator_divide"');
  expect(xml).toContain('variabletype=""');
  expect(xml.trim().endsWith('</xml>')).toBe(true);
});

/**
 * Build a VM-style `_blocks` map from a compiled descriptor tree. Used to feed
 * the decompiler, which reads the real VM block shape rather than descriptors.
 * @param {Array<object>} scripts Script descriptors.
 * @returns {object} `_blocks` map.
 */
const blocksFromScripts = (scripts) => {
  const blocks = {};
  let counter = 0;
  const nextId = () => `b${counter++}`;

  /** Default field name for a given shadow opcode. */
  const shadowField = (opcode) => {
    if (opcode === 'event_broadcast_menu') return 'BROADCAST_OPTION';
    if (opcode === 'colour_picker') return 'COLOUR';
    if (opcode === 'text') return 'TEXT';
    if (opcode === 'note') return 'NOTE';
    if (opcode === 'matrix') return 'MATRIX';
    return 'NUM';
  };

  const addShadow = (opcode, value, fieldName) => {
    const id = nextId();
    const field = fieldName || shadowField(opcode);
    blocks[id] = {
      id,
      opcode,
      next: null,
      parent: null,
      inputs: {},
      fields: { [field]: { name: field, value: String(value) } },
      shadow: true,
      topLevel: false
    };
    return id;
  };

  const addBlock = (descriptor, parentId) => {
    const id = nextId();
    blocks[id] = {
      id,
      opcode: descriptor.opcode,
      next: null,
      parent: parentId || null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false
    };
    if (descriptor.mutation) blocks[id].mutation = descriptor.mutation;
    for (const [name, value] of Object.entries(descriptor.fields || {})) {
      const fieldValue = value && typeof value === 'object' && typeof value.__name === 'string' ? value.__name : value;
      blocks[id].fields[name] = { name, value: fieldValue };
    }
    for (const [name, value] of Object.entries(descriptor.inputs || {})) {
      if (value && typeof value === 'object' && typeof value.opcode === 'string') {
        const childId = addBlock(value, id);
        blocks[id].inputs[name] = { block: childId, shadow: childId };
      } else if (value && typeof value === 'object' && typeof value.__shadow === 'string') {
        const shadowId = addShadow(value.__shadow, value.value, value.__field);
        blocks[id].inputs[name] = { block: shadowId, shadow: shadowId };
      } else if (typeof value === 'number') {
        const shadowId = addShadow('math_number', value);
        blocks[id].inputs[name] = { block: shadowId, shadow: shadowId };
      } else {
        const shadowId = addShadow('text', value === undefined || value === null ? '' : value);
        blocks[id].inputs[name] = { block: shadowId, shadow: shadowId };
      }
    }
    // A procedures_definition stores its signature on a procedures_prototype
    // shadow reachable through the `custom_block` input.
    if (descriptor.opcode === 'procedures_definition' && descriptor.mutation) {
      const prototypeId = nextId();
      blocks[prototypeId] = {
        id: prototypeId,
        opcode: 'procedures_prototype',
        next: null,
        parent: id,
        inputs: {},
        fields: {},
        mutation: descriptor.mutation,
        shadow: true,
        topLevel: false
      };
      blocks[id].inputs.custom_block = { block: prototypeId, shadow: prototypeId };
    }
    if (descriptor.substack && descriptor.substack.length > 0) {
      const childId = addStack(descriptor.substack, id);
      blocks[id].inputs.SUBSTACK = { block: childId, shadow: null };
    }
    if (descriptor.substack2 && descriptor.substack2.length > 0) {
      const childId = addStack(descriptor.substack2, id);
      blocks[id].inputs.SUBSTACK2 = { block: childId, shadow: null };
    }
    if (descriptor.next && descriptor.next.length > 0) {
      blocks[id].next = addStack(descriptor.next, parentId);
    }
    return id;
  };

  const addStack = (list, parentId) => {
    const ids = list.map((descriptor) => addBlock(descriptor, parentId));
    for (let i = 0; i < ids.length - 1; i++) blocks[ids[i]].next = ids[i + 1];
    return ids[0];
  };

  for (const script of scripts) {
    const id = addBlock(script.blocks[0], null);
    blocks[id].topLevel = true;
    blocks[id].x = script.x;
    blocks[id].y = script.y;
  }
  return blocks;
};

/** Build a fake target the decompiler can read. */
const makeTarget = (scripts) => ({
  id: 'target-1',
  name: 'Sprite1',
  blocks: { _blocks: blocksFromScripts(scripts) },
  getName: () => 'Sprite1'
});

test('decompiles a hat with a nested forever loop back to Scrathon', () => {
  const scripts = compile(
    ['@when_flag_clicked', 'def main():', '    forever:', '        move(${n:5})', '        bounce_on_edge()', ''].join(
      '\n'
    )
  );
  const { code } = createDecompiler(null, makeTarget(scripts)).script(
    Object.keys(makeTarget(scripts).blocks._blocks)[0]
  );
  expect(code).toContain('@when_flag_clicked');
  expect(code).toContain('def on_flag_clicked():');
  expect(code).toContain('forever():');
  expect(code).toContain('move(${n:5})');
  expect(code).toContain('bounce_on_edge()');
});

test('decompiles an if/else with a boolean condition', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:score >= 100}:',
      '        broadcast(${msg:"win"})',
      '    else:',
      '        change_var(${v:"score"}, ${n:10})',
      ''
    ].join('\n')
  );
  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('if ${b:not (score < 100)}:');
  expect(code).toContain('else:');
  expect(code).toContain('broadcast(${s:"win"})');
  expect(code).toContain('change_var(${v:"score"}, ${n:10})');
});

test('compiles elif into nested if/else blocks', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:score >= 100}:',
      '        say(${s:"A"})',
      '    elif ${b:score >= 50}:',
      '        say(${s:"B"})',
      '    elif ${b:score >= 10}:',
      '        say(${s:"C"})',
      '    else:',
      '        say(${s:"D"})',
      ''
    ].join('\n')
  );
  const outer = scripts[0].blocks[0].next[0];
  expect(outer.opcode).toBe('control_if_else');
  expect(outer.substack[0].inputs.MESSAGE).toBe('A');

  const second = outer.substack2[0];
  expect(second.opcode).toBe('control_if_else');
  expect(second.substack[0].inputs.MESSAGE).toBe('B');

  const third = second.substack2[0];
  expect(third.opcode).toBe('control_if_else');
  expect(third.substack[0].inputs.MESSAGE).toBe('C');
  expect(third.substack2[0].inputs.MESSAGE).toBe('D');
});

test('supports elif nested inside another if body', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:a}:',
      '        if ${b:b}:',
      '            say(${s:"inner-if"})',
      '        elif ${b:c}:',
      '            say(${s:"inner-elif"})',
      '        else:',
      '            say(${s:"inner-else"})',
      '    else:',
      '        say(${s:"outer-else"})',
      ''
    ].join('\n')
  );
  const outer = scripts[0].blocks[0].next[0];
  expect(outer.opcode).toBe('control_if_else');
  const inner = outer.substack[0];
  expect(inner.opcode).toBe('control_if_else');
  const innerElif = inner.substack2[0];
  expect(innerElif.opcode).toBe('control_if_else');
  expect(innerElif.substack2[0].inputs.MESSAGE).toBe('inner-else');
  expect(outer.substack2[0].inputs.MESSAGE).toBe('outer-else');
});

test('compiles elif without a final else into control_if', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:score > 10}:',
      '        say(${s:"A"})',
      '    elif ${b:score > 5}:',
      '        say(${s:"B"})',
      ''
    ].join('\n')
  );
  const outer = scripts[0].blocks[0].next[0];
  expect(outer.opcode).toBe('control_if_else');
  expect(outer.substack2[0].opcode).toBe('control_if');
});

test('rejects elif without a matching if', () => {
  const error = compileError(['elif ${b:True}:', '    say(${s:"x"})', ''].join('\n'));
  expect(error.type).toBe('SyntaxError');
  expect(error.message).toContain('"elif" without a matching "if"');
});

test('decompiles nested if/else chains back to elif', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    if ${b:score >= 100}:',
      '        say(${s:"A"})',
      '    elif ${b:score >= 50}:',
      '        say(${s:"B"})',
      '    elif ${b:score >= 10}:',
      '        say(${s:"C"})',
      '    else:',
      '        say(${s:"D"})',
      ''
    ].join('\n')
  );
  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('if ${b:not (score < 100)}:');
  expect(code).toContain('elif ${b:not (score < 50)}:');
  expect(code).toContain('elif ${b:not (score < 10)}:');
  expect(code).toContain('else:');
  expect(code).not.toContain('else:\n        if ');

  // The emitted elif syntax parses back into the same nested structure.
  const recompiled = compile(code);
  const outer = recompiled[0].blocks[0].next[0];
  expect(outer.opcode).toBe('control_if_else');
  expect(outer.substack2[0].opcode).toBe('control_if_else');
});

test('broadcasts use ${s} sigils and emit real broadcast-menu shadows', () => {
  const scripts = compile(['@when_flag_clicked', 'def main():', '    broadcast(${s:"win"})', ''].join('\n'));
  const { xml } = buildScriptsXml(scripts, makeCtx());
  expect(xml).toContain('<shadow type="event_broadcast_menu">');
  expect(xml).not.toContain('<block type="event_broadcast_menu">');
  expect(xml).toContain('<field name="BROADCAST_OPTION" id="id-win" variabletype="broadcast_msg">win</field>');

  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('broadcast(${s:"win"})');
  expect(code).not.toContain('${msg:');
});

test('broadcast inputs with reporter values round-trip through ${s}', () => {
  const scripts = compile(['@when_flag_clicked', 'def main():', '    broadcast(${s:${v:"message"}})', ''].join('\n'));
  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('broadcast(${s:message})');
  expect(code).not.toContain('${msg:');
});

test('legacy ${msg} broadcast sigils still emit shadows', () => {
  const scripts = compile(['@when_flag_clicked', 'def main():', '    broadcast(${msg:"win"})', ''].join('\n'));
  const { xml } = buildScriptsXml(scripts, makeCtx());
  expect(xml).toContain('<shadow type="event_broadcast_menu">');
  expect(xml).not.toContain('<block type="event_broadcast_menu">');
  expect(xml).toContain('<field name="BROADCAST_OPTION" id="id-win" variabletype="broadcast_msg">win</field>');
});

test('broadcast hats accept ${s} and resolve the broadcast id', () => {
  const scripts = compile(['@when_broadcast(${s:"start"})', 'def on_start():', '    hide()', ''].join('\n'));
  const { xml } = buildScriptsXml(scripts, makeCtx());
  expect(xml).toContain('type="event_whenbroadcastreceived"');
  expect(xml).toContain('<field name="BROADCAST_OPTION" id="id-start" variabletype="broadcast_msg">start</field>');

  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('@when_broadcast(${s:"start"})');
});

test('variable scope prefixes select local or global creation', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    set_var(${v:local:"hp"}, ${n:1})',
      '    set_var(${v:"score"}, ${n:0})',
      ''
    ].join('\n')
  );
  const first = scripts[0].blocks[0].next[0];
  const second = scripts[0].blocks[0].next[1];
  expect(first.fields.VARIABLE).toEqual({ __name: 'hp', __scope: 'local' });
  expect(second.fields.VARIABLE).toBe('score');

  const ctx = makeCtx();
  const { xml, declarations } = buildScriptsXml(scripts, ctx);
  expect(xml).toContain('<field name="VARIABLE" id="id-hp" variabletype="">hp</field>');
  expect(xml).toContain('<field name="VARIABLE" id="id-score" variabletype="">score</field>');
  expect(declarations).toEqual([
    { name: 'hp', type: '', id: 'id-hp', isLocal: true },
    { name: 'score', type: '', id: 'id-score', isLocal: false }
  ]);
});

test('list scope prefixes select local or global creation', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    list_add(${l:local:"backpack"}, ${s:"Potion"})',
      '    list_add(${l:"inventory"}, ${s:"Sword"})',
      ''
    ].join('\n')
  );
  const first = scripts[0].blocks[0].next[0];
  const second = scripts[0].blocks[0].next[1];
  expect(first.fields.LIST).toEqual({ __name: 'backpack', __scope: 'local' });
  expect(second.fields.LIST).toBe('inventory');
});

test('supports full-word variable and list sigils', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    set_var(${variable:"score"}, ${n:0})',
      '    list_add(${list:"inventory"}, ${s:"Sword"})',
      '    list_add(${list:local:"backpack"}, ${s:"Potion"})',
      '    set_var(${variable:local:"hp"}, ${n:100})',
      ''
    ].join('\n')
  );
  const first = scripts[0].blocks[0].next[0];
  const second = scripts[0].blocks[0].next[1];
  const third = scripts[0].blocks[0].next[2];
  const fourth = scripts[0].blocks[0].next[3];
  expect(first.fields.VARIABLE).toBe('score');
  expect(second.fields.LIST).toBe('inventory');
  expect(third.fields.LIST).toEqual({ __name: 'backpack', __scope: 'local' });
  expect(fourth.fields.VARIABLE).toEqual({ __name: 'hp', __scope: 'local' });
});

test('accepts variable and list reporters in typed value slots', () => {
  const scripts = compile(
    ['@when_flag_clicked', 'def main():', '    move(${v:local:"speed"})', '    say(${l:"inventory"})', ''].join('\n')
  );
  const move = scripts[0].blocks[0].next[0];
  const say = scripts[0].blocks[0].next[1];
  expect(move.inputs.STEPS).toEqual({
    opcode: 'data_variable',
    fields: { VARIABLE: { __name: 'speed', __scope: 'local' } }
  });
  expect(say.inputs.MESSAGE).toEqual({
    opcode: 'data_listcontents',
    fields: { LIST: 'inventory' }
  });
});

test('reporter inputs keep a default shadow so unplugging restores the input box', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    move(${v:local:"speed"})',
      '    say(${l:"inventory"})',
      '    touching_color(${v:"color"})',
      ''
    ].join('\n')
  );
  const { xml } = buildScriptsXml(scripts, makeCtx());
  const inputFragment = (name) => {
    const match = xml.match(new RegExp(`<value name="${name}">([\\s\\S]*?)</value>`));
    return match ? match[1] : '';
  };
  const steps = inputFragment('STEPS');
  expect(steps).toContain('<shadow type="math_number"><field name="NUM">0</field></shadow>');
  expect(steps).toContain('<block type="data_variable"');

  const message = inputFragment('MESSAGE');
  expect(message).toContain('<shadow type="text"><field name="TEXT"/></shadow>');
  expect(message).toContain('<block type="data_listcontents"');

  const color = inputFragment('COLOR');
  expect(color).toContain('<shadow type="colour_picker"><field name="COLOUR">#000000</field></shadow>');
  expect(color).toContain('<block type="data_variable"');
});

test('extension reporter inputs keep their typed shadow', () => {
  const scripts = compile(
    ['import pen', '@when_flag_clicked', 'def main():', '    pen.changePenSizeBy(${v:"delta"})', ''].join('\n')
  );
  const { xml } = buildScriptsXml(scripts, makeCtx());
  const match = xml.match(/<value name="SIZE">([\s\S]*?)<\/value>/);
  expect(match).not.toBeNull();
  expect(match[1]).toContain('<shadow type="math_number"><field name="NUM">0</field></shadow>');
  expect(match[1]).toContain('<block type="data_variable"');
});

test('rejects variables in boolean and dropdown slots', () => {
  const booleanError = compileError('wait_until(${v:"done"})');
  expect(booleanError.type).toBe('TypeMismatchError');
  expect(booleanError.message).toContain('boolean input');

  const menuError = compileError('set_effect(${v:"effect"}, ${n:25})');
  expect(menuError.type).toBe('TypeMismatchError');
  expect(menuError.message).toContain('dropdown menu');
});

test('rejects n:list and points to the explicit list sigil', () => {
  const error = compileError('list_add(${n:list"列表名"}, ${s:"x"})');
  expect(error.type).toBe('SyntaxError');
  expect(error.message).toContain('is the number tag');
  expect(error.message).toContain('${list:"name"}');
});

test('list type mismatches suggest both short and full-word sigils', () => {
  const error = compileError('list_add(${v:"inventory"}, ${s:"Sword"})');
  expect(error.type).toBe('TypeMismatchError');
  expect(error.message).toContain('${l:...} or ${list:...}');
  expect(error.message).toContain('${v:...} or ${variable:...}');
});

test('scope prefixes are rejected on non-variable sigils', () => {
  const error = compileError('say(${n:local:"hp"})');
  expect(error.type).toBe('SyntaxError');
  expect(error.message).toContain('only valid for variable and list sigils');
});

test('decompiler emits direct resource sigils inside typed slots', () => {
  const scripts = compile(
    ['@when_flag_clicked', 'def main():', '    move(${v:local:"speed"})', '    say(${l:local:"inventory"})', ''].join(
      '\n'
    )
  );
  const target = makeTarget(scripts);
  const localVar = { id: 'var-local-speed', name: 'speed', type: '' };
  const localList = { id: 'list-local-inventory', name: 'inventory', type: 'list' };
  target.isStage = false;
  target.variables = {
    [localVar.id]: localVar,
    [localList.id]: localList
  };
  target.runtime = {
    getTargetForStage: () => ({ isStage: true, variables: {} })
  };
  for (const block of Object.values(target.blocks._blocks)) {
    if (block.fields.VARIABLE && block.fields.VARIABLE.value === 'speed') {
      block.fields.VARIABLE.id = localVar.id;
    }
    if (block.fields.LIST && block.fields.LIST.value === 'inventory') {
      block.fields.LIST.id = localList.id;
    }
  }
  const rootId = Object.values(target.blocks._blocks).find((block) => block.topLevel).id;
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('move(${v:local:"speed"})');
  expect(code).toContain('say(${l:local:"inventory"})');

  const recompiled = compile(code);
  expect(recompiled[0].blocks[0].next[0].inputs.STEPS).toEqual({
    opcode: 'data_variable',
    fields: { VARIABLE: { __name: 'speed', __scope: 'local' } }
  });
  expect(recompiled[0].blocks[0].next[1].inputs.MESSAGE).toEqual({
    opcode: 'data_listcontents',
    fields: { LIST: { __name: 'inventory', __scope: 'local' } }
  });
});

test('makeVarContext creates local variables on sprites and globals on the stage', () => {
  const stage = makeScratchTarget('Stage', true, () => stage);
  const sprite = makeScratchTarget('Sprite1', false, () => stage);
  const ctx = makeVarContext({ runtime: { getTargetForStage: () => stage } }, sprite);
  const local = ctx.resolveField('VARIABLE', 'hp', 'local');
  const global = ctx.resolveField('VARIABLE', 'score');
  expect(local.isLocal).toBe(true);
  expect(global.isLocal).toBe(false);
  expect(ctx.drainDeclarations()).toEqual([
    { id: expect.any(String), name: 'hp', type: '', isLocal: true },
    { id: expect.any(String), name: 'score', type: '', isLocal: false }
  ]);
});

test('local scope is rejected on the stage', () => {
  const stage = makeScratchTarget('Stage', true, () => stage);
  const ctx = makeVarContext({ runtime: { getTargetForStage: () => stage } }, stage);
  expect(() => ctx.resolveField('VARIABLE', 'hp', 'local')).toThrow(/on the stage/);
});

test('decompiler emits local scope for local variables and leaves globals unprefixed', () => {
  const scripts = compile(
    [
      '@when_flag_clicked',
      'def main():',
      '    set_var(${v:local:"hp"}, ${n:1})',
      '    set_var(${v:"score"}, ${n:0})',
      '    say(${s:${v:local:"hp"}})',
      ''
    ].join('\n')
  );
  const target = makeTarget(scripts);
  const localVar = { id: 'var-local-hp', name: 'hp', type: '' };
  const globalVar = { id: 'var-global-score', name: 'score', type: '' };
  target.isStage = false;
  target.variables = { [localVar.id]: localVar };
  target.runtime = {
    getTargetForStage: () => ({ isStage: true, variables: { [globalVar.id]: globalVar } })
  };
  for (const block of Object.values(target.blocks._blocks)) {
    if (!block.fields || !block.fields.VARIABLE) continue;
    block.fields.VARIABLE.id = block.fields.VARIABLE.value === 'hp' ? localVar.id : globalVar.id;
  }
  const rootId = Object.values(target.blocks._blocks).find((block) => block.topLevel).id;
  const { code } = createDecompiler(null, target).script(rootId);
  expect(code).toContain('set_var(${v:local:"hp"}, ${n:1})');
  expect(code).toContain('set_var(${v:"score"}, ${n:0})');
  expect(code).toContain('say(${v:local:"hp"})');

  // The emitted local-scope syntax parses back into the same scoped descriptor.
  const recompiled = compile(code);
  expect(recompiled[0].blocks[0].next[0].fields.VARIABLE).toEqual({ __name: 'hp', __scope: 'local' });
});

test('procedure call XML applies the mutation before values and next', () => {
  const scripts = compile(
    [
      '@custom_block(warp=True)',
      'def draw(${n:size}, ${n:depth}):',
      '    move(${n:size})',
      '',
      '@when_flag_clicked',
      'def main():',
      '    draw(${n:400}, ${n:6})',
      '    hide()',
      ''
    ].join('\n')
  );
  const { xml } = buildScriptsXml(scripts, makeCtx());
  const callStart = xml.indexOf('<block type="procedures_call"');
  expect(callStart).toBeGreaterThanOrEqual(0);
  const callOpenEnd = xml.indexOf('>', callStart) + 1;
  expect(xml.slice(callOpenEnd, callOpenEnd + '<mutation'.length)).toBe('<mutation');
  const mutationEnd = xml.indexOf('/>', callOpenEnd);
  const valueIndex = xml.indexOf('<value name="draw-arg-0-size"', mutationEnd);
  const nextIndex = xml.indexOf('<next>', mutationEnd);
  expect(valueIndex).toBeGreaterThan(mutationEnd);
  expect(nextIndex).toBeGreaterThan(valueIndex);
});

test('decompiles a custom block definition and call', () => {
  const result = compileFile(
    parse(
      [
        '@custom_block(warp=True)',
        'def dash(${n:distance}):',
        '    move(${n:distance})',
        '',
        '@when_flag_clicked',
        'def main():',
        '    dash(${n:50})',
        ''
      ].join('\n')
    )
  );
  const target = makeTarget(result.scripts);
  const roots = Object.values(target.blocks._blocks)
    .filter((block) => block.topLevel)
    .map((block) => block.id);
  const definition = createDecompiler(null, target).script(roots[0]);
  const call = createDecompiler(null, target).script(roots[1]);
  expect(definition.code).toContain('@custom_block(warp=True)');
  expect(definition.code).toContain('def dash(${n:distance}):');
  expect(definition.code).toContain('move(${n:distance})');
  expect(call.code).toContain('dash(${n:50})');
});

test('round-trips a compiled program through the decompiler', () => {
  const source = [
    '@when_flag_clicked',
    'def main():',
    '    set_var(${v:"score"}, ${n:0})',
    '    repeat(${n:10}):',
    '        move(${n:5})',
    '        turn_right(${n:36})',
    ''
  ].join('\n');
  const { scripts } = compileFile(parse(source));
  const target = makeTarget(scripts);
  const rootId = Object.keys(target.blocks._blocks)[0];
  const { code } = createDecompiler(null, target).script(rootId);
  // Recompiling the decompiled source yields the same opcodes.
  const again = compile(code);
  const opcodes = (nodes) =>
    nodes.flatMap((node) => [
      node.opcode,
      ...(node.next ? opcodes(node.next) : []),
      ...(node.substack ? opcodes(node.substack) : [])
    ]);
  expect(opcodes(again[0].blocks)).toEqual(opcodes(scripts[0].blocks));
});

test('describeScrathonCatalog returns DSL signatures and categories', () => {
  const full = describeScrathonCatalog();
  expect(full.length).toBeGreaterThan(40);
  expect(full.every((b) => b.name && b.signature && b.category && b.kind)).toBe(true);

  const motion = describeScrathonCatalog('motion');
  expect(motion.some((b) => b.name === 'move' && b.signature.includes('move(${n:steps})'))).toBe(true);

  const turn = describeScrathonCatalog('turn');
  expect(turn.some((b) => b.name === 'turn_right')).toBe(true);
  expect(turn.some((b) => b.name === 'turn_left')).toBe(true);

  const flag = describeScrathonCatalog('flag');
  expect(flag.some((b) => b.name === '@when_flag_clicked')).toBe(true);
});

test('compiler tolerates common LLM aliases, casing variations, and opcode names', () => {
  const source = [
    '@when_green_flag_clicked',
    'def main():',
    '    set_variable(${v:"score"}, ${n:10})',
    '    turnRight(${n:15})',
    '    wait_seconds(${n:1})',
    '    motion_movesteps(${n:10})',
    ''
  ].join('\n');

  const scripts = compile(source);
  expect(scripts[0].blocks[0].opcode).toBe('event_whenflagclicked');
  expect(scripts[0].blocks[0].next[0].opcode).toBe('data_setvariableto');
  expect(scripts[0].blocks[0].next[1].opcode).toBe('motion_turnright');
  expect(scripts[0].blocks[0].next[2].opcode).toBe('control_wait');
  expect(scripts[0].blocks[0].next[3].opcode).toBe('motion_movesteps');
});

test('built-in extension compilation and catalog search for pen', () => {
  const penCatalog = describeScrathonCatalog('pen');
  expect(penCatalog.some((b) => b.name === 'pen.clear' && b.signature.includes('import pen'))).toBe(true);
  expect(penCatalog.some((b) => b.name === 'pen.penDown')).toBe(true);

  // Compile with explicit import
  const source = [
    'import pen',
    '@when_flag_clicked',
    'def main():',
    '    pen.clear()',
    '    pen.pendown()', // test case-insensitivity
    ''
  ].join('\n');
  const compiled = compileFile(parse(source));
  expect(compiled.scripts[0].blocks[0].next[0].opcode).toBe('pen_clear');
  expect(compiled.scripts[0].blocks[0].next[1].opcode).toBe('pen_penDown');
});

test('prepareScrathonCodeAndExtensions auto-prepends missing extension imports', async () => {
  const codeWithoutImport = ['@when_flag_clicked', 'def main():', '    pen.clear()', '    pen.penDown()', ''].join(
    '\n'
  );

  const loadedExtensions = [];
  const fakeVm = {
    extensionManager: {
      isExtensionLoaded: (ext) => loadedExtensions.includes(ext),
      loadExtensionURL: (ext) => {
        loadedExtensions.push(ext);
        return Promise.resolve();
      }
    }
  };

  const prepared = await prepareScrathonCodeAndExtensions(fakeVm, codeWithoutImport);
  expect(prepared).toContain('import pen');
  expect(loadedExtensions).toContain('pen');

  // Should compile cleanly now
  const compiled = compileFile(parse(prepared));
  expect(compiled.scripts[0].blocks[0].next[0].opcode).toBe('pen_clear');
});

test('extension menus accept variable reporters only when acceptReporters is set', () => {
  const makeVm = (acceptReporters) => ({
    runtime: {
      _blockInfo: [
        {
          id: 'demo',
          menuInfo: { CHOICE: { acceptReporters, items: ['a', 'b'] } },
          blocks: [{ info: { opcode: 'pick', arguments: { CHOICE: { type: 'menu' } } } }]
        }
      ]
    }
  });
  const source = ['import demo', '@when_flag_clicked', 'def main():', '    demo.pick(${v:"choice"})', ''].join('\n');

  const result = compileFile(parse(source), { vm: makeVm(true) });
  expect(result.scripts[0].blocks[0].next[0].inputs.CHOICE).toMatchObject({
    opcode: 'data_variable',
    fields: { VARIABLE: 'choice' },
    __defaultShadow: 'demo_menu_CHOICE'
  });

  let error = null;
  try {
    compileFile(parse(source), { vm: makeVm(false) });
  } catch (compileFailure) {
    error = compileFailure;
  }
  expect(error).not.toBeNull();
  expect(error.type).toBe('TypeMismatchError');
  expect(error.message).toContain('Menu argument');
});

test('compile user extension snippet', () => {
  const code = [
    'import pen',
    'import music',
    '@when_flag_clicked',
    'def main():',
    '    pen.clear()',
    '    pen.penUp()',
    '    go_to_xy(${n:0}, ${n:0})',
    '    point_in_direction(${n:90})',
    '    pen.setPenSizeTo(${n:3})',
    '    pen.setPenColorToColor(${c:"#FF4081"})',
    '    music.setInstrument(${m:"1"})',
    '    music.setTempo(${n:120})',
    '    pen.penDown()',
    '    repeat(${n:8}):',
    '        move(${n:60})',
    '        turn_right(${n:45})',
    '        pen.changePenColorParamBy(${m:"color"}, ${n:12})',
    '        music.playNoteForBeats(${n:60}, ${n:0.25})',
    '    pen.penUp()'
  ].join('\n');
  const compiled = compileFile(parse(code));
  expect(compiled.scripts.length).toBe(1);

  // Test decompilation of extension blocks
  const target = makeTarget(compiled.scripts);
  const decompiler = createDecompiler(null, target);
  const fileResult = decompiler.file();
  expect(fileResult.code).toContain('import pen');
  expect(fileResult.code).toContain('import music');
  expect(fileResult.code).toContain('pen.clear()');
  expect(fileResult.code).toContain('pen.setPenColorToColor(${c:"#FF4081"})');
  expect(fileResult.code).toContain('music.setInstrument(${m:"1"})');
  expect(fileResult.code).toContain('music.setTempo(${n:120})');
  expect(fileResult.code).toContain('pen.changePenColorParamBy(${m:"color"}, ${n:12})');
  expect(fileResult.code).toContain('music.playNoteForBeats(${n:60}, ${n:0.25})');
  expect(fileResult.code).not.toContain('unsupported');
});

test('music note inputs compile into note shadows and round-trip', () => {
  const source = [
    'import music',
    '@when_flag_clicked',
    'def main():',
    '    music.playNoteForBeats(${n:60}, ${n:0.25})',
    ''
  ].join('\n');

  const compiled = compileFile(parse(source));
  const playNote = compiled.scripts[0].blocks[0].next[0];
  expect(playNote.opcode).toBe('music_playNoteForBeats');
  expect(playNote.inputs.NOTE).toEqual({ __shadow: 'note', value: 60 });

  const xmlResult = buildScriptsXml(compiled.scripts, makeCtx());
  expect(xmlResult.xml).toContain('<shadow type="note">');
  expect(xmlResult.xml).toContain('<field name="NOTE">60</field>');
  expect(xmlResult.xml).not.toContain('<field name="TEXT">60</field>');

  // Decompiling the generated blocks yields the numeric note sigil again.
  const decompiled = createDecompiler(null, makeTarget(compiled.scripts)).file();
  expect(decompiled.code).toContain('music.playNoteForBeats(${n:60}, ${n:0.25})');

  // Recompiling keeps the note shadow (and therefore the piano-keyboard field).
  const recompiled = compileFile(parse(decompiled.code));
  expect(recompiled.scripts[0].blocks[0].next[0].inputs.NOTE).toEqual({ __shadow: 'note', value: 60 });
});

test('all FUNCTIONS round-trip cleanly through compiler and decompiler', () => {
  const sampleArg = (arg) => {
    if (arg.t === 'n') return '${n:10}';
    if (arg.t === 's') return '${s:"hello"}';
    if (arg.t === 'b') return '${b:True}';
    if (arg.t === 'c') return '${c:"#FF0000"}';
    if (arg.t === 'm') return '${m:"opt"}';
    if (arg.t === 'v') return '${v:"myVar"}';
    if (arg.t === 'l') return '${l:"myList"}';
    if (arg.t === 'msg') return '${msg:"myMsg"}';
    return '${s:""}';
  };

  const failures = [];
  for (const [name, fn] of Object.entries(FUNCTIONS)) {
    const args = (fn.args || []).map(sampleArg).join(', ');
    const code = ['@when_flag_clicked', 'def main():', `    ${name}(${args})`, ''].join('\n');
    try {
      const parsed = parse(code);
      const compiled = compileFile(parsed);
      const target = makeTarget(compiled.scripts);
      const decompiled = createDecompiler(null, target).file();
      expect(decompiled.code).not.toContain('unsupported');
      expect(decompiled.code).not.toContain('import data');
      expect(decompiled.code).not.toContain('import operator');
      const reCompiled = compileFile(parse(decompiled.code));
      expect(reCompiled.scripts.length).toBe(1);
    } catch (err) {
      failures.push({ name, error: err.message });
    }
  }
  if (failures.length > 0) {
    console.error('Round-trip failures:', failures);
  }
  expect(failures).toEqual([]);
});

test('all FUNCTIONS compile and generate valid XML', () => {
  const sampleArg = (arg) => {
    if (arg.t === 'n') return '${n:10}';
    if (arg.t === 's') return '${s:"hello"}';
    if (arg.t === 'b') return '${b:True}';
    if (arg.t === 'c') return '${c:"#FF0000"}';
    if (arg.t === 'm') return '${m:"opt"}';
    if (arg.t === 'v') return '${v:"myVar"}';
    if (arg.t === 'l') return '${l:"myList"}';
    if (arg.t === 'msg') return '${msg:"myMsg"}';
    return '${s:""}';
  };

  const failures = [];
  for (const [name, fn] of Object.entries(FUNCTIONS)) {
    const args = (fn.args || []).map(sampleArg).join(', ');
    const code = ['@when_flag_clicked', 'def main():', `    ${name}(${args})`, ''].join('\n');
    try {
      const parsed = parse(code);
      const compiled = compileFile(parsed);
      const ctx = makeCtx();
      const xmlResult = buildScriptsXml(compiled.scripts, ctx);
      expect(xmlResult.xml).toContain('<xml');
      expect(xmlResult.xml).toContain('</xml>');
    } catch (err) {
      failures.push({ name, error: err.message });
    }
  }
  expect(failures).toEqual([]);
});

test('plain def without decorator compiles into a connected top-level script', () => {
  const source = ['def main():', '    move(${n:10})', '    turn_right(${n:15})', ''].join('\n');
  const parsed = parse(source);
  expect(parsed.blocks[0].kind).toBe('script');
  const compiled = compileFile(parsed);
  expect(compiled.scripts.length).toBe(1);
  const root = compiled.scripts[0].blocks[0];
  expect(root.opcode).toBe('motion_movesteps');
  expect(root.next.opcode).toBe('motion_turnright');
});

test('consecutive loose statements group into a connected script', () => {
  const source = ['move(${n:10})', 'turn_right(${n:15})', ''].join('\n');
  const parsed = parse(source);
  expect(parsed.blocks.length).toBe(2);
  const compiled = compileFile(parsed);
  expect(compiled.scripts.length).toBe(1);
  const root = compiled.scripts[0].blocks[0];
  expect(root.opcode).toBe('motion_movesteps');
  expect(root.next.opcode).toBe('motion_turnright');
});

test('loose scripts decompile into def script() and round-trip without false imports', () => {
  const target = {
    id: 'target-1',
    name: 'Sprite1',
    getName: () => 'Sprite1',
    blocks: {
      _blocks: {
        b1: { id: 'b1', opcode: 'motion_movesteps', topLevel: true, next: 'b2', inputs: { STEPS: { block: 's1' } } },
        s1: { id: 's1', opcode: 'math_number', shadow: true, fields: { NUM: { value: '10' } } },
        b2: { id: 'b2', opcode: 'motion_turnright', topLevel: false, next: null, inputs: { DEGREES: { block: 's2' } } },
        s2: { id: 's2', opcode: 'math_number', shadow: true, fields: { NUM: { value: '15' } } },
        v1: { id: 'v1', opcode: 'data_variable', topLevel: true, fields: { VARIABLE: { value: 'score' } } },
        op1: { id: 'op1', opcode: 'operator_add', topLevel: true, inputs: {} }
      }
    }
  };

  const decompiled = createDecompiler(null, target).file();
  expect(decompiled.code).not.toContain('import data');
  expect(decompiled.code).not.toContain('import operator');
  expect(decompiled.code).toContain('def script_');
  expect(decompiled.code).toContain('move(${n:10})');
  expect(decompiled.code).toContain('turn_right(${n:15})');
  expect(decompiled.code).toContain('${v:"score"}');
  expect(decompiled.code).toContain('(0 + 0)');

  // Recompiling decompiled code should succeed and preserve standalone blocks
  const parsed = parse(decompiled.code);
  const recompiled = compileFile(parsed);
  expect(recompiled.scripts.length).toBe(3);
  expect(recompiled.scripts[0].blocks[0].opcode).toBe('motion_movesteps');
  expect(recompiled.scripts[1].blocks[0].opcode).toBe('data_variable');
  expect(recompiled.scripts[2].blocks[0].opcode).toBe('operator_add');
});

test('standalone expressions and reporters compile into isolated top-level blocks and emit XML', () => {
  const source = ['${v:"score"}', 'random(1, 10)', '1 + 2', 'x_position()', ''].join('\n');

  const parsed = parse(source);
  const compiled = compileFile(parsed);
  expect(compiled.scripts.length).toBe(4);
  expect(compiled.scripts[0].blocks[0].opcode).toBe('data_variable');
  expect(compiled.scripts[1].blocks[0].opcode).toBe('operator_random');
  expect(compiled.scripts[2].blocks[0].opcode).toBe('operator_add');
  expect(compiled.scripts[3].blocks[0].opcode).toBe('motion_xposition');

  const ctx = makeCtx();
  const xmlResult = buildScriptsXml(compiled.scripts, ctx);
  expect(xmlResult.scripts).toBe(4);
  expect(xmlResult.xml).toContain('data_variable');
  expect(xmlResult.xml).toContain('operator_random');
  expect(xmlResult.xml).toContain('operator_add');
  expect(xmlResult.xml).toContain('motion_xposition');
});

test('feature tour example compiles, emits XML, and round-trips', () => {
  const scripts = compile(SCRATHON_EXAMPLE);
  expect(scripts.length).toBe(8);

  const ctx = makeCtx();
  const xmlResult = buildScriptsXml(scripts, ctx);
  expect(xmlResult.xml).toContain('<shadow type="note">');
  expect(xmlResult.xml).toContain('<shadow type="event_broadcast_menu">');
  expect(xmlResult.xml).toContain('<shadow type="colour_picker">');
  expect(xmlResult.xml).toContain('<shadow type="sensing_of_object_menu">');
  expect(xmlResult.xml).toContain('<shadow type="music_menu_INSTRUMENT">');
  expect(xmlResult.xml).toContain('procedures_definition');
  expect(xmlResult.xml).toContain('procedures_call');

  const target = makeTarget(scripts);
  const { code } = createDecompiler(null, target).file();
  expect(code).toContain('import pen');
  expect(code).toContain('import music');
  expect(code).toContain('answer()');
  expect(code).toContain('days_since_2000()');
  expect(code).toContain('elif ');
  expect(code).toContain('@custom_block(warp=True)');
  expect(code).toContain('music.getTempo()');

  const recompiled = compile(code);
  expect(recompiled.length).toBe(scripts.length);
});

test('Scrathon_doc and scrathon_example are exposed to the model', () => {
  const names = TOOL_DEFINITIONS.map((definition) => definition.function.name);
  expect(names).toContain('Scrathon_doc');
  expect(names).toContain('scrathon_example');
  expect(names).toContain('block_catalog');
});

test('SCRATHON_DOC stays in sync with the markdown source', () => {
  const mdPath = path.resolve(__dirname, '../../../src/addons/addons/astras-copilot/docs/scrathon.md');
  expect(SCRATHON_DOC).toBe(fs.readFileSync(mdPath, 'utf8'));
});

test('Scrathon_doc returns the markdown reference', () => {
  const tools = createScratchTools({});
  const result = tools.Scrathon_doc();
  expect(typeof result.content).toBe('string');
  expect(result.content).toContain('# Scrathon');
  expect(result.content).toContain('${v:');
});

test('scrathon_example returns the shared compilable example', () => {
  const tools = createScratchTools({});
  const result = tools.scrathon_example();
  expect(result.code).toBe(SCRATHON_EXAMPLE);
  expect(compile(result.code).length).toBe(8);
});

test('block_catalog returns argument types, return types, and dropdown options', () => {
  const stage = makeScratchTarget('Stage', true, () => stage);
  const sprite = makeScratchTarget('Sprite1', false, () => stage);
  sprite.variables = {
    localHp: { id: 'localHp', name: 'hp', type: '' },
    localItems: { id: 'localItems', name: 'backpack', type: 'list' }
  };
  stage.variables = {
    globalScore: { id: 'globalScore', name: 'score', type: '' },
    globalList: { id: 'globalList', name: 'inventory', type: 'list' },
    broadcast: { id: 'broadcast', name: 'update', type: 'broadcast_msg' }
  };
  sprite.getCostumes = () => [{ name: 'costume1' }, { name: 'costume2' }];
  stage.getCostumes = () => [{ name: 'backdrop1' }];
  sprite.getSounds = () => [{ name: 'pop' }];
  stage.getSounds = () => [];
  const vm = {
    runtime: {
      getTargetForStage: () => stage,
      getEditingTarget: () => sprite,
      targets: [stage, sprite],
      _blockInfo: [
        {
          id: 'music',
          blocks: [
            {
              info: {
                opcode: 'setInstrument',
                blockType: 'command',
                arguments: { INSTRUMENT: { type: 'menu' } }
              }
            },
            { info: { opcode: 'getTempo', blockType: 'reporter', arguments: {} } }
          ],
          menuInfo: {
            INSTRUMENT: {
              acceptReporters: true,
              items: [
                ['Piano', '1'],
                ['Guitar', '2']
              ]
            }
          }
        }
      ]
    }
  };
  const tools = createScratchTools(vm);

  const keyEntry = tools.block_catalog({ query: 'key_pressed' }).blocks.find((b) => b.name === 'key_pressed');
  expect(keyEntry.returns).toBe('boolean');
  expect(keyEntry.arguments[0].type).toBe('menu');
  expect(keyEntry.arguments[0].sigil).toBe('m');
  expect(keyEntry.arguments[0].options).toEqual(expect.arrayContaining([{ label: 'space', value: 'space' }]));

  const setVar = tools.block_catalog({ query: 'set_var' }).blocks.find((b) => b.name === 'set_var');
  const variableArg = setVar.arguments.find((arg) => arg.name === 'VARIABLE');
  expect(variableArg.type).toBe('variable');
  expect(variableArg.sigil).toBe('v');
  expect(variableArg.options).toEqual(
    expect.arrayContaining([
      { label: 'hp (local)', value: 'hp', scope: 'local' },
      { label: 'score (global)', value: 'score', scope: 'global' }
    ])
  );

  const listArg = tools
    .block_catalog({ query: 'list_add' })
    .blocks.find((b) => b.name === 'list_add')
    .arguments.find((arg) => arg.name === 'LIST');
  expect(listArg.type).toBe('list');
  expect(listArg.sigil).toBe('l');
  expect(listArg.options).toEqual(
    expect.arrayContaining([
      { label: 'backpack (local)', value: 'backpack', scope: 'local' },
      { label: 'inventory (global)', value: 'inventory', scope: 'global' }
    ])
  );

  const costumeArg = tools.block_catalog({ query: 'switch_costume' }).blocks.find((b) => b.name === 'switch_costume')
    .arguments[0];
  expect(costumeArg.type).toBe('menu');
  expect(costumeArg.options).toEqual([
    { label: 'costume1', value: 'costume1' },
    { label: 'costume2', value: 'costume2' }
  ]);

  const answer = tools.block_catalog({ query: 'answer' }).blocks.find((b) => b.name === 'answer');
  expect(answer.returns).toBe('string');

  const broadcast = tools.block_catalog({ query: 'broadcast' }).blocks.find((b) => b.name === 'broadcast');
  expect(broadcast.arguments[0].sigil).toBe('s');
  expect(broadcast.arguments[0].legacySigil).toBe('msg');
  expect(broadcast.arguments[0].options).toEqual(
    expect.arrayContaining([{ label: 'update', value: 'update', scope: 'global' }])
  );

  const instrument = tools
    .block_catalog({ query: 'music.setInstrument' })
    .blocks.find((b) => b.name === 'music.setInstrument');
  expect(instrument.arguments[0].type).toBe('menu');
  expect(instrument.arguments[0].options).toEqual([
    { label: 'Piano', value: '1' },
    { label: 'Guitar', value: '2' }
  ]);

  const tempo = tools.block_catalog({ query: 'music.getTempo' }).blocks.find((b) => b.name === 'music.getTempo');
  expect(tempo.returns).toBe('number');
});
