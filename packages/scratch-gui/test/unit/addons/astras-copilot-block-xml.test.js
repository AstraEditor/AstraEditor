/**
 * @jest-environment node
 */
/* eslint-env jest */
import { buildScriptsXml, describeCoreBlocks, generateId } from '../../../src/addons/addons/astras-copilot/agent/block-xml';

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

const idPattern = /id="[^"]{8,}"/;

test('generateId produces unique 20-char ids', () => {
  const a = generateId();
  const b = generateId();
  expect(a).toHaveLength(20);
  expect(a).not.toBe(b);
});

test('buildScriptsXml builds a hat block with a nested forever and movement', () => {
  const ctx = makeCtx();
  const { xml, scripts } = buildScriptsXml(
    [
      {
        x: 10,
        y: 20,
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            next: null,
            substack: null
          }
        ]
      }
    ],
    ctx
  );
  expect(scripts).toBe(1);
  expect(xml).toContain('<xml');
  expect(xml).toContain('type="event_whenflagclicked"');
  expect(xml).toContain('x="10"');
  expect(xml).toContain('y="20"');
});

test('compiles nested stack control, strings, numbers and menus', () => {
  const ctx = makeCtx();
  const { xml } = buildScriptsXml(
    [
      {
        x: 0,
        y: 0,
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            next: {
              opcode: 'control_forever',
              substack: [
                {
                  opcode: 'motion_movesteps',
                  inputs: { STEPS: 10 }
                },
                {
                  opcode: 'looks_say',
                  inputs: { MESSAGE: 'Hello!' }
                },
                {
                  opcode: 'control_wait',
                  inputs: { DURATION: 1 }
                }
              ]
            }
          }
        ]
      }
    ],
    ctx
  );
  expect(xml).toContain('type="control_forever"');
  expect(xml).toContain('<statement name="SUBSTACK">');
  expect(xml).toContain('type="motion_movesteps"');
  expect(xml).toContain('<shadow type="math_number"');
  expect(xml).toContain('type="looks_say"');
  expect(xml).toContain('type="control_wait"');
  // Nested statements are chained through <next>
  expect(xml).toContain('<next>');
  // String values stay in text shadows
  expect(xml).toContain('<shadow type="text"');
});

test('resolves variables and returns declarations for the applier', () => {
  const ctx = makeCtx();
  const { xml, declarations } = buildScriptsXml(
    [
      {
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            next: {
              opcode: 'data_setvariableto',
              fields: { VARIABLE: 'score' },
              inputs: { VALUE: 0 }
            }
          }
        ]
      }
    ],
    ctx
  );
  expect(declarations).toHaveLength(1);
  expect(declarations[0]).toMatchObject({ name: 'score', id: 'id-score' });
  // The declaration must NOT be embedded in the XML (created via a variable event instead).
  expect(xml).not.toContain('<variables>');
  expect(xml).toContain('type="data_setvariableto"');
  expect(xml).toContain('variabletype=""');
});

test('nested reporter blocks in a value input', () => {
  const ctx = makeCtx();
  const { xml } = buildScriptsXml(
    [
      {
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            next: {
              opcode: 'data_setvariableto',
              fields: { VARIABLE: 'total' },
              inputs: { VALUE: { opcode: 'operator_add', inputs: { NUM1: 1, NUM2: 2 } } }
            }
          }
        ]
      }
    ],
    ctx
  );
  expect(xml).toContain('type="operator_add"');
  expect(xml).toContain('<value name="VALUE">');
});

test('menu shadow uses resource default', () => {
  const ctx = makeCtx();
  const { xml } = buildScriptsXml(
    [
      {
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            next: {
              opcode: 'looks_switchcostumeto',
              inputs: {}
            }
          }
        ]
      }
    ],
    ctx
  );
  expect(xml).toContain('type="looks_costume"');
  expect(xml).toContain('costume1');
});

test('throws on empty scripts', () => {
  expect(() => buildScriptsXml([], makeCtx())).toThrow(/No scripts/);
  expect(() => buildScriptsXml([{ blocks: [] }], makeCtx())).toThrow(/non-empty/);
});

test('describeCoreBlocks filters by opcode', () => {
  const motion = describeCoreBlocks('motion_move');
  expect(motion.some((entry) => entry.opcode === 'motion_movesteps')).toBe(true);
  expect(motion.every((entry) => entry.opcode.includes('motion_move'))).toBe(true);
});

test('id attributes stay well formed', () => {
  const { xml } = buildScriptsXml([{ blocks: [{ opcode: 'event_whenflagclicked' }] }], makeCtx());
  expect(xml).toMatch(idPattern);
  expect(xml.trim().endsWith('</xml>')).toBe(true);
});
