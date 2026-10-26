/**
 * AstraEditor Terminal - Blockly Workspace Heatmap
 * 积木执行热力图渲染与频次追踪管理器
 */

function valueToHeatmapColor(value, min = 0, max = 1) {
  const clampedValue = Math.max(min, Math.min(max, value));
  const normalizedValue = max <= min ? 1 : (clampedValue - min) / (max - min);
  const r = Math.round(255 * normalizedValue);
  const b = Math.round(255 * (1 - normalizedValue));
  return `#${((1 << 24) | (r << 16) | b).toString(16).slice(1).toUpperCase()}`;
}

function recursiveFillBlock(block, fill = null) {
  if (!block || !block.svgPath_) return;
  const fillColor = fill === null ? block.colour_ : fill;
  block.svgPath_.style.fill = fillColor;

  if (block.svgGroup_) {
    const textElements = block.svgGroup_.querySelectorAll(
      ":scope > :not(.blocklyDraggable):not([data-shapes='stack']) > text, :scope > text"
    );
    if (fill !== null) {
      textElements.forEach((textEl) => {
        textEl.style.setProperty('fill', 'white', 'important');
      });
    } else {
      textElements.forEach((textEl) => {
        textEl.style.removeProperty('fill');
      });
    }
  }

  if (block.childBlocks_) {
    block.childBlocks_.forEach((child) => {
      if (child.previousConnection === null) {
        recursiveFillBlock(child, fill);
      }
    });
  }

  if (block.inputList) {
    block.inputList.forEach((input) => {
      if (input.fieldRow) {
        input.fieldRow.forEach((field) => {
          if (field.box_) field.box_.style.fill = fill || '';
        });
      }
    });
  }
}

export class HeatmapManager {
  constructor(getWorkspace, vm) {
    this.getWorkspace = getWorkspace;
    this.vm = vm;
    this.isActive = false;
    this.blockExecutionCounts = new Map(); // blockId -> count
    this.coloredBlocks = new Set();
    this.updateInterval = null;
    this.customMax = null; // null for auto-scale
  }

  trackBlock(blockId) {
    if (!blockId) return;
    const current = this.blockExecutionCounts.get(blockId) || 0;
    this.blockExecutionCounts.set(blockId, current + 1);
  }

  start() {
    this.isActive = true;
    this.updateWorkspace();
    if (!this.updateInterval) {
      this.updateInterval = setInterval(() => {
        if (this.isActive) {
          this.updateWorkspace();
        }
      }, 200);
    }
  }

  stop() {
    this.isActive = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.clearWorkspaceColors();
  }

  reset() {
    this.blockExecutionCounts.clear();
    if (this.isActive) {
      this.clearWorkspaceColors();
      this.updateWorkspace();
    }
  }

  setMax(val) {
    const num = Number(val);
    this.customMax = !isNaN(num) && num > 0 ? num : null;
    if (this.isActive) {
      this.updateWorkspace();
    }
  }

  clearWorkspaceColors() {
    const workspace = this.getWorkspace ? this.getWorkspace() : null;
    if (!workspace || !workspace.blockDB_) return;

    this.coloredBlocks.forEach((blockId) => {
      const block = workspace.blockDB_[blockId];
      if (block) {
        recursiveFillBlock(block, null);
      }
    });
    this.coloredBlocks.clear();
  }

  updateWorkspace() {
    const workspace = this.getWorkspace ? this.getWorkspace() : null;
    if (!workspace || !workspace.blockDB_ || typeof workspace.getAllBlocks !== 'function') return;

    const counts = this.blockExecutionCounts;
    let maxCount = this.customMax;
    if (!maxCount) {
      let currentMax = 1;
      for (const count of counts.values()) {
        if (count > currentMax) currentMax = count;
      }
      maxCount = currentMax;
    }

    const allBlocks = workspace.getAllBlocks();
    const coldColor = valueToHeatmapColor(0, 0, maxCount);

    for (const block of allBlocks) {
      if (block.isShadow && block.isShadow()) continue;
      if (block.outputConnection && block.getParent && block.getParent()) continue;

      const count = counts.get(block.id);
      if (typeof count === 'number' && count > 0) {
        const color = valueToHeatmapColor(count, 0, maxCount);
        recursiveFillBlock(block, color);
        this.coloredBlocks.add(block.id);
      } else {
        recursiveFillBlock(block, coldColor);
        this.coloredBlocks.add(block.id);
      }
    }
  }

  getStatus() {
    let max = 0;
    for (const val of this.blockExecutionCounts.values()) {
      if (val > max) max = val;
    }
    return {
      active: this.isActive,
      trackedBlocks: this.blockExecutionCounts.size,
      maxExecutions: max,
      customMax: this.customMax
    };
  }
}

export default HeatmapManager;
