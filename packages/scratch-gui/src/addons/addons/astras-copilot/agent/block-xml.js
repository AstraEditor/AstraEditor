/**
 * Scratch block XML compiler.
 *
 * Turns a compact, model-friendly block descriptor (plain JSON) into the
 * scratch-blocks XML string that `Blockly.Xml.domToWorkspace` can load into the
 * real editor workspace. Loading through the workspace is deliberate: the GUI
 * forwards every create/change/delete event to `vm.blockListener`, so the VM
 * stays authoritative and the edit lands on the native undo stack (Ctrl+Z).
 *
 * The module is framework-free: it builds a tiny element tree and serialises it
 * by hand, so it works in the browser and can be unit-tested in plain Node.
 */

// ---------------------------------------------------------------------------
// Vocabulary tables
// ---------------------------------------------------------------------------

/**
 * Value inputs that Scratch expects on each opcode. Only used to pre-create
 * default shadows for inputs the model leaves out; anything the model supplies
 * is applied on top.
 */
export const BLOCK_INPUTS = {
  control_repeat: ['TIMES'],
  control_repeat_until: ['CONDITION'],
  control_while: ['CONDITION'],
  control_for_each: ['VALUE'],
  control_wait: ['DURATION'],
  control_wait_until: ['CONDITION'],
  control_if: ['CONDITION'],
  control_if_else: ['CONDITION'],
  control_create_clone_of: ['CLONE_OPTION'],
  event_whenkeypressed: ['KEY_OPTION'],
  event_whenbroadcastreceived: [],
  event_whengreaterthan: ['VALUE'],
  event_broadcast: ['BROADCAST_INPUT'],
  event_broadcastandwait: ['BROADCAST_INPUT'],
  looks_say: ['MESSAGE'],
  looks_sayforsecs: ['MESSAGE', 'SECS'],
  looks_think: ['MESSAGE'],
  looks_thinkforsecs: ['MESSAGE', 'SECS'],
  looks_switchcostumeto: ['COSTUME'],
  looks_switchbackdropto: ['BACKDROP'],
  looks_switchbackdroptoandwait: ['BACKDROP'],
  looks_changeeffectby: ['CHANGE'],
  looks_seteffectto: ['VALUE'],
  looks_changesizeby: ['CHANGE'],
  looks_setsizeto: ['SIZE'],
  looks_goforwardbackward: ['NUM'],
  looks_goforwardbackwardlayers: ['NUM'],
  motion_movesteps: ['STEPS'],
  motion_gotoxy: ['X', 'Y'],
  motion_goto: ['TO'],
  motion_turnright: ['DEGREES'],
  motion_turnleft: ['DEGREES'],
  motion_pointindirection: ['DIRECTION'],
  motion_pointtowards: ['TOWARDS'],
  motion_glidesecstoxy: ['SECS', 'X', 'Y'],
  motion_glideto: ['SECS', 'TO'],
  motion_changexby: ['DX'],
  motion_setx: ['X'],
  motion_changeyby: ['DY'],
  motion_sety: ['Y'],
  operator_add: ['NUM1', 'NUM2'],
  operator_subtract: ['NUM1', 'NUM2'],
  operator_multiply: ['NUM1', 'NUM2'],
  operator_divide: ['NUM1', 'NUM2'],
  operator_lt: ['OPERAND1', 'OPERAND2'],
  operator_equals: ['OPERAND1', 'OPERAND2'],
  operator_gt: ['OPERAND1', 'OPERAND2'],
  operator_and: ['OPERAND1', 'OPERAND2'],
  operator_or: ['OPERAND1', 'OPERAND2'],
  operator_not: ['OPERAND'],
  operator_random: ['FROM', 'TO'],
  operator_join: ['STRING1', 'STRING2'],
  operator_letter_of: ['STRING', 'LETTER'],
  operator_length: ['STRING'],
  operator_contains: ['STRING1', 'STRING2'],
  operator_mod: ['NUM1', 'NUM2'],
  operator_round: ['NUM'],
  operator_mathop: ['NUM'],
  sound_play: ['SOUND_MENU'],
  sound_playuntildone: ['SOUND_MENU'],
  sound_setvolumeto: ['VOLUME'],
  sound_changevolumeby: ['VOLUME'],
  sensing_touchingobject: ['TOUCHINGOBJECTMENU'],
  sensing_touchingcolor: ['COLOR'],
  sensing_coloristouchingcolor: ['COLOR', 'COLOR2'],
  sensing_distanceto: ['DISTANCETOMENU'],
  sensing_of: ['OBJECT'],
  sensing_keypressed: ['KEY_OPTION'],
  sensing_askandwait: ['QUESTION'],
  data_setvariableto: ['VALUE'],
  data_changevariableby: ['VALUE'],
  data_addtolist: ['ITEM'],
  data_deleteoflist: ['INDEX'],
  data_insertatlist: ['INDEX', 'ITEM'],
  data_replaceitemoflist: ['INDEX', 'ITEM'],
  data_itemoflist: ['INDEX'],
  data_itemnumoflist: ['ITEM'],
  data_listcontainsitem: ['ITEM']
};

/** Inputs that expect a boolean reporter; no numeric/text shadow is created. */
const BOOLEAN_INPUTS = new Set(['CONDITION', 'OPERAND', 'OPERAND1', 'OPERAND2', 'STRING1', 'STRING2']);

/** Default shadow type keyed by input name. */
const INPUT_SHADOW = {
  TIMES: 'math_whole_number',
  STEPS: 'math_number',
  DEGREES: 'math_number',
  DURATION: 'math_number',
  SECS: 'math_number',
  X: 'math_number',
  Y: 'math_number',
  DX: 'math_number',
  DY: 'math_number',
  CHANGE: 'math_number',
  SIZE: 'math_number',
  NUM: 'math_number',
  NUM1: 'math_number',
  NUM2: 'math_number',
  FROM: 'math_number',
  TO: 'math_number',
  LETTER: 'math_integer',
  INDEX: 'math_integer',
  VALUE: 'math_number',
  VOLUME: 'math_number',
  MESSAGE: 'text',
  STRING: 'text',
  STRING1: 'text',
  STRING2: 'text',
  ITEM: 'text',
  QUESTION: 'text',
  CONDITION: 'text',
  OPERAND: 'text',
  OPERAND1: 'text',
  OPERAND2: 'text',
  TOWARDS: 'motion_pointtowards_menu',
  COSTUME: 'looks_costume',
  BACKDROP: 'looks_backdrops',
  CLONE_OPTION: 'control_create_clone_of_menu',
  TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu',
  DISTANCETOMENU: 'sensing_distancetomenu',
  KEY_OPTION: 'sensing_keyoptions',
  SOUND_MENU: 'sound_sounds_menu',
  OBJECT: 'sensing_of_object_menu',
  COLOR: 'colour_picker',
  COLOR2: 'colour_picker',
  BROADCAST_INPUT: 'event_broadcast_menu'
};

/** Per-opcode overrides when one input name maps to different menu types. */
const OPCODE_INPUT_SHADOW = {
  motion_goto__TO: 'motion_goto_menu',
  motion_glideto__TO: 'motion_glideto_menu',
  motion_pointtowards__TOWARDS: 'motion_pointtowards_menu',
  looks_switchcostumeto__COSTUME: 'looks_costume',
  looks_switchbackdropto__BACKDROP: 'looks_backdrops',
  looks_switchbackdroptoandwait__BACKDROP: 'looks_backdrops',
  control_create_clone_of__CLONE_OPTION: 'control_create_clone_of_menu',
  sensing_touchingobject__TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu',
  sensing_distanceto__DISTANCETOMENU: 'sensing_distancetomenu',
  event_broadcast__BROADCAST_INPUT: 'event_broadcast_menu',
  event_broadcastandwait__BROADCAST_INPUT: 'event_broadcast_menu',
  sound_play__SOUND_MENU: 'sound_sounds_menu',
  sound_playuntildone__SOUND_MENU: 'sound_sounds_menu',
  sensing_of__OBJECT: 'sensing_of_object_menu'
};

/** Shadow type -> the field name it stores its literal value in. */
const SHADOW_FIELD = {
  math_whole_number: 'NUM',
  math_number: 'NUM',
  math_integer: 'NUM',
  math_positive_number: 'NUM',
  math_angle: 'NUM',
  text: 'TEXT',
  looks_costume: 'COSTUME',
  looks_backdrops: 'BACKDROP',
  motion_goto_menu: 'TO',
  motion_glideto_menu: 'TO',
  motion_pointtowards_menu: 'TOWARDS',
  control_create_clone_of_menu: 'CLONE_OPTION',
  sensing_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
  sensing_distancetomenu: 'DISTANCETOMENU',
  sensing_keyoptions: 'KEY_OPTION',
  event_broadcast_menu: 'BROADCAST_OPTION',
  sound_sounds_menu: 'SOUND_MENU',
  sensing_of_object_menu: 'OBJECT',
  colour_picker: 'COLOUR'
};

/** Menu shadows whose value should default to a project resource when omitted. */
const RESOURCE_INPUT = {
  COSTUME: 'costume',
  BACKDROP: 'backdrop',
  SOUND_MENU: 'sound'
};

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%()*+,-./:;=?@[]^_`{|}~';

/**
 * Generate a scratch-style 20 character id.
 * @returns {string} Id.
 */
export const generateId = () => {
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  return id;
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNumericLike = (value) => value !== '' && Number.isFinite(Number(value));

const pickShadowType = (opcode, inputName, value) => {
  const override = OPCODE_INPUT_SHADOW[`${opcode}__${inputName}`];
  if (override) return override;
  const fallback = INPUT_SHADOW[inputName];
  if (fallback) {
    // A literal text value in an otherwise-numeric input still uses text so the
    // model can intentionally put a name there; numeric stays numeric.
    if (fallback.startsWith('math_') && !isNumericLike(value)) return 'text';
    return fallback;
  }
  return isNumericLike(value) ? 'math_number' : 'text';
};

const defaultLiteralFor = (opcode, inputName, ctx) => {
  const shadowType = OPCODE_INPUT_SHADOW[`${opcode}__${inputName}`] || INPUT_SHADOW[inputName];
  if (shadowType && shadowType.startsWith('math_')) return '0';
  const resource = RESOURCE_INPUT[inputName];
  if (resource && ctx) {
    if (resource === 'costume' && ctx.defaultCostume) return ctx.defaultCostume;
    if (resource === 'backdrop' && ctx.defaultBackdrop) return ctx.defaultBackdrop;
    if (resource === 'sound' && ctx.defaultSound) return ctx.defaultSound;
  }
  return '';
};

const makeShadow = (opcode, inputName, value, ctx) => {
  const shadowType = pickShadowType(opcode, inputName, value);
  const fieldName = SHADOW_FIELD[shadowType] || 'TEXT';
  let text = value;
  if (shadowType.startsWith('math_')) text = String(Number(value) || 0);
  else if (value === undefined || value === null) text = defaultLiteralFor(opcode, inputName, ctx);
  return {
    tag: 'shadow',
    attrs: { type: shadowType },
    children: [{ tag: 'field', attrs: { name: fieldName }, text: String(text) }]
  };
};

/**
 * Build a shadow with an explicitly chosen type (used by the Scrathon compiler).
 * Broadcast inputs resolve their variable id through the context so the VM
 * learns about the broadcast; extension menu inputs may pass an explicit field
 * name (the menu name). All other types store a plain literal.
 * @param {string} shadowType Shadow block type.
 * @param {*} value Literal value.
 * @param {string} [explicitField] Explicit field name (extension menus).
 * @param {object} ctx Resolution context.
 * @returns {object} Shadow element node.
 */
const makeExplicitShadow = (shadowType, value, explicitField, ctx) => {
  const fieldName = explicitField || SHADOW_FIELD[shadowType] || 'TEXT';
  if (fieldName === 'BROADCAST_OPTION') {
    return makeFieldBlock('event_broadcast_menu', 'BROADCAST_OPTION', value, ctx);
  }
  let text = value === undefined || value === null ? '' : String(value);
  if (shadowType.startsWith('math_')) text = String(Number(value) || 0);
  return {
    tag: 'shadow',
    attrs: { type: shadowType },
    children: [{ tag: 'field', attrs: { name: fieldName }, text }]
  };
};

const makeFieldBlock = (opcode, fieldName, value, ctx) => {
  let fieldAttrs = { name: fieldName };
  let text = String(value === undefined || value === null ? '' : value);
  if (fieldName === 'VARIABLE' || fieldName === 'LIST' || fieldName === 'BROADCAST_OPTION') {
    const resolved = ctx && ctx.resolveField ? ctx.resolveField(fieldName, value) : null;
    if (resolved) {
      fieldAttrs = { name: fieldName, id: resolved.id, variabletype: resolved.type || '' };
      text = resolved.name;
    }
  }
  return {
    tag: 'block',
    attrs: { type: opcode },
    children: [{ tag: 'field', attrs: fieldAttrs, text }]
  };
};

const serializeMutation = (mutation) => {
  const attrs = {};
  for (const [key, value] of Object.entries(mutation)) {
    if (value === undefined || value === null) continue;
    attrs[key] =
      Array.isArray(value) || (isPlainObject(value) && key === 'argumentids') ? JSON.stringify(value) : String(value);
  }
  return attrs;
};

/**
 * Build one block element from a descriptor.
 * @param {object} desc Block descriptor.
 * @param {object} ctx Resolution context.
 * @param {Array<string>} warnings Collected warnings.
 * @returns {object} Element tree node.
 */
const buildBlock = (desc, ctx, warnings) => {
  if (!isPlainObject(desc) || typeof desc.opcode !== 'string' || !desc.opcode) {
    throw new Error('Each block needs an "opcode" string.');
  }
  const opcode = desc.opcode;
  const blockEl = { tag: 'block', attrs: { type: opcode, id: desc.id || generateId() }, children: [] };

  // 1. Pre-create default value inputs so the block is structurally complete.
  const required = BLOCK_INPUTS[opcode] || [];
  const providedInputs = isPlainObject(desc.inputs) ? desc.inputs : {};
  for (const inputName of required) {
    if (inputName in providedInputs) continue;
    if (BOOLEAN_INPUTS.has(inputName)) continue;
    blockEl.children.push({
      tag: 'value',
      attrs: { name: inputName },
      children: [makeShadow(opcode, inputName, defaultLiteralFor(opcode, inputName, ctx), ctx)]
    });
  }

  // 2. Explicit inputs.
  for (const [inputName, value] of Object.entries(providedInputs)) {
    const valueEl = { tag: 'value', attrs: { name: inputName }, children: [] };
    if (isPlainObject(value) && typeof value.opcode === 'string') {
      valueEl.children.push(buildBlock(value, ctx, warnings));
    } else if (isPlainObject(value) && 'variable' in value) {
      valueEl.children.push(makeFieldBlock('data_variable', 'VARIABLE', value.variable, ctx));
    } else if (isPlainObject(value) && 'list' in value) {
      valueEl.children.push(makeFieldBlock('data_listcontents', 'LIST', value.list, ctx));
    } else if (isPlainObject(value) && typeof value.__shadow === 'string') {
      // Explicit shadow type (used by the Scrathon compiler for extension menus
      // and broadcast inputs whose shadow type is not in the static tables).
      valueEl.children.push(makeExplicitShadow(value.__shadow, value.value, value.__field, ctx));
    } else if (value === null || value === undefined) {
      if (!BOOLEAN_INPUTS.has(inputName)) {
        valueEl.children.push(makeShadow(opcode, inputName, '', ctx));
      }
    } else {
      valueEl.children.push(makeShadow(opcode, inputName, value, ctx));
    }
    blockEl.children.push(valueEl);
  }

  // 3. Fields (dropdown / variable / list / broadcast).
  if (isPlainObject(desc.fields)) {
    for (const [fieldName, value] of Object.entries(desc.fields)) {
      const field = { tag: 'field', attrs: { name: fieldName }, text: String(value ?? '') };
      if (fieldName === 'VARIABLE' || fieldName === 'LIST' || fieldName === 'BROADCAST_OPTION') {
        const resolved = ctx && ctx.resolveField ? ctx.resolveField(fieldName, value) : null;
        if (resolved) {
          field.attrs.id = resolved.id;
          field.attrs.variabletype = resolved.type || '';
          field.text = resolved.name;
        }
      }
      blockEl.children.push(field);
    }
  }

  // 4. Mutation (custom blocks / advanced blocks).
  if (isPlainObject(desc.mutation)) {
    if (opcode === 'procedures_definition') {
      blockEl.children.push({
        tag: 'statement',
        attrs: { name: 'custom_block' },
        children: [
          {
            tag: 'shadow',
            attrs: { type: 'procedures_prototype' },
            children: [
              {
                tag: 'mutation',
                attrs: serializeMutation(desc.mutation),
                children: []
              }
            ]
          }
        ]
      });
    } else {
      blockEl.children.push({ tag: 'mutation', attrs: serializeMutation(desc.mutation), children: [] });
    }
  }

  // 5. Substack / else branch.
  const substack = buildStack(desc.substack, ctx, warnings);
  if (substack) blockEl.children.push({ tag: 'statement', attrs: { name: 'SUBSTACK' }, children: [substack] });
  const substack2 = buildStack(desc.substack2 || desc.ELSE, ctx, warnings);
  if (substack2) blockEl.children.push({ tag: 'statement', attrs: { name: 'SUBSTACK2' }, children: [substack2] });

  // 6. Chained next statement(s) from a single descriptor.
  if (desc.next) {
    const nextChain = buildStack(Array.isArray(desc.next) ? desc.next : [desc.next], ctx, warnings);
    if (nextChain) blockEl.children.push({ tag: 'next', attrs: {}, children: [nextChain] });
  }

  return blockEl;
};

/**
 * Build a statement stack: the first block with the rest chained via <next>.
 * @param {Array<object>} descriptors Statement descriptors.
 * @param {object} ctx Resolution context.
 * @param {Array<string>} warnings Collected warnings.
 * @returns {object|null} First block element, or null.
 */
const buildStack = (descriptors, ctx, warnings) => {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return null;
  const elements = descriptors.filter(Boolean).map((desc) => buildBlock(desc, ctx, warnings));
  if (elements.length === 0) return null;
  for (let i = elements.length - 1; i > 0; i--) {
    elements[i - 1].children.unshift({ tag: 'next', attrs: {}, children: [elements[i]] });
  }
  return elements[0];
};

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const escapeAttr = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const serializeNode = (node) => {
  const attrs = Object.entries(node.attrs || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('');
  const children = node.children || [];
  const inner = `${node.text !== undefined ? escapeText(node.text) : ''}${children.map(serializeNode).join('')}`;
  if (!inner) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
};

/**
 * Compile a list of scripts into one workspace XML document string.
 *
 * Each script is `{ x, y, blocks: [blockDescriptor, ...] }` where the block list
 * is the full stack (including the hat). Variables/lists/broadcasts referenced
 * by name are resolved through `ctx`; unknown ones are collected as
 * `declarations` so the applier can create them (on both the workspace and the
 * VM) before loading the blocks. They are intentionally NOT embedded in the XML,
 * because `domToVariables` would create them on the workspace only and the VM
 * would never learn about them.
 *
 * @param {Array<object>} scripts Script descriptors.
 * @param {object} ctx Resolution context (see tools.js makeVarContext).
 * @returns {{xml: string, scripts: number, warnings: Array<string>, declarations: Array<object>}}
 */
export const buildScriptsXml = (scripts, ctx) => {
  if (!Array.isArray(scripts) || scripts.length === 0) {
    throw new Error('No scripts were provided.');
  }
  const warnings = [];
  const blockRoots = [];
  for (const script of scripts) {
    const blocks = Array.isArray(script && script.blocks) ? script.blocks : null;
    if (!blocks || blocks.length === 0) {
      throw new Error('Every script needs a non-empty "blocks" array.');
    }
    const root = buildStack(blocks, ctx, warnings);
    if (!root) continue;
    const x = Number.isFinite(Number(script.x)) ? Number(script.x) : 60 + blockRoots.length * 40;
    const y = Number.isFinite(Number(script.y)) ? Number(script.y) : 60 + blockRoots.length * 360;
    root.attrs.x = x;
    root.attrs.y = y;
    blockRoots.push(root);
  }

  const declarations = ctx && typeof ctx.drainDeclarations === 'function' ? ctx.drainDeclarations() : [];
  const parts = ['<xml xmlns="http://www.w3.org/1999/xhtml">'];
  for (const root of blockRoots) parts.push(serializeNode(root));
  parts.push('</xml>');

  return { xml: parts.join(''), scripts: blockRoots.length, warnings, declarations };
};

/**
 * Describe the core opcodes an agent can use, for the block-catalog tool.
 * @param {string} [filter] Optional case-insensitive substring filter.
 * @returns {Array<object>} Compact descriptions.
 */
export const describeCoreBlocks = (filter = '') => {
  const needle = String(filter || '').toLowerCase();
  const entries = Object.entries(BLOCK_INPUTS)
    .filter(([opcode]) => !needle || opcode.toLowerCase().includes(needle))
    .map(([opcode, inputs]) => ({ opcode, inputs: inputs.slice() }));
  // Opcodes with no value inputs but that are still useful statements.
  const extra = [
    'event_whenflagclicked',
    'event_whenthisspriteclicked',
    'event_whenstageclicked',
    'event_whenbackdropswitchesto',
    'control_forever',
    'control_stop',
    'control_delete_this_clone',
    'control_start_as_clone',
    'looks_show',
    'looks_hide',
    'looks_nextcostume',
    'looks_nextbackdrop',
    'looks_cleargraphiceffects',
    'motion_ifonedgebounce',
    'motion_setrotationstyle',
    'sound_stopallsounds',
    'data_deletealloflist',
    'sensing_resettimer'
  ];
  for (const opcode of extra) {
    if (needle && !opcode.toLowerCase().includes(needle)) continue;
    if (!entries.some((entry) => entry.opcode === opcode)) entries.push({ opcode, inputs: [] });
  }
  return entries;
};
