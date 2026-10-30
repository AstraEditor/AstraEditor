/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import {
  splitLines,
  diffLines,
  groupHunks,
  splitScrathonScripts,
  computeScopeDiff,
  computeToolDiff,
  buildSideBySideRows
} from '../../../src/addons/addons/astras-copilot/agent/scrathon/diff';

describe('Scrathon Diff Engine', () => {
  describe('splitLines', () => {
    test('handles empty input and null', () => {
      expect(splitLines('')).toEqual([]);
      expect(splitLines(null)).toEqual([]);
      expect(splitLines(undefined)).toEqual([]);
    });

    test('normalizes CRLF and LF and trims trailing newline', () => {
      expect(splitLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c']);
      expect(splitLines('single line')).toEqual(['single line']);
    });
  });

  describe('diffLines', () => {
    test('returns empty array when both inputs are empty', () => {
      expect(diffLines('', '')).toEqual([]);
    });

    test('identical texts produce all "same" operations', () => {
      const code = 'move(10)\nturn_right(15)';
      const diff = diffLines(code, code);
      expect(diff).toEqual([
        { type: 'same', line: 'move(10)', oldLineNo: 1, newLineNo: 1 },
        { type: 'same', line: 'turn_right(15)', oldLineNo: 2, newLineNo: 2 }
      ]);
    });

    test('all additions when old text is empty', () => {
      const diff = diffLines('', 'move(10)\nsay("hello")');
      expect(diff).toEqual([
        { type: 'add', line: 'move(10)', oldLineNo: null, newLineNo: 1 },
        { type: 'add', line: 'say("hello")', oldLineNo: null, newLineNo: 2 }
      ]);
    });

    test('all deletions when new text is empty', () => {
      const diff = diffLines('move(10)\nsay("hello")', '');
      expect(diff).toEqual([
        { type: 'del', line: 'move(10)', oldLineNo: 1, newLineNo: null },
        { type: 'del', line: 'say("hello")', oldLineNo: 2, newLineNo: null }
      ]);
    });

    test('single line replacement outputs del before add', () => {
      const oldText = 'move(10)';
      const newText = 'move(20)';
      const diff = diffLines(oldText, newText);
      expect(diff).toEqual([
        { type: 'del', line: 'move(10)', oldLineNo: 1, newLineNo: null },
        { type: 'add', line: 'move(20)', oldLineNo: null, newLineNo: 1 }
      ]);
    });

    test('insertion and deletion in the middle of a script', () => {
      const oldText = ['line1', 'line2', 'line3', 'line4'].join('\n');
      const newText = ['line1', 'line2_mod', 'line3', 'inserted', 'line4'].join('\n');
      const diff = diffLines(oldText, newText);

      expect(diff).toEqual([
        { type: 'same', line: 'line1', oldLineNo: 1, newLineNo: 1 },
        { type: 'del', line: 'line2', oldLineNo: 2, newLineNo: null },
        { type: 'add', line: 'line2_mod', oldLineNo: null, newLineNo: 2 },
        { type: 'same', line: 'line3', oldLineNo: 3, newLineNo: 3 },
        { type: 'add', line: 'inserted', oldLineNo: null, newLineNo: 4 },
        { type: 'same', line: 'line4', oldLineNo: 4, newLineNo: 5 }
      ]);
    });
  });

  describe('groupHunks', () => {
    test('returns empty array when there are no changes', () => {
      const diff = diffLines('a\nb\nc', 'a\nb\nc');
      expect(groupHunks(diff)).toEqual([]);
    });

    test('extracts single hunk with surrounding context', () => {
      const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'];
      const oldText = lines.join('\n');
      const modified = [...lines];
      modified[5] = 'l6_changed'; // Line 6 modified
      const newText = modified.join('\n');

      const diff = diffLines(oldText, newText);
      const hunks = groupHunks(diff, 2);

      expect(hunks.length).toBe(1);
      const hunk = hunks[0];
      expect(hunk.oldStart).toBe(4); // l4 (index 3) is 2 lines before change at index 5
      expect(hunk.lines.map((l) => l.line)).toEqual(['l4', 'l5', 'l6', 'l6_changed', 'l7', 'l8']);
    });

    test('splits separated changes into distinct hunks', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line_${i + 1}`);
      const oldText = lines.join('\n');
      const modified = [...lines];
      modified[2] = 'line_3_mod';
      modified[25] = 'line_26_mod';
      const newText = modified.join('\n');

      const diff = diffLines(oldText, newText);
      const hunks = groupHunks(diff, 2);

      expect(hunks.length).toBe(2);
      expect(hunks[0].lines.some((l) => l.line === 'line_3_mod')).toBe(true);
      expect(hunks[1].lines.some((l) => l.line === 'line_26_mod')).toBe(true);
    });
  });

  describe('splitScrathonScripts', () => {
    test('splits multiple decorated scripts and extracts IDs', () => {
      const src = [
        'target "Sprite1"',
        '',
        '@when_flag_clicked',
        'def on_flag_clicked():  # id:root1',
        '    move(${n:10})',
        '',
        '@when_key_pressed(${m:space})',
        'def on_key_pressed():',
        '    turn_right(${n:15})'
      ].join('\n');

      const scripts = splitScrathonScripts(src);
      expect(scripts.length).toBe(2);
      expect(scripts[0].name).toBe('when_flag_clicked');
      expect(scripts[0].id).toBe('root1');
      expect(scripts[0].code).toContain('move(${n:10})');
      expect(scripts[1].name).toBe('when_key_pressed');
      expect(scripts[1].code).toContain('turn_right(${n:15})');
    });
  });

  describe('computeScopeDiff', () => {
    test('only diffs the affected script among multiple target scripts', () => {
      const existingScripts = [
        {
          id: 'script_flag',
          opcode: 'event_whenflagclicked',
          label: 'when flag clicked',
          code: '@when_flag_clicked\ndef on_flag_clicked():\n    move(${n:10})'
        },
        {
          id: 'script_space',
          opcode: 'event_whenkeypressed',
          keyArg: 'space',
          label: 'when space key pressed',
          code: '@when_key_pressed(${m:space})\ndef on_key_pressed():\n    say(${s:"hi"})'
        }
      ];

      // Only modifying the flag clicked script
      const incomingCode = ['@when_flag_clicked', 'def on_flag_clicked():', '    move(${n:25})'].join('\n');

      const result = computeScopeDiff(existingScripts, incomingCode);
      expect(result.hasChanges).toBe(true);
      expect(result.scripts.length).toBe(1);

      const diffEntry = result.scripts[0];
      expect(diffEntry.id).toBe('script_flag');
      expect(diffEntry.isNew).toBe(false);
      expect(diffEntry.additions).toBe(1);
      expect(diffEntry.deletions).toBe(1);
      expect(diffEntry.diff).toEqual([
        { type: 'same', line: '@when_flag_clicked', oldLineNo: 1, newLineNo: 1 },
        { type: 'same', line: 'def on_flag_clicked():', oldLineNo: 2, newLineNo: 2 },
        { type: 'del', line: '    move(${n:10})', oldLineNo: 3, newLineNo: null },
        { type: 'add', line: '    move(${n:25})', oldLineNo: null, newLineNo: 3 }
      ]);
    });

    test('marks newly added scripts with isNew: true and all additions', () => {
      const existingScripts = [
        {
          id: 'script_flag',
          opcode: 'event_whenflagclicked',
          code: '@when_flag_clicked\ndef on_flag_clicked():\n    pass'
        }
      ];

      const incomingCode = ['@when_key_pressed(${m:up arrow})', 'def on_key_pressed():', '    change_y(${n:10})'].join(
        '\n'
      );

      const result = computeScopeDiff(existingScripts, incomingCode);
      expect(result.hasChanges).toBe(true);
      expect(result.scripts.length).toBe(1);
      expect(result.scripts[0].isNew).toBe(true);
      expect(result.scripts[0].deletions).toBe(0);
      expect(result.scripts[0].additions).toBe(3);
    });

    test('returns hasChanges: false when script content is identical', () => {
      const existingScripts = [
        {
          id: 'script_flag',
          opcode: 'event_whenflagclicked',
          code: '@when_flag_clicked\ndef on_flag_clicked():\n    move(${n:10})'
        }
      ];

      const incomingCode = '@when_flag_clicked\ndef on_flag_clicked():\n    move(${n:10})';
      const result = computeScopeDiff(existingScripts, incomingCode);
      expect(result.hasChanges).toBe(false);
      expect(result.scripts.length).toBe(0);
    });
  });

  describe('computeToolDiff', () => {
    const makeMockVm = () => {
      const target = {
        id: 'sprite1_id',
        name: 'Sprite1',
        getName: () => 'Sprite1',
        blocks: {
          _blocks: {
            flag_root: {
              id: 'flag_root',
              opcode: 'event_whenflagclicked',
              topLevel: true,
              shadow: false,
              next: 'move_block'
            },
            move_block: {
              id: 'move_block',
              opcode: 'motion_movesteps',
              topLevel: false,
              shadow: false,
              next: null,
              inputs: {
                STEPS: {
                  name: 'STEPS',
                  block: 'steps_shadow',
                  shadow: 'steps_shadow'
                }
              }
            },
            steps_shadow: {
              id: 'steps_shadow',
              opcode: 'math_number',
              topLevel: false,
              shadow: true,
              fields: {
                NUM: { name: 'NUM', value: '10' }
              }
            }
          }
        }
      };

      return {
        runtime: {
          targets: [target],
          getTargetById: (id) => (id === 'sprite1_id' || id === 'Sprite1' ? target : null),
          getEditingTarget: () => target
        }
      };
    };

    test('computes diff for apply_scripts with code modifying an existing script', () => {
      const vm = makeMockVm();
      const code = ['target "Sprite1"', '', '@when_flag_clicked', 'def on_flag_clicked():', '    move(${n:30})'].join(
        '\n'
      );

      const diff = computeToolDiff(vm, 'apply_scripts', { target: 'Sprite1', code });
      expect(diff).not.toBeNull();
      expect(diff.tool).toBe('apply_scripts');
      expect(diff.target).toBe('Sprite1');
      expect(diff.hasChanges).toBe(true);
      expect(diff.scripts.length).toBe(1);
      expect(diff.scripts[0].id).toBe('flag_root');
      expect(diff.scripts[0].isNew).toBe(false);
      expect(diff.scripts[0].additions).toBe(1);
      expect(diff.scripts[0].deletions).toBe(1);
    });

    test('computes deletion diff for delete_scripts', () => {
      const vm = makeMockVm();
      const diff = computeToolDiff(vm, 'delete_scripts', { target: 'Sprite1', scriptIds: ['flag_root'] });

      expect(diff).not.toBeNull();
      expect(diff.tool).toBe('delete_scripts');
      expect(diff.target).toBe('Sprite1');
      expect(diff.hasChanges).toBe(true);
      expect(diff.totalAdd).toBe(0);
      expect(diff.totalDel).toBeGreaterThan(0);
      expect(diff.scripts[0].isDelete).toBe(true);
    });

    test('returns null when toolName is unknown or VM has no target', () => {
      const vm = makeMockVm();
      expect(computeToolDiff(vm, 'unknown_tool', {})).toBeNull();
      expect(computeToolDiff(null, 'apply_scripts', {})).toBeNull();
    });
  });

  describe('buildSideBySideRows', () => {
    test('handles empty diff', () => {
      expect(buildSideBySideRows([])).toEqual([]);
    });

    test('reproduces user split diff layout with additions and shifted lines', () => {
      const diff = [
        { type: 'same', line: 'xxx.xxx()', oldLineNo: 10, newLineNo: 10 },
        { type: 'add', line: 'xxxx.xxxx(abc)', oldLineNo: null, newLineNo: 11 },
        { type: 'add', line: 'xxx.xxxxxx()', oldLineNo: null, newLineNo: 12 },
        { type: 'same', line: 'xxxx.xx()', oldLineNo: 11, newLineNo: 13 }
      ];

      const rows = buildSideBySideRows(diff);
      expect(rows).toEqual([
        {
          left: { lineNo: 10, text: 'xxx.xxx()', type: 'same' },
          right: { mark: ' ', lineNo: 10, text: 'xxx.xxx()', type: 'same' }
        },
        {
          left: { lineNo: null, text: '', type: 'empty' },
          right: { mark: '+', lineNo: 11, text: 'xxxx.xxxx(abc)', type: 'add' }
        },
        {
          left: { lineNo: null, text: '', type: 'empty' },
          right: { mark: '+', lineNo: 12, text: 'xxx.xxxxxx()', type: 'add' }
        },
        {
          left: { lineNo: 11, text: 'xxxx.xx()', type: 'same' },
          right: { mark: '~', lineNo: 13, text: 'xxxx.xx()', type: 'mod' }
        }
      ]);
    });

    test('handles replacement (del followed by add)', () => {
      const diff = [
        { type: 'del', line: 'old_call()', oldLineNo: 5, newLineNo: null },
        { type: 'add', line: 'new_call()', oldLineNo: null, newLineNo: 5 }
      ];

      const rows = buildSideBySideRows(diff);
      expect(rows).toEqual([
        {
          left: { lineNo: 5, text: 'old_call()', type: 'del' },
          right: { mark: '~', lineNo: 5, text: 'new_call()', type: 'mod' }
        }
      ]);
    });
  });
});
