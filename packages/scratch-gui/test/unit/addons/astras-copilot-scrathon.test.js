/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import { parse } from '../../../src/addons/addons/astras-copilot/agent/scrathon/parser';
import { compileFile } from '../../../src/addons/addons/astras-copilot/agent/scrathon/compiler';
import { createDecompiler } from '../../../src/addons/addons/astras-copilot/agent/scrathon/decompiler';
import { describeScrathonCatalog, FUNCTIONS } from '../../../src/addons/addons/astras-copilot/agent/scrathon/mappings';
import { buildScriptsXml } from '../../../src/addons/addons/astras-copilot/agent/block-xml';
import { ScrathonError } from '../../../src/addons/addons/astras-copilot/agent/scrathon/error';
import { prepareScrathonCodeAndExtensions } from '../../../src/addons/addons/astras-copilot/agent/tools';

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
    resolveField(fieldName, name) {
      const key = `${fieldName}:${name}`;
      if (!seen.has(key)) {
        seen.set(key, {
          id: `id-${String(name).replace(/\s+/g, '_')}`,
          name: String(name),
          type: fieldName === 'LIST' ? 'list' : fieldName === 'BROADCAST_OPTION' ? 'broadcast_msg' : ''
        });
        declared.push({ name: String(name), type: seen.get(key).type, id: seen.get(key).id, isLocal: false });
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
      blocks[id].fields[name] = { name, value };
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
  expect(code).toContain('broadcast(${msg:"win"})');
  expect(code).toContain('change_var(${v:"score"}, ${n:10})');
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

test('describeScrathonCatalog returns DSL signatures and categories without opcodes', () => {
  const full = describeScrathonCatalog();
  expect(full.length).toBeGreaterThan(40);
  expect(full.every((b) => b.name && b.signature && b.category && b.kind && b.opcode === undefined)).toBe(true);

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
