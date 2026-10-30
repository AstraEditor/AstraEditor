/**
 * @jest-environment node
 */
/* eslint-env jest */
/* eslint-disable no-template-curly-in-string */
import { JSDOM } from 'jsdom';
import { createScrathonWindow } from '../../../src/addons/addons/astras-copilot/agent/scrathon/window.js';

describe('Scrathon Converter Window', () => {
  let mockVm;
  let msg;
  let dom;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;

    mockVm = {
      runtime: {
        targets: [
          {
            id: 'target-1',
            getName: () => 'Sprite1',
            name: 'Sprite1',
            isStage: false,
            blocks: {
              _blocks: {
                b1: {
                  id: 'b1',
                  opcode: 'motion_movesteps',
                  topLevel: true,
                  next: null,
                  inputs: { STEPS: { block: 's1' } }
                },
                s1: {
                  id: 's1',
                  opcode: 'math_number',
                  shadow: true,
                  fields: { NUM: { value: '15' } }
                }
              }
            }
          }
        ],
        getEditingTarget: () => mockVm.runtime.targets[0]
      }
    };
    msg = (key) => `[${key}]`;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.navigator;
  });

  test('builds single-pane layout with compact code textarea', () => {
    const controller = createScrathonWindow({ vm: mockVm, msg });
    controller.open();

    const windowEl = document.querySelector('.sa-agent-scrathon-window');
    expect(windowEl).not.toBeNull();
    expect(windowEl.style.display).toBe('flex');

    const textarea = windowEl.querySelector('.sa-agent-scrathon-code');
    expect(textarea).not.toBeNull();
    expect(textarea.value).toContain('@when_flag_clicked');

    controller.close();
    expect(windowEl.style.display).toBe('none');
  });

  test('clears and resets sample in editor', () => {
    const controller = createScrathonWindow({ vm: mockVm, msg });
    controller.open();

    const windowEl = document.querySelector('.sa-agent-scrathon-window');
    const textarea = windowEl.querySelector('textarea');
    const clearBtn = Array.from(windowEl.querySelectorAll('.sa-agent-scrathon-panel-btn')).find((b) =>
      b.textContent.includes('scrathon-clear')
    );
    expect(clearBtn).toBeDefined();

    clearBtn.click();
    expect(textarea.value).toBe('');

    const sampleBtn = Array.from(windowEl.querySelectorAll('.sa-agent-scrathon-panel-btn')).find((b) =>
      b.textContent.includes('scrathon-sample')
    );
    expect(sampleBtn).toBeDefined();

    sampleBtn.click();
    expect(textarea.value).toContain('@when_flag_clicked');
  });

  test('decompiles target blocks into code area with Blocks -> Code button', () => {
    const controller = createScrathonWindow({ vm: mockVm, msg });
    controller.open();

    const windowEl = document.querySelector('.sa-agent-scrathon-window');
    const textarea = windowEl.querySelector('textarea');
    const exportBtn = Array.from(windowEl.querySelectorAll('button')).find((b) =>
      b.textContent.includes('scrathon-export')
    );
    expect(exportBtn).toBeDefined();

    exportBtn.click();
    expect(textarea.value).toContain('move(${n:15})');
  });

  test('runs round-trip test and reports success into status strip', async () => {
    const controller = createScrathonWindow({ vm: mockVm, msg });
    controller.open();

    const windowEl = document.querySelector('.sa-agent-scrathon-window');
    const roundTripBtn = Array.from(windowEl.querySelectorAll('button')).find((b) =>
      b.textContent.includes('scrathon-roundtrip')
    );
    expect(roundTripBtn).toBeDefined();

    await roundTripBtn.click();

    const statusEl = windowEl.querySelector('.sa-agent-scrathon-status');
    expect(statusEl.textContent).toContain('scrathon-roundtrip-ok');
    expect(statusEl.classList.contains('sa-agent-scrathon-status-success')).toBe(true);
  });
});
