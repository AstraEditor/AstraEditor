/**
 * Scratch DSL renderer.
 *
 * Core blocks use readable templates. Extension blocks are resolved from the
 * runtime's extension metadata (the same `info.text` templates that scratch-blocks
 * uses), so new extensions work without a hard-coded table. Unknown blocks still
 * render in a generic `category.block(args...)` form instead of disappearing.
 */

const MAX_BLOCK_DEPTH = 30;
const MAX_FIELD_LENGTH = 200;

const CORE_TEMPLATES = {
  // Events
  event_whenflagclicked: 'when green flag clicked',
  event_whenkeypressed: 'when {KEY_OPTION} key pressed',
  event_whenthisspriteclicked: 'when this sprite clicked',
  event_whenstageclicked: 'when stage clicked',
  event_whenbackdropswitchesto: 'when backdrop switches to {BACKDROP}',
  event_whengreaterthan: 'when {WHENGREATERTHANMENU} > {VALUE}',
  event_whenbroadcastreceived: 'when I receive {BROADCAST_OPTION}',
  event_broadcast: 'broadcast {BROADCAST_OPTION}',
  event_broadcastandwait: 'broadcast {BROADCAST_OPTION} and wait',

  // Control
  control_wait: 'wait {DURATION} seconds',
  control_wait_until: 'wait until {CONDITION}',
  control_repeat: 'repeat {TIMES}',
  control_forever: 'forever',
  control_if: 'if {CONDITION} then',
  control_if_else: 'if {CONDITION} then',
  control_repeat_until: 'repeat until {CONDITION}',
  control_while: 'while {CONDITION}',
  control_for_each: 'for each {VARIABLE} in {VALUE}',
  control_start_as_clone: 'when I start as a clone',
  control_create_clone_of: 'create clone of {CLONE_OPTION}',
  control_delete_this_clone: 'delete this clone',
  control_stop: 'stop {STOP_OPTION}',

  // Motion
  motion_movesteps: 'move {STEPS} steps',
  motion_turnright: 'turn right {DEGREES} degrees',
  motion_turnleft: 'turn left {DEGREES} degrees',
  motion_goto: 'go to {TO}',
  motion_gotoxy: 'go to x: {X} y: {Y}',
  motion_glideto: 'glide {SECS} secs to {TO}',
  motion_glidesecstoxy: 'glide {SECS} secs to x: {X} y: {Y}',
  motion_pointindirection: 'point in direction {DIRECTION}',
  motion_pointtowards: 'point towards {TOWARDS}',
  motion_changexby: 'change x by {DX}',
  motion_setx: 'set x to {X}',
  motion_changeyby: 'change y by {DY}',
  motion_sety: 'set y to {Y}',
  motion_ifonedgebounce: 'if on edge, bounce',
  motion_setrotationstyle: 'set rotation style {STYLE}',
  motion_xposition: 'x position',
  motion_yposition: 'y position',
  motion_direction: 'direction',

  // Looks
  looks_say: 'say {MESSAGE}',
  looks_sayforsecs: 'say {MESSAGE} for {SECS} seconds',
  looks_think: 'think {MESSAGE}',
  looks_thinkforsecs: 'think {MESSAGE} for {SECS} seconds',
  looks_show: 'show',
  looks_hide: 'hide',
  looks_switchcostumeto: 'switch costume to {COSTUME}',
  looks_nextcostume: 'next costume',
  looks_switchbackdropto: 'switch backdrop to {BACKDROP}',
  looks_switchbackdroptoandwait: 'switch backdrop to {BACKDROP} and wait',
  looks_nextbackdrop: 'next backdrop',
  looks_gotofrontback: 'go to {FRONT_BACK} layer',
  looks_goforwardbackward: 'go {FORWARD_BACKWARD} {NUMBER} layers',
  looks_changeeffectby: 'change {EFFECT} effect by {CHANGE}',
  looks_seteffectto: 'set {EFFECT} effect to {VALUE}',
  looks_cleargraphiceffects: 'clear graphic effects',
  looks_changesizeby: 'change size by {CHANGE}',
  looks_setsizeto: 'set size to {SIZE} %',
  looks_size: 'size',
  looks_costumenumbername: 'costume {NUMBER_NAME}',
  looks_backdropnumbername: 'backdrop {NUMBER_NAME}',

  // Sound
  sound_play: 'start sound {SOUND_MENU}',
  sound_playuntildone: 'play sound {SOUND_MENU} until done',
  sound_stopallsounds: 'stop all sounds',
  sound_seteffectto: 'set {EFFECT} effect to {VALUE}',
  sound_changeeffectby: 'change {EFFECT} effect by {VALUE}',
  sound_cleareffects: 'clear sound effects',
  sound_changevolumeby: 'change volume by {VOLUME}',
  sound_setvolumeto: 'set volume to {VOLUME} %',
  sound_volume: 'volume',

  // Variables and lists
  data_variable: '{VARIABLE}',
  data_listcontents: '{LIST}',
  data_setvariableto: 'set {VARIABLE} to {VALUE}',
  data_changevariableby: 'change {VARIABLE} by {VALUE}',
  data_showvariable: 'show variable {VARIABLE}',
  data_hidevariable: 'hide variable {VARIABLE}',
  data_addtolist: 'add {ITEM} to {LIST}',
  data_deleteoflist: 'delete {INDEX} of {LIST}',
  data_deletealloflist: 'delete all of {LIST}',
  data_insertatlist: 'insert {ITEM} at {INDEX} of {LIST}',
  data_replaceitemoflist: 'replace item {INDEX} of {LIST} with {ITEM}',
  data_itemoflist: 'item {INDEX} of {LIST}',
  data_itemnumoflist: 'item # of {ITEM} in {LIST}',
  data_lengthoflist: 'length of {LIST}',
  data_listcontainsitem: '{LIST} contains {ITEM}?',
  data_showlist: 'show list {LIST}',
  data_hidelist: 'hide list {LIST}',

  // Sensing
  sensing_touchingobject: 'touching {TOUCHINGOBJECTMENU}?',
  sensing_touchingcolor: 'touching color {COLOR}?',
  sensing_coloristouchingcolor: 'color {COLOR} is touching {COLOR2}?',
  sensing_distanceto: 'distance to {DISTANCETOMENU}',
  sensing_askandwait: 'ask {QUESTION} and wait',
  sensing_answer: 'answer',
  sensing_keypressed: 'key {KEY_OPTION} pressed?',
  sensing_mousedown: 'mouse down?',
  sensing_mousex: 'mouse x',
  sensing_mousey: 'mouse y',
  sensing_setdragmode: 'set drag mode {DRAG_MODE}',
  sensing_timer: 'timer',
  sensing_resettimer: 'reset timer',
  sensing_of: '{PROPERTY} of {OBJECT}',
  sensing_current: 'current {CURRENTMENU}',
  sensing_dayssince2000: 'days since 2000',
  sensing_username: 'username',
  sensing_loudness: 'loudness',

  // Operators
  operator_add: '{NUM1} + {NUM2}',
  operator_subtract: '{NUM1} - {NUM2}',
  operator_multiply: '{NUM1} * {NUM2}',
  operator_divide: '{NUM1} / {NUM2}',
  operator_random: 'pick random {FROM} to {TO}',
  operator_gt: '{OPERAND1} > {OPERAND2}',
  operator_lt: '{OPERAND1} < {OPERAND2}',
  operator_equals: '{OPERAND1} = {OPERAND2}',
  operator_and: '{OPERAND1} and {OPERAND2}',
  operator_or: '{OPERAND1} or {OPERAND2}',
  operator_not: 'not {OPERAND}',
  operator_join: 'join {STRING1} {STRING2}',
  operator_letter_of: 'letter {LETTER} of {STRING}',
  operator_length: 'length of {STRING}',
  operator_contains: '{STRING1} contains {STRING2}?',
  operator_mod: '{NUM1} mod {NUM2}',
  operator_round: 'round {NUM}',
  operator_mathop: '{OPERATOR} of {NUM}'
};

const BOOLEAN_OPCODES = new Set([
  'operator_gt',
  'operator_lt',
  'operator_equals',
  'operator_and',
  'operator_or',
  'operator_not',
  'operator_contains',
  'sensing_touchingobject',
  'sensing_touchingcolor',
  'sensing_coloristouchingcolor',
  'sensing_keypressed',
  'sensing_mousedown',
  'data_listcontainsitem',
  'argument_reporter_boolean'
]);

// Fields that refer to project resources should stay readable but distinct.
const NAME_FIELDS = new Set([
  'VARIABLE',
  'LIST',
  'BROADCAST_OPTION',
  'BROADCAST_MSG',
  'COSTUME',
  'BACKDROP',
  'SOUND_MENU',
  'OBJECT',
  'TOUCHINGOBJECTMENU',
  'DISTANCETOMENU',
  'CLONE_OPTION',
  'TO',
  'TOWARDS',
  'MESSAGE'
]);

const PLAIN_FIELDS = new Set([
  'KEY_OPTION',
  'WHENGREATERTHANMENU',
  'CURRENTMENU',
  'PROPERTY',
  'EFFECT',
  'STOP_OPTION',
  'NUMBER_NAME',
  'DRAG_MODE',
  'STYLE',
  'FRONT_BACK',
  'FORWARD_BACKWARD',
  'OPERATOR'
]);

const MENU_NAME_FIELDS = new Set(['OBJECT', 'TOUCHINGOBJECTMENU', 'DISTANCETOMENU', 'CLONE_OPTION', 'TO', 'TOWARDS']);

const MENU_LABELS = {
  _edge_: 'edge',
  _mouse_: 'mouse-pointer',
  _random_: 'random position',
  _stage_: 'Stage',
  _myself_: 'myself',
  _clones_: 'clones',
  all: 'all',
  'this script': 'this script',
  'other scripts in sprite': 'other scripts in sprite',
  TIMER: 'timer',
  LOUDNESS: 'loudness',
  YEAR: 'year',
  MONTH: 'month',
  DATE: 'date',
  DAYOFWEEK: 'day of week',
  HOUR: 'hour',
  MINUTE: 'minute',
  SECOND: 'second',
  COLOR: 'color',
  FISHEYE: 'fisheye',
  WHIRL: 'whirl',
  PIXELATE: 'pixelate',
  MOSAIC: 'mosaic',
  BRIGHTNESS: 'brightness',
  GHOST: 'ghost',
  PITCH: 'pitch',
  PAN: 'pan'
};

const formatMenuValue = (value) => {
  const text = truncate(value);
  return Object.prototype.hasOwnProperty.call(MENU_LABELS, text) ? MENU_LABELS[text] : text;
};

const extensionMaps = new WeakMap();

const getBlock = (target, blockId) => {
  if (!target || !target.blocks || !blockId) return undefined;
  if (typeof target.blocks.getBlock === 'function') return target.blocks.getBlock(blockId);
  return target.blocks._blocks ? target.blocks._blocks[blockId] : undefined;
};

const truncate = (value) => {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}...` : text;
};

const quote = (value) => {
  const text = truncate(value);
  return `"${text.replace(/"/g, '\\"')}"`;
};

const isNumberLike = (value) => {
  if (typeof value === 'number') return true;
  if (typeof value !== 'string' || value.trim() === '') return false;
  return Number.isFinite(Number(value));
};

const formatField = (fieldName, field) => {
  if (!field) return '?';
  const value = field.value;
  if (NAME_FIELDS.has(fieldName)) {
    return `[${MENU_NAME_FIELDS.has(fieldName) ? formatMenuValue(value) : truncate(value)}]`;
  }
  if (PLAIN_FIELDS.has(fieldName)) return formatMenuValue(value);
  if (isNumberLike(value)) return String(value);
  return quote(value);
};

const formatShadow = (block) => {
  if (!block) return '?';
  const fields = block.fields || {};
  if (/menu/i.test(block.opcode || '')) {
    const menuField = Object.keys(fields)[0];
    if (menuField) {
      return NAME_FIELDS.has(menuField)
        ? formatField(menuField, fields[menuField])
        : formatMenuValue(fields[menuField].value);
    }
  }
  switch (block.opcode) {
    case 'math_number':
    case 'math_positive_number':
    case 'math_integer':
    case 'math_whole_number':
    case 'math_angle':
      return fields.NUM ? String(fields.NUM.value) : '?';
    case 'text':
      return fields.TEXT ? quote(fields.TEXT.value) : '""';
    case 'colour_picker':
      return fields.COLOUR ? truncate(fields.COLOUR.value) : '?';
    default:
      break;
  }
  const firstField = Object.keys(fields)[0];
  if (firstField) return formatField(firstField, fields[firstField]);
  return block.opcode ? `[${block.opcode}]` : '?';
};

/**
 * Normalize an extension text template.
 * @param {string|object|Array<string|object>} value Template.
 * @returns {string} Text template.
 */
const getMessageText = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((part) => getMessageText(part))
      .filter(Boolean)
      .join(' ');
  if (value && typeof value.default === 'string') return value.default;
  return '';
};

/**
 * Build a lookup of extension blocks from the runtime metadata.
 * @param {object} vm Scratch VM.
 * @returns {Map<string, object>} Extended opcode -> metadata.
 */
const getExtensionMap = (vm) => {
  if (!vm || !vm.runtime) return new Map();

  const categories = Array.isArray(vm.runtime._blockInfo) ? vm.runtime._blockInfo : [];
  const signature = categories
    .map((category) => `${category.id}:${category.blocks ? category.blocks.length : 0}`)
    .join('|');
  const cached = extensionMaps.get(vm.runtime);
  if (cached && cached.signature === signature) return cached.map;

  const map = new Map();
  for (const category of categories) {
    if (!category || !Array.isArray(category.blocks)) continue;
    for (const entry of category.blocks) {
      const info = entry && entry.info;
      if (!info || typeof info.opcode !== 'string') continue;
      const text = getMessageText(info.text);
      if (!text) continue;
      map.set(`${category.id}_${info.opcode}`, {
        categoryId: category.id,
        categoryName: category.name || category.id,
        text,
        arguments: info.arguments || {}
      });
    }
  }
  extensionMaps.set(vm.runtime, { signature, map });
  return map;
};

/**
 * Get a short human-readable label for a block opcode.
 * @param {object} vm Scratch VM.
 * @param {string} opcode Block opcode.
 * @param {object} [mutation] Block mutation.
 * @returns {string} Label.
 */
export const getBlockLabel = (vm, opcode, mutation) => {
  if (mutation && typeof mutation.proccode === 'string' && mutation.proccode) {
    return mutation.proccode.replace(/%[sbn]/g, '…');
  }
  const template = CORE_TEMPLATES[opcode];
  if (template) return template.replace(/\{[^}]+\}/g, '…');
  const extension = getExtensionMap(vm).get(opcode);
  if (extension) return extension.text.replace(/\[[A-Z0-9_]+\]|%\d+/g, '…');
  const parts = String(opcode || '').split('_');
  if (parts.length > 1) return `${parts[0]}: ${parts.slice(1).join(' ')}`;
  return String(opcode || 'unknown block');
};

const renderValue = (vm, target, block, name, state) => {
  const field = block.fields && block.fields[name];
  if (field) return formatField(name, field);

  const input = block.inputs && block.inputs[name];
  if (!input || !input.block) return '?';
  const child = getBlock(target, input.block);
  if (!child) return '?';
  if (child.shadow) return formatShadow(child);

  const text = renderInline(vm, target, child, state);
  return BOOLEAN_OPCODES.has(child.opcode) ? `<${text}>` : `(${text})`;
};

const parseArgumentList = (mutation, key) => {
  if (!mutation || !mutation[key]) return [];
  try {
    const parsed = typeof mutation[key] === 'string' ? JSON.parse(mutation[key]) : mutation[key];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const parseArgumentIds = (mutation) => parseArgumentList(mutation, 'argumentids');

const renderProcedureCall = (vm, target, block, state) => {
  const mutation = block.mutation || {};
  const proccode = mutation.proccode || 'custom block';
  const argumentIds = parseArgumentIds(mutation);
  const args = argumentIds.map((argumentId) => {
    const input = block.inputs && block.inputs[argumentId];
    if (!input || !input.block) return '?';
    const child = getBlock(target, input.block);
    if (!child) return '?';
    if (child.shadow) return formatShadow(child);
    const text = renderInline(vm, target, child, state);
    return BOOLEAN_OPCODES.has(child.opcode) ? `<${text}>` : `(${text})`;
  });
  let index = 0;
  const name = proccode.replace(/%[sbn]/g, () => (index < args.length ? args[index++] : '?'));
  const remaining = index < args.length ? ` ${args.slice(index).join(' ')}` : '';
  return `${name}${remaining}`;
};

const renderProcedureDefinition = (mutation) => {
  const proccode = (mutation && mutation.proccode) || 'custom block';
  const names = parseArgumentList(mutation, 'argumentnames');
  let index = 0;
  return `define ${proccode.replace(/%[sbn]/g, () => `(${names[index++] || 'arg'})`)}`;
};

const renderExtension = (vm, target, extension, block, state) => {
  const argumentNames = Object.keys(extension.arguments);
  const renderArgument = (argumentName) => {
    if (!argumentName) return '?';
    if (/^SUBSTACK\d*$/.test(argumentName)) return '';
    const field = block.fields && block.fields[argumentName];
    if (field) {
      return NAME_FIELDS.has(argumentName)
        ? `[${MENU_NAME_FIELDS.has(argumentName) ? formatMenuValue(field.value) : truncate(field.value)}]`
        : formatMenuValue(field.value);
    }
    const input = block.inputs && block.inputs[argumentName];
    if (!input || !input.block) return '?';
    const child = getBlock(target, input.block);
    if (!child) return '?';
    if (child.shadow) return formatShadow(child);
    const text = renderInline(vm, target, child, state);
    return BOOLEAN_OPCODES.has(child.opcode) ? `<${text}>` : `(${text})`;
  };
  return extension.text.replace(/\[([A-Z0-9_]+)\]|%(\d+)/g, (match, name, index) =>
    renderArgument(name || argumentNames[Number(index) - 1])
  );
};

const renderGeneric = (vm, target, block, state) => {
  const opcode = String(block.opcode || 'unknown');
  const separator = opcode.indexOf('_');
  const category = separator === -1 ? 'block' : opcode.slice(0, separator);
  const name = separator === -1 ? opcode : opcode.slice(separator + 1);
  const fields = block.fields
    ? Object.keys(block.fields).map((fieldName) => `${fieldName}: ${formatField(fieldName, block.fields[fieldName])}`)
    : [];
  const inputs = block.inputs
    ? Object.keys(block.inputs)
        .filter((inputName) => inputName !== 'SUBSTACK' && inputName !== 'SUBSTACK2')
        .map((inputName) => {
          const input = block.inputs[inputName];
          if (!input || !input.block) return '';
          const child = getBlock(target, input.block);
          if (!child) return '';
          if (child.shadow) return `${inputName}: ${formatShadow(child)}`;
          const text = renderInline(vm, target, child, state);
          return `${inputName}: ${BOOLEAN_OPCODES.has(child.opcode) ? `<${text}>` : `(${text})`}`;
        })
        .filter(Boolean)
    : [];
  const args = fields.concat(inputs);
  return `${category}.${name}${args.length ? ` (${args.join(', ')})` : ''}`;
};

const renderInline = (vm, target, block, state) => {
  if (!block) return '?';
  if (block.shadow) return formatShadow(block);

  if (block.opcode === 'procedures_call') {
    return renderProcedureCall(vm, target, block, state);
  }
  if (block.opcode === 'procedures_definition') {
    const prototype = block.inputs && block.inputs.custom_block && getBlock(target, block.inputs.custom_block.block);
    return renderProcedureDefinition((prototype && prototype.mutation) || block.mutation || {});
  }
  if (block.opcode === 'data_variable') {
    return block.fields && block.fields.VARIABLE ? truncate(block.fields.VARIABLE.value) : 'variable';
  }
  if (block.opcode === 'data_listcontents') {
    return block.fields && block.fields.LIST ? truncate(block.fields.LIST.value) : 'list';
  }
  if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
    return block.fields && block.fields.VALUE ? truncate(block.fields.VALUE.value) : 'argument';
  }

  const extension = getExtensionMap(vm).get(block.opcode);
  let text = '';
  if (extension) {
    text = renderExtension(vm, target, extension, block, state);
  } else if (CORE_TEMPLATES[block.opcode]) {
    text = CORE_TEMPLATES[block.opcode].replace(/\{([A-Z0-9_]+)\}/g, (match, name) =>
      renderValue(vm, target, block, name, state)
    );
  } else {
    text = renderGeneric(vm, target, block, state);
  }

  return text.replace(/\s+/g, ' ').trim();
};

const hasBody = (block) => Boolean((block.inputs && block.inputs.SUBSTACK) || (block.inputs && block.inputs.SUBSTACK2));

const pushLine = (lines, state, indent, text) => {
  lines.push(`${'  '.repeat(indent)}${text}`);
};

const emitStatement = (vm, target, blockId, state, indent, lines) => {
  if (!blockId || state.count >= state.maxBlocks || indent > MAX_BLOCK_DEPTH) {
    state.truncated = true;
    return;
  }
  const block = getBlock(target, blockId);
  if (!block || state.seen.has(blockId)) return;
  state.seen.add(blockId);
  state.count++;
  if (state.count > state.maxBlocks) {
    state.truncated = true;
    return;
  }

  const opcode = block.opcode;
  if (opcode === 'procedures_definition') {
    const prototype = block.inputs && block.inputs.custom_block && getBlock(target, block.inputs.custom_block.block);
    const mutation = (prototype && prototype.mutation) || block.mutation || {};
    pushLine(lines, state, indent, renderProcedureDefinition(mutation));
  } else if (opcode === 'control_if_else') {
    pushLine(lines, state, indent, `if ${renderValue(vm, target, block, 'CONDITION', state)} then`);
  } else if (opcode === 'control_forever') {
    pushLine(lines, state, indent, 'forever');
  } else if (opcode === 'control_if') {
    pushLine(lines, state, indent, `if ${renderValue(vm, target, block, 'CONDITION', state)} then`);
  } else if (opcode === 'control_repeat') {
    pushLine(lines, state, indent, `repeat ${renderValue(vm, target, block, 'TIMES', state)}`);
  } else if (opcode === 'control_repeat_until') {
    pushLine(lines, state, indent, `repeat until ${renderValue(vm, target, block, 'CONDITION', state)}`);
  } else if (opcode === 'control_while') {
    pushLine(lines, state, indent, `while ${renderValue(vm, target, block, 'CONDITION', state)}`);
  } else if (opcode === 'control_for_each') {
    pushLine(
      lines,
      state,
      indent,
      `for each ${renderValue(vm, target, block, 'VARIABLE', state)} in ${renderValue(
        vm,
        target,
        block,
        'VALUE',
        state
      )}`
    );
  } else {
    pushLine(lines, state, indent, renderInline(vm, target, block, state));
  }

  const body = block.inputs && block.inputs.SUBSTACK;
  if (body && body.block) emitStatement(vm, target, body.block, state, indent + 1, lines);

  const elseBody = block.inputs && block.inputs.SUBSTACK2;
  if (elseBody && elseBody.block && !state.truncated) {
    pushLine(lines, state, indent, 'else');
    emitStatement(vm, target, elseBody.block, state, indent + 1, lines);
  }

  if (hasBody(block) && !state.truncated) pushLine(lines, state, indent, 'end');

  if (block.next && !state.truncated) emitStatement(vm, target, block.next, state, indent, lines);
};

/**
 * Replace internal Scratch IDs in a final answer with readable labels.
 * Users should never see raw block, script, or target IDs unless they ask.
 * @param {object} vm Scratch VM.
 * @param {string} content Assistant content.
 * @returns {string} Content with IDs replaced.
 */
export const replaceInternalIds = (vm, content) => {
  const text = String(content || '');
  if (!/[A-Za-z0-9]{12,}/.test(text)) return text;

  const targetNames = new Map();
  const blocksById = new Map();
  const targets = vm && vm.runtime && Array.isArray(vm.runtime.targets) ? vm.runtime.targets : [];
  for (const target of targets) {
    if (target.id) {
      const name = typeof target.getName === 'function' ? target.getName() : target.name;
      if (name) targetNames.set(target.id, `「${truncate(name)}」`);
    }
    const blocks = target.blocks && target.blocks._blocks;
    if (!blocks) continue;
    for (const block of Object.values(blocks)) {
      if (block && block.id) blocksById.set(block.id, { target, block });
    }
  }

  return text.replace(/[A-Za-z0-9]{12,}/g, (token) => {
    if (targetNames.has(token)) return targetNames.get(token);
    const found = blocksById.get(token);
    if (!found) return token;
    if (found.block.shadow) return `「${formatShadow(found.block)}」`;
    const label = renderInline(vm, found.target, found.block, {
      count: 0,
      maxBlocks: 1,
      truncated: false,
      seen: new Set()
    });
    return `「${label}」`;
  });
};

/**
 * Render a script as a readable DSL.
 * @param {object} vm Scratch VM.
 * @param {object} target Scratch target.
 * @param {string} rootId Script root block ID.
 * @param {number} [maxBlocks] Maximum blocks to include.
 * @returns {{dsl: string, blockCount: number, truncated: boolean}} DSL result.
 */
export const scriptToDSL = (vm, target, rootId, maxBlocks = 200) => {
  const state = {
    count: 0,
    maxBlocks: Math.max(1, Math.min(400, Number(maxBlocks) || 200)),
    truncated: false,
    seen: new Set()
  };
  const lines = [];
  emitStatement(vm, target, rootId, state, 0, lines);
  if (state.truncated) lines.push('...');
  return {
    dsl: lines.join('\n'),
    blockCount: state.count,
    truncated: state.truncated
  };
};

/**
 * Render a short DSL preview of a script.
 * @param {object} vm Scratch VM.
 * @param {object} target Scratch target.
 * @param {string} rootId Script root block ID.
 * @param {number} [maxBlocks] Maximum blocks to include in the preview.
 * @returns {string} DSL preview.
 */
export const previewScriptDSL = (vm, target, rootId, maxBlocks = 6) => {
  const result = scriptToDSL(vm, target, rootId, maxBlocks);
  return result.dsl;
};

/**
 * Count every block reachable from a script.
 * @param {object} target Scratch target.
 * @param {string} rootId Script root block ID.
 * @returns {number} Block count.
 */
export const countScriptBlocks = (target, rootId) => {
  let count = 0;
  const seen = new Set();
  const stack = [rootId];
  while (stack.length > 0) {
    const blockId = stack.pop();
    if (!blockId || seen.has(blockId)) continue;
    const block = getBlock(target, blockId);
    if (!block) continue;
    seen.add(blockId);
    count++;
    if (block.next) stack.push(block.next);
    if (block.inputs) {
      Object.keys(block.inputs).forEach((name) => {
        if (name === 'SUBSTACK' || name === 'SUBSTACK2') return;
        const input = block.inputs[name];
        if (input && input.block) stack.push(input.block);
      });
    }
  }
  return count;
};
