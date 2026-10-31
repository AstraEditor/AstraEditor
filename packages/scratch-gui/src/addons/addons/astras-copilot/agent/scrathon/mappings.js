/**
 * Scrathon instruction tables.
 *
 * A single source of truth mapping Scrathon instruction names to the exact
 * scratch-blocks opcodes, input names and field names they compile to. Both the
 * compiler and the decompiler read from here, so the two directions cannot
 * drift apart.
 *
 * Argument descriptors use `{ t, k, name }`:
 *   - `t`  value tag, matching the `${t:v}` sigils: n, s, b, c, m, v, l, msg
 *   - `k`  where the value goes: 'input' (a shadow input) or 'field' (a dropdown
 *          / variable field on the block itself)
 *   - `name` the scratch-blocks input or field name
 */

/** Value tags used inside `${t:v}` sigils. */
export const TAGS = ['n', 's', 'b', 'c', 'm', 'v', 'l', 'msg'];

/** `field` variable-type keyed by tag, matching the VM's variable types. */
export const TAG_VARIABLE_TYPE = {
  v: '',
  l: 'list',
  msg: 'broadcast_msg'
};

/**
 * Declare an argument descriptor.
 * @param {string} t Value tag.
 * @param {'input'|'field'} k Argument kind.
 * @param {string} name Input or field name.
 * @returns {object} Argument descriptor.
 */
const arg = (t, k, name) => ({ t, k, name });

/**
 * Declare a function instruction.
 * @param {string} opcode Target opcode.
 * @param {Array<object>} args Argument descriptors.
 * @param {object} [options] Extra options.
 * @returns {object} Instruction descriptor.
 */
const fn = (opcode, args = [], options = {}) => ({
  opcode,
  args,
  shape: options.shape || 'statement',
  substacks: options.substacks || 0,
  reporter: options.reporter || false
});

// ---------------------------------------------------------------------------
// Statement / reporter functions
// ---------------------------------------------------------------------------

/** Scrathon function name -> instruction descriptor. */
export const FUNCTIONS = {
  // --- Motion --------------------------------------------------------------
  move: fn('motion_movesteps', [arg('n', 'input', 'STEPS')]),
  turn_right: fn('motion_turnright', [arg('n', 'input', 'DEGREES')]),
  turn_left: fn('motion_turnleft', [arg('n', 'input', 'DEGREES')]),
  go_to_xy: fn('motion_gotoxy', [arg('n', 'input', 'X'), arg('n', 'input', 'Y')]),
  go_to: fn('motion_goto', [arg('m', 'input', 'TO')]),
  glide_to_xy: fn('motion_glidesecstoxy', [arg('n', 'input', 'SECS'), arg('n', 'input', 'X'), arg('n', 'input', 'Y')]),
  glide_to: fn('motion_glideto', [arg('n', 'input', 'SECS'), arg('m', 'input', 'TO')]),
  point_in_direction: fn('motion_pointindirection', [arg('n', 'input', 'DIRECTION')]),
  point_towards: fn('motion_pointtowards', [arg('m', 'input', 'TOWARDS')]),
  change_x: fn('motion_changexby', [arg('n', 'input', 'DX')]),
  set_x: fn('motion_setx', [arg('n', 'input', 'X')]),
  change_y: fn('motion_changeyby', [arg('n', 'input', 'DY')]),
  set_y: fn('motion_sety', [arg('n', 'input', 'Y')]),
  bounce_on_edge: fn('motion_ifonedgebounce'),
  set_rotation_style: fn('motion_setrotationstyle', [arg('m', 'field', 'STYLE')]),
  x_position: fn('motion_xposition', [], { shape: 'reporter', reporter: true }),
  y_position: fn('motion_yposition', [], { shape: 'reporter', reporter: true }),
  direction: fn('motion_direction', [], { shape: 'reporter', reporter: true }),

  // --- Looks ---------------------------------------------------------------
  say: fn('looks_say', [arg('s', 'input', 'MESSAGE')]),
  say_for_secs: fn('looks_sayforsecs', [arg('s', 'input', 'MESSAGE'), arg('n', 'input', 'SECS')]),
  think: fn('looks_think', [arg('s', 'input', 'MESSAGE')]),
  think_for_secs: fn('looks_thinkforsecs', [arg('s', 'input', 'MESSAGE'), arg('n', 'input', 'SECS')]),
  show: fn('looks_show'),
  hide: fn('looks_hide'),
  switch_costume: fn('looks_switchcostumeto', [arg('m', 'input', 'COSTUME')]),
  next_costume: fn('looks_nextcostume'),
  switch_backdrop: fn('looks_switchbackdropto', [arg('m', 'input', 'BACKDROP')]),
  switch_backdrop_and_wait: fn('looks_switchbackdroptoandwait', [arg('m', 'input', 'BACKDROP')]),
  next_backdrop: fn('looks_nextbackdrop'),
  go_to_layer: fn('looks_gotofrontback', [arg('m', 'field', 'FRONT_BACK')]),
  go_layers: fn('looks_goforwardbackwardlayers', [arg('m', 'field', 'FORWARD_BACKWARD'), arg('n', 'input', 'NUM')]),
  change_effect_by: fn('looks_changeeffectby', [arg('m', 'field', 'EFFECT'), arg('n', 'input', 'CHANGE')]),
  set_effect: fn('looks_seteffectto', [arg('m', 'field', 'EFFECT'), arg('n', 'input', 'VALUE')]),
  clear_graphic_effects: fn('looks_cleargraphiceffects'),
  change_size_by: fn('looks_changesizeby', [arg('n', 'input', 'CHANGE')]),
  set_size_to: fn('looks_setsizeto', [arg('n', 'input', 'SIZE')]),
  size: fn('looks_size', [], { shape: 'reporter', reporter: true }),
  costume_number_name: fn('looks_costumenumbername', [arg('m', 'field', 'NUMBER_NAME')], {
    shape: 'reporter',
    reporter: true
  }),
  backdrop_number_name: fn('looks_backdropnumbername', [arg('m', 'field', 'NUMBER_NAME')], {
    shape: 'reporter',
    reporter: true
  }),

  // --- Sound ---------------------------------------------------------------
  start_sound: fn('sound_play', [arg('m', 'input', 'SOUND_MENU')]),
  play_sound_until_done: fn('sound_playuntildone', [arg('m', 'input', 'SOUND_MENU')]),
  stop_all_sounds: fn('sound_stopallsounds'),
  set_sound_effect: fn('sound_seteffectto', [arg('m', 'field', 'EFFECT'), arg('n', 'input', 'VALUE')]),
  change_sound_effect_by: fn('sound_changeeffectby', [arg('m', 'field', 'EFFECT'), arg('n', 'input', 'VALUE')]),
  clear_sound_effects: fn('sound_cleareffects'),
  change_volume_by: fn('sound_changevolumeby', [arg('n', 'input', 'VOLUME')]),
  set_volume_to: fn('sound_setvolumeto', [arg('n', 'input', 'VOLUME')]),
  volume: fn('sound_volume', [], { shape: 'reporter', reporter: true }),

  // --- Control -------------------------------------------------------------
  wait: fn('control_wait', [arg('n', 'input', 'DURATION')]),
  wait_until: fn('control_wait_until', [arg('b', 'input', 'CONDITION')]),
  stop: fn('control_stop', [arg('m', 'field', 'STOP_OPTION')]),
  create_clone_of: fn('control_create_clone_of', [arg('m', 'input', 'CLONE_OPTION')]),
  delete_this_clone: fn('control_delete_this_clone'),

  // --- Sensing -------------------------------------------------------------
  touching: fn('sensing_touchingobject', [arg('m', 'input', 'TOUCHINGOBJECTMENU')], {
    shape: 'boolean',
    reporter: true
  }),
  touching_color: fn('sensing_touchingcolor', [arg('c', 'input', 'COLOR')], { shape: 'boolean', reporter: true }),
  color_is_touching_color: fn(
    'sensing_coloristouchingcolor',
    [arg('c', 'input', 'COLOR'), arg('c', 'input', 'COLOR2')],
    {
      shape: 'boolean',
      reporter: true
    }
  ),
  distance_to: fn('sensing_distanceto', [arg('m', 'input', 'DISTANCETOMENU')], { shape: 'reporter', reporter: true }),
  ask_and_wait: fn('sensing_askandwait', [arg('s', 'input', 'QUESTION')]),
  answer: fn('sensing_answer', [], { shape: 'reporter', reporter: true }),
  key_pressed: fn('sensing_keypressed', [arg('m', 'input', 'KEY_OPTION')], { shape: 'boolean', reporter: true }),
  mouse_down: fn('sensing_mousedown', [], { shape: 'boolean', reporter: true }),
  mouse_x: fn('sensing_mousex', [], { shape: 'reporter', reporter: true }),
  mouse_y: fn('sensing_mousey', [], { shape: 'reporter', reporter: true }),
  set_drag_mode: fn('sensing_setdragmode', [arg('m', 'field', 'DRAG_MODE')]),
  timer: fn('sensing_timer', [], { shape: 'reporter', reporter: true }),
  reset_timer: fn('sensing_resettimer'),
  of: fn('sensing_of', [arg('m', 'field', 'PROPERTY'), arg('m', 'input', 'OBJECT')], {
    shape: 'reporter',
    reporter: true
  }),
  current: fn('sensing_current', [arg('m', 'field', 'CURRENTMENU')], { shape: 'reporter', reporter: true }),
  days_since_2000: fn('sensing_dayssince2000', [], { shape: 'reporter', reporter: true }),
  username: fn('sensing_username', [], { shape: 'reporter', reporter: true }),
  loudness: fn('sensing_loudness', [], { shape: 'reporter', reporter: true }),

  // --- Variables / lists ---------------------------------------------------
  set_var: fn('data_setvariableto', [arg('v', 'field', 'VARIABLE'), arg('s', 'input', 'VALUE')]),
  change_var: fn('data_changevariableby', [arg('v', 'field', 'VARIABLE'), arg('n', 'input', 'VALUE')]),
  show_variable: fn('data_showvariable', [arg('v', 'field', 'VARIABLE')]),
  hide_variable: fn('data_hidevariable', [arg('v', 'field', 'VARIABLE')]),
  list_add: fn('data_addtolist', [arg('l', 'field', 'LIST'), arg('s', 'input', 'ITEM')]),
  list_delete: fn('data_deleteoflist', [arg('l', 'field', 'LIST'), arg('n', 'input', 'INDEX')]),
  list_delete_all: fn('data_deletealloflist', [arg('l', 'field', 'LIST')]),
  list_insert: fn('data_insertatlist', [
    arg('l', 'field', 'LIST'),
    arg('n', 'input', 'INDEX'),
    arg('s', 'input', 'ITEM')
  ]),
  list_replace: fn('data_replaceitemoflist', [
    arg('l', 'field', 'LIST'),
    arg('n', 'input', 'INDEX'),
    arg('s', 'input', 'ITEM')
  ]),
  list_item: fn('data_itemoflist', [arg('l', 'field', 'LIST'), arg('n', 'input', 'INDEX')], {
    shape: 'reporter',
    reporter: true
  }),
  list_item_num: fn('data_itemnumoflist', [arg('l', 'field', 'LIST'), arg('s', 'input', 'ITEM')], {
    shape: 'reporter',
    reporter: true
  }),
  list_length: fn('data_lengthoflist', [arg('l', 'field', 'LIST')], { shape: 'reporter', reporter: true }),
  list_contains: fn('data_listcontainsitem', [arg('l', 'field', 'LIST'), arg('s', 'input', 'ITEM')], {
    shape: 'boolean',
    reporter: true
  }),
  show_list: fn('data_showlist', [arg('l', 'field', 'LIST')]),
  hide_list: fn('data_hidelist', [arg('l', 'field', 'LIST')]),

  // --- Events (broadcasts used as statements) ------------------------------
  broadcast: fn('event_broadcast', [arg('msg', 'input', 'BROADCAST_INPUT')]),
  broadcast_and_wait: fn('event_broadcastandwait', [arg('msg', 'input', 'BROADCAST_INPUT')])
};

/**
 * Control-flow instructions that use a `name(...): <block>` body instead of a
 * plain call. Kept separate so the parser can special-case their shape.
 */
export const CONTROL_FUNCTIONS = {
  repeat: { opcode: 'control_repeat', args: [arg('n', 'input', 'TIMES')], substacks: 1 },
  forever: { opcode: 'control_forever', args: [], substacks: 1 },
  repeat_until: { opcode: 'control_repeat_until', args: [arg('b', 'input', 'CONDITION')], substacks: 1 },
  while: { opcode: 'control_while', args: [arg('b', 'input', 'CONDITION')], substacks: 1 },
  for_each: {
    opcode: 'control_for_each',
    args: [arg('v', 'field', 'VARIABLE'), arg('n', 'input', 'VALUE')],
    substacks: 1
  }
};

/** `if` / `if ... else` control instructions. */
export const IF_FUNCTION = { opcode: 'control_if', args: [arg('b', 'input', 'CONDITION')], substacks: 1 };
export const IF_ELSE_FUNCTION = { opcode: 'control_if_else', args: [arg('b', 'input', 'CONDITION')], substacks: 2 };

// ---------------------------------------------------------------------------
// Hat decorators
// ---------------------------------------------------------------------------

/** Scrathon decorator name -> hat instruction descriptor. */
export const HAT_DECORATORS = {
  when_flag_clicked: { opcode: 'event_whenflagclicked', args: [] },
  when_key_pressed: { opcode: 'event_whenkeypressed', args: [arg('m', 'field', 'KEY_OPTION')] },
  when_this_sprite_clicked: { opcode: 'event_whenthisspriteclicked', args: [] },
  when_stage_clicked: { opcode: 'event_whenstageclicked', args: [] },
  when_backdrop_switches: { opcode: 'event_whenbackdropswitchesto', args: [arg('m', 'field', 'BACKDROP')] },
  when_greater_than: {
    opcode: 'event_whengreaterthan',
    args: [arg('m', 'field', 'WHENGREATERTHANMENU'), arg('n', 'input', 'VALUE')]
  },
  when_broadcast: { opcode: 'event_whenbroadcastreceived', args: [arg('msg', 'field', 'BROADCAST_OPTION')] },
  when_i_start_as_clone: { opcode: 'control_start_as_clone', args: [] }
};

// ---------------------------------------------------------------------------
// Expression operators
// ---------------------------------------------------------------------------

/** Infix binary numeric operators: token -> opcode. */
export const NUMERIC_BINARY_OPS = {
  '+': 'operator_add',
  '-': 'operator_subtract',
  '*': 'operator_multiply',
  '/': 'operator_divide',
  '%': 'operator_mod'
};

/** Infix comparison operators: token -> opcode (boolean). */
export const COMPARISON_OPS = {
  '>': 'operator_gt',
  '<': 'operator_lt',
  '==': 'operator_equals',
  '=': 'operator_equals'
};

/** Infix logical operators: keyword -> opcode (boolean). */
export const LOGICAL_BINARY_OPS = {
  and: 'operator_and',
  or: 'operator_or'
};

/** Unary logical negation keyword -> opcode. */
export const LOGICAL_NOT = 'operator_not';

/** Expression-level function calls: name -> opcode. */
export const EXPRESSION_FUNCTIONS = {
  random: 'operator_random',
  join: 'operator_join',
  letter_of: 'operator_letter_of',
  length_of: 'operator_length',
  contains: 'operator_contains',
  round: 'operator_round',
  math: 'operator_mathop'
};

/** Argument descriptors for expression-level function calls. */
export const EXPRESSION_FUNCTION_ARGS = {
  random: [arg('n', 'input', 'FROM'), arg('n', 'input', 'TO')],
  join: [arg('s', 'input', 'STRING1'), arg('s', 'input', 'STRING2')],
  letter_of: [arg('n', 'input', 'LETTER'), arg('s', 'input', 'STRING')],
  length_of: [arg('s', 'input', 'STRING')],
  contains: [arg('s', 'input', 'STRING1'), arg('s', 'input', 'STRING2')],
  round: [arg('n', 'input', 'NUM')],
  math: [arg('m', 'field', 'OPERATOR'), arg('n', 'input', 'NUM')]
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Reverse map: opcode -> function name (statement/reporter instructions). */
export const OPCODE_TO_FUNCTION = (() => {
  const map = new Map();
  for (const [name, descriptor] of Object.entries(FUNCTIONS)) {
    map.set(descriptor.opcode, name);
  }
  return map;
})();

/** Reverse map: opcode -> control-flow function name. */
export const OPCODE_TO_CONTROL = (() => {
  const map = new Map();
  for (const [name, descriptor] of Object.entries(CONTROL_FUNCTIONS)) {
    map.set(descriptor.opcode, name);
  }
  return map;
})();

/** Reverse map: opcode -> hat decorator name. */
export const OPCODE_TO_HAT = (() => {
  const map = new Map();
  for (const [name, descriptor] of Object.entries(HAT_DECORATORS)) {
    map.set(descriptor.opcode, name);
  }
  return map;
})();

/** All built-in opcodes the decompiler knows how to render. */
export const KNOWN_OPCODES = new Set([
  ...OPCODE_TO_FUNCTION.keys(),
  ...OPCODE_TO_CONTROL.keys(),
  ...OPCODE_TO_HAT.keys(),
  'control_if',
  'control_if_else',
  'procedures_definition',
  'procedures_call',
  'argument_reporter_string_number',
  'argument_reporter_boolean',
  'data_variable',
  'data_listcontents'
]);

// ---------------------------------------------------------------------------
// Aliases for LLM robustness
// ---------------------------------------------------------------------------

export const FUNCTION_ALIASES = {
  turnright: 'turn_right',
  turnleft: 'turn_left',
  goto: 'go_to',
  gotoxy: 'go_to_xy',
  gotarget: 'go_to',
  glideto: 'glide_to',
  glidetoxy: 'glide_to_xy',
  pointindirection: 'point_in_direction',
  pointtowards: 'point_towards',
  changex: 'change_x',
  changexby: 'change_x',
  setx: 'set_x',
  setxto: 'set_x',
  changey: 'change_y',
  changeyby: 'change_y',
  sety: 'set_y',
  setyto: 'set_y',
  bounceonedge: 'bounce_on_edge',
  ifonedgebounce: 'bounce_on_edge',
  sayfor: 'say_for_secs',
  sayforsecs: 'say_for_secs',
  sayforseconds: 'say_for_secs',
  thinkfor: 'think_for_secs',
  thinkforsecs: 'think_for_secs',
  thinkforseconds: 'think_for_secs',
  switchcostume: 'switch_costume',
  setcostume: 'switch_costume',
  nextcostume: 'next_costume',
  switchbackdrop: 'switch_backdrop',
  setbackdrop: 'switch_backdrop',
  nextbackdrop: 'next_backdrop',
  playsound: 'start_sound',
  startsound: 'start_sound',
  playsounduntildone: 'play_sound_until_done',
  playsoundandwait: 'play_sound_until_done',
  stopallsounds: 'stop_all_sounds',
  setvolume: 'set_volume_to',
  setvolumeto: 'set_volume_to',
  changevolume: 'change_volume_by',
  changevolumeby: 'change_volume_by',
  setvariable: 'set_var',
  setvar: 'set_var',
  setvariableto: 'set_var',
  changevariable: 'change_var',
  changevar: 'change_var',
  changevariableby: 'change_var',
  showvariable: 'show_variable',
  hidevariable: 'hide_variable',
  addtolist: 'list_add',
  deletefromlist: 'list_delete',
  deletealloflist: 'list_delete_all',
  clearlist: 'list_delete_all',
  insertatlist: 'list_insert',
  waitseconds: 'wait',
  waitsecs: 'wait',
  waituntil: 'wait_until',
  broadcastandwait: 'broadcast_and_wait',
  broadcastwait: 'broadcast_and_wait',

  // Pen extension aliases
  pen_clear: 'pen.clear',
  pen_stamp: 'pen.stamp',
  pen_down: 'pen.penDown',
  pen_pendown: 'pen.penDown',
  pen_up: 'pen.penUp',
  pen_penup: 'pen.penUp',
  clear_pen: 'pen.clear',
  set_pen_color: 'pen.setPenColorToColor',
  set_pen_size: 'pen.setPenSizeTo',
  change_pen_size: 'pen.changePenSizeBy',

  // Music extension aliases
  music_play_note: 'music.playNoteForBeats',
  music_rest: 'music.restForBeats',
  music_play_drum: 'music.playDrumForBeats',
  music_set_instrument: 'music.setInstrument',
  music_set_tempo: 'music.setTempo',
  music_change_tempo: 'music.changeTempo',

  // Text2speech extension aliases
  text2speech_speak: 'text2speech.speakAndWait',
  text2speech_voice: 'text2speech.setVoice',
  text2speech_language: 'text2speech.setLanguage'
};

export const HAT_ALIASES = {
  when_green_flag_clicked: 'when_flag_clicked',
  when_flag: 'when_flag_clicked',
  when_clicked: 'when_this_sprite_clicked',
  when_sprite_clicked: 'when_this_sprite_clicked',
  when_backdrop_switch: 'when_backdrop_switches',
  when_backdrop_switches_to: 'when_backdrop_switches',
  when_backdropswitchesto: 'when_backdrop_switches',
  when_key_press: 'when_key_pressed',
  when_keypressed: 'when_key_pressed',
  when_thisspriteclicked: 'when_this_sprite_clicked',
  when_stageclicked: 'when_stage_clicked',
  when_greaterthan: 'when_greater_than',
  when_broadcast_received: 'when_broadcast',
  when_broadcastreceived: 'when_broadcast',
  when_clone_starts: 'when_i_start_as_clone',
  when_start_as_clone: 'when_i_start_as_clone',
  when_istartasclone: 'when_i_start_as_clone',
  on_flag: 'when_flag_clicked',
  on_key: 'when_key_pressed',
  on_clicked: 'when_this_sprite_clicked',
  on_stage_clicked: 'when_stage_clicked',
  on_backdrop_switch: 'when_backdrop_switches',
  on_greater_than: 'when_greater_than',
  on_broadcast: 'when_broadcast',
  on_start_as_clone: 'when_i_start_as_clone'
};

export const KNOWN_BUILTIN_EXTENSIONS = new Set(['pen', 'music', 'text2speech', 'translate', 'videoSensing']);

export const BUILTIN_EXTENSION_CATALOG = [
  // Pen
  { name: 'pen.clear', category: 'pen', kind: 'extension', signature: 'import pen\npen.clear()', opcode: 'pen_clear' },
  { name: 'pen.stamp', category: 'pen', kind: 'extension', signature: 'import pen\npen.stamp()', opcode: 'pen_stamp' },
  {
    name: 'pen.penDown',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.penDown()',
    opcode: 'pen_penDown'
  },
  { name: 'pen.penUp', category: 'pen', kind: 'extension', signature: 'import pen\npen.penUp()', opcode: 'pen_penUp' },
  {
    name: 'pen.setPenColorToColor',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.setPenColorToColor(${c:"#00E5FF"})',
    opcode: 'pen_setPenColorToColor'
  },
  {
    name: 'pen.setPenSizeTo',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.setPenSizeTo(${n:size})',
    opcode: 'pen_setPenSizeTo'
  },
  {
    name: 'pen.changePenSizeBy',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.changePenSizeBy(${n:delta})',
    opcode: 'pen_changePenSizeBy'
  },
  {
    name: 'pen.setPenColorParamTo',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.setPenColorParamTo(${m:param}, ${n:value})',
    opcode: 'pen_setPenColorParamTo'
  },
  {
    name: 'pen.changePenColorParamBy',
    category: 'pen',
    kind: 'extension',
    signature: 'import pen\npen.changePenColorParamBy(${m:param}, ${n:delta})',
    opcode: 'pen_changePenColorParamBy'
  },

  // Music
  {
    name: 'music.playDrumForBeats',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.playDrumForBeats(${m:drum}, ${n:beats})',
    opcode: 'music_playDrumForBeats'
  },
  {
    name: 'music.restForBeats',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.restForBeats(${n:beats})',
    opcode: 'music_restForBeats'
  },
  {
    name: 'music.playNoteForBeats',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.playNoteForBeats(${n:note}, ${n:beats})',
    opcode: 'music_playNoteForBeats'
  },
  {
    name: 'music.setInstrument',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.setInstrument(${m:instrument})',
    opcode: 'music_setInstrument'
  },
  {
    name: 'music.setTempo',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.setTempo(${n:tempo})',
    opcode: 'music_setTempo'
  },
  {
    name: 'music.changeTempo',
    category: 'music',
    kind: 'extension',
    signature: 'import music\nmusic.changeTempo(${n:delta})',
    opcode: 'music_changeTempo'
  },

  // Text to Speech
  {
    name: 'text2speech.speakAndWait',
    category: 'text2speech',
    kind: 'extension',
    signature: 'import text2speech\ntext2speech.speakAndWait(${s:text})',
    opcode: 'text2speech_speakAndWait'
  },
  {
    name: 'text2speech.setVoice',
    category: 'text2speech',
    kind: 'extension',
    signature: 'import text2speech\ntext2speech.setVoice(${m:voice})',
    opcode: 'text2speech_setVoice'
  },
  {
    name: 'text2speech.setLanguage',
    category: 'text2speech',
    kind: 'extension',
    signature: 'import text2speech\ntext2speech.setLanguage(${m:language})',
    opcode: 'text2speech_setLanguage'
  },

  // Translate
  {
    name: 'translate.getTranslate',
    category: 'translate',
    kind: 'extension',
    signature: 'import translate\ntranslate.getTranslate(${s:text}, ${m:language})',
    opcode: 'translate_getTranslate'
  },
  {
    name: 'translate.getViewerLanguage',
    category: 'translate',
    kind: 'extension',
    signature: 'import translate\ntranslate.getViewerLanguage()',
    opcode: 'translate_getViewerLanguage'
  }
];

/**
 * Build the full Scrathon DSL catalog for model lookup.
 * @param {string} [query] Optional search query.
 * @returns {Array<object>} Catalog entries.
 */
export const describeScrathonCatalog = (query = '') => {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  const results = [];

  const add = (name, category, kind, signature, opcode) => {
    if (
      !needle ||
      name.toLowerCase().includes(needle) ||
      category.toLowerCase().includes(needle) ||
      kind.toLowerCase().includes(needle) ||
      signature.toLowerCase().includes(needle) ||
      (opcode && opcode.toLowerCase().includes(needle))
    ) {
      results.push({ name, category, kind, signature });
    }
  };

  const getCategory = (opcode) => {
    if (opcode.startsWith('motion_')) return 'motion';
    if (opcode.startsWith('looks_')) return 'looks';
    if (opcode.startsWith('sound_')) return 'sound';
    if (opcode.startsWith('event_')) return 'events';
    if (opcode.startsWith('control_')) return 'control';
    if (opcode.startsWith('sensing_')) return 'sensing';
    if (opcode.startsWith('data_')) return 'variables';
    if (opcode.startsWith('operator_')) return 'operators';
    return 'other';
  };

  // 1. Hat decorators
  for (const [name, descriptor] of Object.entries(HAT_DECORATORS)) {
    const args = (descriptor.args || []).map((a) => `\${${a.t}:${a.name.toLowerCase()}}`).join(', ');
    const signature = `@${name}${args ? `(${args})` : ''}\ndef on_${name}():`;
    add(`@${name}`, 'events', 'hat', signature, descriptor.opcode);
  }

  // 2. Control flow blocks (blocks with colons)
  for (const [name, descriptor] of Object.entries(CONTROL_FUNCTIONS)) {
    const args = (descriptor.args || []).map((a) => `\${${a.t}:${a.name.toLowerCase()}}`).join(', ');
    const signature = `${name}(${args}):`;
    add(name, 'control', 'control', signature, descriptor.opcode);
  }

  // If / elif / else
  add('if', 'control', 'control', 'if ${b:condition}:', 'control_if');
  add('elif', 'control', 'control', 'elif ${b:condition}:', 'control_if_else');
  add('else', 'control', 'control', 'else:', 'control_if_else');

  // 3. Statement / reporter functions
  for (const [name, descriptor] of Object.entries(FUNCTIONS)) {
    const args = (descriptor.args || []).map((a) => `\${${a.t}:${a.name.toLowerCase()}}`).join(', ');
    const signature = `${name}(${args})`;
    const kind = descriptor.shape || (descriptor.reporter ? 'reporter' : 'statement');
    const category = getCategory(descriptor.opcode);
    add(name, category, kind, signature, descriptor.opcode);
  }

  // 4. Expression functions
  for (const [name, opcode] of Object.entries(EXPRESSION_FUNCTIONS)) {
    const argList = EXPRESSION_FUNCTION_ARGS[name] || [];
    const args = argList.map((a) => `\${${a.t}:${a.name.toLowerCase()}}`).join(', ');
    const signature = `${name}(${args})`;
    add(name, 'operators', 'reporter', signature, opcode);
  }

  // 5. Built-in extension functions
  for (const item of BUILTIN_EXTENSION_CATALOG) {
    add(item.name, item.category, item.kind, item.signature, item.opcode);
  }

  return results;
};
