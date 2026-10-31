/**
 * Catalog helpers: enrich Scrathon block entries with argument types and the
 * options of dropdown / menu arguments.
 *
 * Core Scratch menus are static or project-local; extension menus come from
 * the VM's extension metadata. The output is intentionally JSON-friendly so it
 * can be returned directly from the `block_catalog` tool.
 */

const KEY_OPTIONS = [
  'space',
  'up arrow',
  'down arrow',
  'right arrow',
  'left arrow',
  'any',
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split('')
];

const LOOKS_EFFECTS = ['COLOR', 'FISHEYE', 'WHIRL', 'PIXELATE', 'MOSAIC', 'BRIGHTNESS', 'GHOST'];

const MATH_OPERATORS = [
  'abs',
  'floor',
  'ceiling',
  'sqrt',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'ln',
  'log',
  'e ^',
  '10 ^'
];

const OF_PROPERTIES = [
  'x position',
  'y position',
  'direction',
  'costume #',
  'costume name',
  'size',
  'volume',
  'backdrop #',
  'backdrop name'
];

/** Static core menu options keyed by argument name. */
const STATIC_OPTIONS = {
  STYLE: ['left-right', "don't rotate", 'all around'],
  FRONT_BACK: ['front', 'back'],
  FORWARD_BACKWARD: ['forward', 'backward'],
  STOP_OPTION: ['all', 'this script', 'other scripts in sprite'],
  DRAG_MODE: ['draggable', 'not draggable'],
  CURRENTMENU: ['YEAR', 'MONTH', 'DATE', 'DAYOFWEEK', 'HOUR', 'MINUTE', 'SECOND'],
  OPERATOR: MATH_OPERATORS,
  PROPERTY: OF_PROPERTIES,
  NUMBER_NAME: ['number', 'name'],
  KEY_OPTION: KEY_OPTIONS,
  WHENGREATERTHANMENU: ['LOUDNESS', 'TIMER'],
  EFFECT: LOOKS_EFFECTS,
  COLOR_PARAM: ['color', 'saturation', 'brightness', 'transparency']
};

/** Per-opcode overrides for argument names that share a name with another menu. */
const OPCODE_OPTIONS = {
  sound_seteffectto__EFFECT: ['PITCH', 'PAN'],
  sound_changeeffectby__EFFECT: ['PITCH', 'PAN'],
  looks_seteffectto__EFFECT: LOOKS_EFFECTS,
  looks_changeeffectby__EFFECT: LOOKS_EFFECTS,
  pen_setPenColorParamTo__COLOR_PARAM: ['color', 'saturation', 'brightness', 'transparency'],
  pen_changePenColorParamBy__COLOR_PARAM: ['color', 'saturation', 'brightness', 'transparency']
};

/** Menu arguments whose options come from the current project. */
const DYNAMIC_SOURCES = {
  VARIABLE: 'variables',
  LIST: 'lists',
  BROADCAST_OPTION: 'broadcasts',
  BROADCAST_INPUT: 'broadcasts',
  COSTUME: 'costumes',
  BACKDROP: 'backdrops',
  SOUND_MENU: 'sounds',
  TO: 'sprites',
  TOWARDS: 'sprites',
  TOUCHINGOBJECTMENU: 'sprites',
  DISTANCETOMENU: 'sprites',
  CLONE_OPTION: 'sprites',
  OBJECT: 'sprites'
};

/** Special sprite-menu values for a specific block + argument. */
const SPECIAL_SPRITE_OPTIONS = {
  motion_goto__TO: ['_mouse_', '_random_'],
  motion_glideto__TO: ['_mouse_', '_random_'],
  motion_pointtowards__TOWARDS: ['_mouse_', '_random_'],
  sensing_touchingobject__TOUCHINGOBJECTMENU: ['_mouse_', '_edge_'],
  sensing_distanceto__DISTANCETOMENU: ['_mouse_'],
  control_create_clone_of__CLONE_OPTION: ['_myself_'],
  sensing_of__OBJECT: ['_stage_']
};

const toOptions = (values) => values.map((value) => (typeof value === 'string' ? { label: value, value } : value));

const getStage = (vm) => {
  return vm && vm.runtime && typeof vm.runtime.getTargetForStage === 'function' ? vm.runtime.getTargetForStage() : null;
};

const getEditingTarget = (vm) => {
  return vm && vm.runtime && typeof vm.runtime.getEditingTarget === 'function' ? vm.runtime.getEditingTarget() : null;
};

const uniqueOptions = (options) => {
  const seen = new Set();
  const result = [];
  for (const option of options) {
    const key = `${option.scope || ''}:${option.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  return result;
};

const collectVariables = (target, stage, type) => {
  const holders =
    target && target !== stage
      ? [
          [target, 'local'],
          [stage, 'global']
        ]
      : [[stage, 'global']];
  const options = [];
  for (const [holder, scope] of holders) {
    if (!holder) continue;
    for (const variable of Object.values(holder.variables || {})) {
      if (!variable || variable.type !== type) continue;
      options.push({
        label: `${variable.name} (${scope})`,
        value: variable.name,
        scope
      });
    }
  }
  return uniqueOptions(options);
};

const collectBroadcasts = (stage) => {
  const options = [];
  for (const variable of Object.values((stage && stage.variables) || {})) {
    if (!variable || variable.type !== 'broadcast_msg') continue;
    options.push({ label: variable.name, value: variable.name, scope: 'global' });
  }
  return uniqueOptions(options);
};

const collectAssets = (holder, getter) => {
  if (!holder || typeof holder[getter] !== 'function') return [];
  return holder[getter]().map((asset) => ({ label: asset.name, value: asset.name }));
};

const collectSprites = (vm, opcode, argName) => {
  const special = SPECIAL_SPRITE_OPTIONS[`${opcode}__${argName}`] || [];
  const sprites =
    vm && vm.runtime && Array.isArray(vm.runtime.targets)
      ? vm.runtime.targets.filter((target) => target && !target.isStage).map((target) => target.getName())
      : [];
  return uniqueOptions([...special, ...sprites].map((name) => ({ label: name, value: name })));
};

const resolveDynamic = (source, vm, target) => {
  const stage = getStage(vm);
  const current = target || getEditingTarget(vm) || stage;
  switch (source) {
    case 'variables':
      return collectVariables(current, stage, '');
    case 'lists':
      return collectVariables(current, stage, 'list');
    case 'broadcasts':
      return collectBroadcasts(stage);
    case 'costumes':
      return collectAssets(current, 'getCostumes');
    case 'backdrops':
      return collectAssets(stage, 'getCostumes');
    case 'sounds':
      return collectAssets(current, 'getSounds');
    case 'sprites':
      return collectSprites(vm, '', '');
    default:
      return [];
  }
};

/**
 * Convert extension menu items into `{label, value}` objects.
 * @param {*} items Menu items array, or a function returning one.
 * @returns {Array<object>|null} Options, or null when the menu is dynamic.
 */
const normalizeExtensionItems = (items) => {
  let resolved = items;
  if (typeof resolved === 'function') {
    try {
      resolved = resolved();
    } catch (error) {
      return null;
    }
  }
  if (!Array.isArray(resolved)) return null;
  return resolved
    .map((item) => {
      if (typeof item === 'string') return { label: item, value: item };
      if (Array.isArray(item))
        return { label: String(item[0]), value: String(item[1] === undefined ? item[0] : item[1]) };
      if (item && typeof item === 'object') {
        const value = item.value === undefined ? item.text : item.value;
        return { label: String(item.text === undefined ? value : item.text), value: String(value) };
      }
      return { label: String(item), value: String(item) };
    })
    .filter((option) => option.value !== '');
};

/**
 * Resolve the dropdown options for one argument.
 * @param {object} args Arguments.
 * @param {string} args.opcode Block opcode.
 * @param {string} args.argName Argument name.
 * @param {object} [args.menuInfo] Extension menu metadata.
 * @param {object} [args.vm] Scratch VM.
 * @param {object} [args.target] Current target.
 * @returns {{options: Array<object>, dynamic?: boolean, note?: string}} Resolution.
 */
export const resolveMenuOptions = ({ opcode, argName, menuInfo, vm, target }) => {
  if (menuInfo) {
    const options = normalizeExtensionItems(menuInfo.items);
    if (options) return { options };
    return {
      options: [],
      dynamic: true,
      note: 'This extension menu is populated dynamically at runtime; its exact options depend on the project/extension state.'
    };
  }

  const key = `${opcode}__${argName}`;
  if (OPCODE_OPTIONS[key]) return { options: toOptions(OPCODE_OPTIONS[key]) };
  if (STATIC_OPTIONS[argName]) return { options: toOptions(STATIC_OPTIONS[argName]) };

  const source = DYNAMIC_SOURCES[argName];
  if (source) {
    const options = resolveDynamic(source, vm, target);
    if (source === 'sprites') {
      return { options: collectSprites(vm, opcode, argName) };
    }
    return { options, dynamic: true };
  }

  return { options: [] };
};
