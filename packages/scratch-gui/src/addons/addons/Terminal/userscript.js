import BottomPanel from '../../ui/bottom-panel/bottom-panel.js';
import SideBar from '../../ui/side-bar/side-bar.js';
import icon from '!../../../lib/tw-recolor/build!./logo.svg';
import iconSidebar from '!../../../lib/tw-recolor/build!./icon-sidebar.svg';
import iconBottom from '!../../../lib/tw-recolor/build!./icon-bottom.svg';
import iconWindow from '!../../../lib/tw-recolor/build!./icon-window.svg';
import iconContinue from '!../../../lib/tw-recolor/build!./icon-continue.svg';
import iconStep from '!../../../lib/tw-recolor/build!./icon-step.svg';
import iconExport from '!../../../lib/tw-recolor/build!./icon-export.svg';
import iconSetting from '!../../../lib/tw-recolor/build!./icon-setting.svg';
import {
  setup as setupDebugger,
  setPaused as setPausedDebugger,
  singleStep as singleStepDebugger,
  isPaused as isPausedDebugger,
  onPauseChanged as onPauseChangedDebugger,
  getRunningThread as getRunningThreadDebugger
} from './module.js';
import HeatmapManager from './heatmap.js';
import aeVersion from '../../../lib/ae-version.js';

const clamp = (i, min, max) => Math.max(min, Math.min(max, i));

/*
  todo:
  1.允许获取上一行输出 [已完成]
  2.允许输出内容不合并 [已完成]
  3.允许不换行输出 [已完成] [有问题]
  4.BBCode支持 [完成不完善]
*/

class TerminalVirtualList {
  constructor() {
    this.rows = [];
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.visible = false;
    this.isScrolledToEnd = true;
    this.scrollTop = 0;
    this.height = 0;
    this.rowHeight = 16;

    this.updateContentQueued = false;
    this.scrollToEndQueued = false;
    this.pendingLogs = [];
    this.batchScheduled = false;

    this.outerElement = document.createElement('div');
    this.outerElement.className = 'sa-terminal-output';

    this.innerElement = document.createElement('div');
    this.innerElement.className = 'sa-terminal-output-inner';
    this.outerElement.appendChild(this.innerElement);

    this.outerElement.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });
  }

  _handleScroll(e) {
    this.scrollTop = e.target.scrollTop;
    this.isScrolledToEnd = e.target.scrollTop + 5 >= e.target.scrollHeight - e.target.clientHeight;
    this.height = e.target.clientHeight;
    this._updateContent();
  }

  _queueUpdateContent() {
    if (this.visible && !this.updateContentQueued) {
      this.updateContentQueued = true;
      queueMicrotask(() => {
        this.updateContentQueued = false;
        this._updateContent();
      });
    }
  }

  _scrollToEnd() {
    const scrollEnd = this.outerElement.scrollHeight - this.outerElement.offsetHeight;
    this.outerElement.scrollTop = scrollEnd;
    this.scrollTop = scrollEnd;
  }

  _queueScrollToEnd() {
    if (this.visible && !this.scrollToEndQueued) {
      this.scrollToEndQueued = true;
      queueMicrotask(() => {
        this.scrollToEndQueued = false;
        this._scrollToEnd();
      });
    }
  }

  show() {
    this.visible = true;
    this.height = this.outerElement.clientHeight || 400;
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this._updateContent();
    this._scrollToEnd();
  }

  hide() {
    this.visible = false;
  }

  clear() {
    this.rows.length = 0;
    this.innerElement.innerHTML = '';
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.scrollTop = 0;
    this.isScrolledToEnd = true;
  }

  removeLastRow() {
    if (this.rows.length === 0) return false;
    this.rows.pop();
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this._updateContent();
    return true;
  }

  _updateContent() {
    if (this.rows.length === 0) {
      if (this.innerElement.children.length > 0) {
        this.innerElement.innerHTML = '';
      }
      this.renderedStartIndex = -1;
      this.renderedEndIndex = -1;
      return;
    }

    let viewHeight = this.outerElement.clientHeight;
    if (viewHeight === 0) {
      viewHeight = this.height || 400;
    }
    this.height = viewHeight;

    const totalHeight = this.rows.length * this.rowHeight;
    this.innerElement.style.height = `${totalHeight}px`;

    const scrollStartIndex = Math.floor(this.scrollTop / this.rowHeight);
    const rowsVisible = Math.ceil(viewHeight / this.rowHeight);
    const EXTRA_ROWS_ABOVE = 5;
    const EXTRA_ROWS_BELOW = 5;
    const startIndex = clamp(scrollStartIndex - EXTRA_ROWS_ABOVE, 0, this.rows.length);
    const endIndex = clamp(scrollStartIndex + rowsVisible + EXTRA_ROWS_BELOW, 0, this.rows.length);

    if (this.renderedStartIndex === startIndex && this.renderedEndIndex === endIndex) {
      return;
    }

    const existingElements = new Map();
    for (const child of this.innerElement.children) {
      const idx = parseInt(child.dataset.index, 10);
      if (!isNaN(idx)) {
        existingElements.set(idx, child);
      }
    }

    const neededIndices = new Set();
    for (let i = startIndex; i < endIndex; i++) {
      neededIndices.add(i);
    }

    for (const [idx, element] of existingElements) {
      if (!neededIndices.has(idx)) {
        element.remove();
      }
    }

    for (let i = startIndex; i < endIndex; i++) {
      const row = this.rows[i];
      let element = existingElements.get(i);

      if (!element && row.element) {
        element = row.element;
        element.style.position = 'absolute';
        element.style.left = '10px';
        element.style.right = '10px';
        element.style.boxSizing = 'border-box';
        element.style.height = `${this.rowHeight}px`;
        element.style.overflow = 'hidden';
        this.innerElement.appendChild(element);
      }

      if (element) {
        element.style.top = `${i * this.rowHeight}px`;
        element.dataset.index = i;
      }
    }

    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = endIndex;
  }

  appendLog(log) {
    this.pendingLogs.push(log);
    this._scheduleBatchUpdate();
  }

  _scheduleBatchUpdate() {
    if (!this.batchScheduled) {
      this.batchScheduled = true;
      queueMicrotask(() => {
        this.batchScheduled = false;
        this._flushPendingLogs();
      });
    }
  }

  _flushPendingLogs() {
    if (this.pendingLogs.length === 0) return;

    const logsToAdd = this.pendingLogs;
    this.pendingLogs = [];

    for (const log of logsToAdd) {
      this.rows.push(log);
    }

    if (this.visible) {
      this._queueUpdateContent();
      if (this.isScrolledToEnd) {
        this._queueScrollToEnd();
      }
    } else {
      this.renderedStartIndex = -1;
      this.renderedEndIndex = -1;
      this.isScrolledToEnd = true;
    }
  }
}

/**
 * Terminal 插件入口。
 * @param {object} options 插件运行环境
 * @param {object} options.addon 插件 API
 * @param {Console} options.console 控制台对象
 * @param {Function} options.msg 国际化函数
 */
export default async function ({ addon, console, msg }) {
  const vm = addon.tab.traps.vm;

  // 初始化debugger模块
  setupDebugger(addon);

  // Terminal 位置类型
  const POSITION_TYPES = {
    SIDEBAR: 'sidebar',
    BOTTOM_PANEL: 'bottom',
    WINDOW: 'window'
  };

  // localStorage 键名
  const POSITION_STORAGE_KEY = 'AETerminalPosition';

  // 从 localStorage 读取保存的位置
  /**
   * 读取保存的 Terminal 位置。
   * @returns {string} Terminal 位置
   */
  function loadSavedPosition() {
    try {
      const saved = localStorage.getItem(POSITION_STORAGE_KEY);
      if (saved && Object.values(POSITION_TYPES).includes(saved)) {
        if (saved === POSITION_TYPES.SIDEBAR) {
          const settings = localStorage.getItem('AESettings');
          if (settings) {
            const parsed = JSON.parse(settings);
            if (parsed.EnableVSCodeLayout !== true) {
              return POSITION_TYPES.BOTTOM_PANEL;
            }
          } else {
            return POSITION_TYPES.BOTTOM_PANEL;
          }
        }
        return saved;
      }
    } catch (e) {
      // ignore
    }
    return POSITION_TYPES.BOTTOM_PANEL;
  }

  // 保存位置到 localStorage
  /**
   * 保存 Terminal 位置。
   * @param {string} newPosition 新位置
   */
  function savePosition(newPosition) {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, newPosition);
    } catch (e) {
      // ignore
    }
  }

  // 当前 Terminal 位置（从 localStorage 读取或默认底部面板）
  let currentPosition = loadSavedPosition();

  // 检测是否启用 VSCode 布局
  /**
   * 判断 VSCode 布局是否启用。
   * @returns {boolean} 是否启用
   */
  function isVSCodeLayoutEnabled() {
    try {
      const settings = localStorage.getItem('AESettings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.EnableVSCodeLayout === true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  // 独立窗口相关变量
  let floatingWindow = null;
  let isDraggingWindow = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let windowCloseButton = null;

  // 窗口大小调整相关变量
  let isResizing = false;
  let resizeDirection = '';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeStartLeft = 0;
  let resizeStartTop = 0;

  // 调整大小的方向
  const RESIZE_DIRECTIONS = {
    TOP: 'top',
    BOTTOM: 'bottom',
    LEFT: 'left',
    RIGHT: 'right',
    TOP_LEFT: 'top-left',
    TOP_RIGHT: 'top-right',
    BOTTOM_LEFT: 'bottom-left',
    BOTTOM_RIGHT: 'bottom-right'
  };

  // 调整大小的阈值
  const RESIZE_THRESHOLD = 8;

  // 创建独立窗口
  /**
   * 创建独立窗口。
   * @returns {HTMLElement} 独立窗口元素
   */
  function createFloatingWindow() {
    if (floatingWindow) return floatingWindow;

    floatingWindow = document.createElement('div');
    floatingWindow.className = 'sa-terminal-floating-window';
    floatingWindow.style.cssText = `
      position: absolute;
      top: 100px;
      left: 100px;
      width: 600px;
      height: 400px;
      min-width: 400px;
      min-height: 300px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      display: none; /* 初始隐藏，只在需要时显示 */
      flex-direction: column;
      overflow: hidden;
    `;

    // 创建关闭按钮
    windowCloseButton = document.createElement('button');
    windowCloseButton.className = 'sa-terminal-window-close-button';
    windowCloseButton.textContent = '×';
    windowCloseButton.style.cssText = `
      background: none;
      border: none;
      color: inherit;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      margin-left: 8px;
    `;
    windowCloseButton.style.display = 'none'; // 默认隐藏，只在独立窗口模式显示
    windowCloseButton.addEventListener('click', () => {
      toggleTerminal(false);
    });

    document.body.appendChild(floatingWindow);
    return floatingWindow;
  }

  /**
   * 处理窗口拖动。
   * @param {MouseEvent} e 鼠标事件
   */
  function handleWindowDrag(e) {
    if (!isDraggingWindow) return;
    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;
    const windowWidth = floatingWindow.offsetWidth;
    const windowHeight = floatingWindow.offsetHeight;
    const maxX = window.innerWidth - windowWidth;
    const maxY = window.innerHeight - windowHeight;
    floatingWindow.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    floatingWindow.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
  }

  /**
   * 结束窗口拖动。
   */
  function stopWindowDrag() {
    isDraggingWindow = false;
    document.removeEventListener('mousemove', handleWindowDrag);
    document.removeEventListener('mouseup', stopWindowDrag);
  }

  // 处理窗口调整大小
  /**
   * 处理窗口大小调整。
   * @param {MouseEvent} e 鼠标事件
   */
  function handleWindowResize(e) {
    if (!isResizing) return;

    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;

    let newWidth = resizeStartWidth;
    let newHeight = resizeStartHeight;
    let newLeft = resizeStartLeft;
    let newTop = resizeStartTop;

    // 根据调整方向计算新的大小和位置
    switch (resizeDirection) {
      case RESIZE_DIRECTIONS.LEFT:
        newWidth = Math.max(400, resizeStartWidth - deltaX);
        newLeft = resizeStartLeft + deltaX;
        break;
      case RESIZE_DIRECTIONS.RIGHT:
        newWidth = Math.max(400, resizeStartWidth + deltaX);
        break;
      case RESIZE_DIRECTIONS.TOP:
        newHeight = Math.max(300, resizeStartHeight - deltaY);
        newTop = resizeStartTop + deltaY;
        break;
      case RESIZE_DIRECTIONS.BOTTOM:
        newHeight = Math.max(300, resizeStartHeight + deltaY);
        break;
      case RESIZE_DIRECTIONS.TOP_LEFT:
        newWidth = Math.max(400, resizeStartWidth - deltaX);
        newHeight = Math.max(300, resizeStartHeight - deltaY);
        newLeft = resizeStartLeft + deltaX;
        newTop = resizeStartTop + deltaY;
        break;
      case RESIZE_DIRECTIONS.TOP_RIGHT:
        newWidth = Math.max(400, resizeStartWidth + deltaX);
        newHeight = Math.max(300, resizeStartHeight - deltaY);
        newTop = resizeStartTop + deltaY;
        break;
      case RESIZE_DIRECTIONS.BOTTOM_LEFT:
        newWidth = Math.max(400, resizeStartWidth - deltaX);
        newHeight = Math.max(300, resizeStartHeight + deltaY);
        newLeft = resizeStartLeft + deltaX;
        break;
      case RESIZE_DIRECTIONS.BOTTOM_RIGHT:
        newWidth = Math.max(400, resizeStartWidth + deltaX);
        newHeight = Math.max(300, resizeStartHeight + deltaY);
        break;
    }

    // 应用新的大小和位置
    if (floatingWindow) {
      // 限制窗口位置，确保不会超出页面
      const maxLeft = window.innerWidth - newWidth;
      const maxTop = window.innerHeight - newHeight;
      newLeft = Math.min(Math.max(0, newLeft), Math.max(0, maxLeft));
      newTop = Math.min(Math.max(0, newTop), Math.max(0, maxTop));
      // 再次确保大小不超过页面
      newWidth = Math.min(newWidth, window.innerWidth);
      newHeight = Math.min(newHeight, window.innerHeight);
      floatingWindow.style.width = `${newWidth}px`;
      floatingWindow.style.height = `${newHeight}px`;
      floatingWindow.style.left = `${newLeft}px`;
      floatingWindow.style.top = `${newTop}px`;
    }
  }

  // 停止调整大小
  /**
   * 结束窗口大小调整。
   */
  function stopWindowResize() {
    isResizing = false;
    resizeDirection = '';
    document.removeEventListener('mousemove', handleWindowResize);
    document.removeEventListener('mouseup', stopWindowResize);
    if (floatingWindow) {
      floatingWindow.style.cursor = '';
    }
  }

  // 检测调整大小的方向
  /**
   * 获取鼠标所在的调整方向。
   * @param {MouseEvent} e 鼠标事件
   * @returns {string} 调整方向
   */
  function getResizeDirection(e) {
    if (!floatingWindow) return '';

    const rect = floatingWindow.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 检测边角
    if (x <= RESIZE_THRESHOLD && y <= RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.TOP_LEFT;
    }
    if (x >= rect.width - RESIZE_THRESHOLD && y <= RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.TOP_RIGHT;
    }
    if (x <= RESIZE_THRESHOLD && y >= rect.height - RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.BOTTOM_LEFT;
    }
    if (x >= rect.width - RESIZE_THRESHOLD && y >= rect.height - RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.BOTTOM_RIGHT;
    }

    // 检测边
    if (x <= RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.LEFT;
    }
    if (x >= rect.width - RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.RIGHT;
    }
    if (y <= RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.TOP;
    }
    if (y >= rect.height - RESIZE_THRESHOLD) {
      return RESIZE_DIRECTIONS.BOTTOM;
    }

    return '';
  }

  // 更新鼠标样式
  /**
   * 更新窗口鼠标样式。
   * @param {MouseEvent} e 鼠标事件
   */
  function updateCursorStyle(e) {
    if (!floatingWindow) return;

    const direction = getResizeDirection(e);
    let cursor = '';

    switch (direction) {
      case RESIZE_DIRECTIONS.TOP_LEFT:
      case RESIZE_DIRECTIONS.BOTTOM_RIGHT:
        cursor = 'nwse-resize';
        break;
      case RESIZE_DIRECTIONS.TOP_RIGHT:
      case RESIZE_DIRECTIONS.BOTTOM_LEFT:
        cursor = 'nesw-resize';
        break;
      case RESIZE_DIRECTIONS.LEFT:
      case RESIZE_DIRECTIONS.RIGHT:
        cursor = 'ew-resize';
        break;
      case RESIZE_DIRECTIONS.TOP:
      case RESIZE_DIRECTIONS.BOTTOM:
        cursor = 'ns-resize';
        break;
      default: {
        // 检查是否在标题栏区域
        const rect = floatingWindow.getBoundingClientRect();
        const y = e.clientY - rect.top;
        cursor = y <= 30 ? 'move' : '';
        break;
      }
    }

    floatingWindow.style.cursor = cursor;
  }

  // 切换 Terminal 位置
  /**
   * 切换 Terminal 位置。
   * @param {string} newPosition 新位置
   */
  function switchTerminalPosition(newPosition) {
    if (newPosition === currentPosition) return;

    // 先关闭当前位置
    closeTerminalAtPosition(currentPosition);

    // 切换到新位置
    currentPosition = newPosition;
    savePosition(newPosition);
    openTerminalAtPosition(newPosition);

    // 更新切换按钮状态
    updatePositionSwitchButton();

    // 更新启用按钮位置
    updateToggleButtonPosition();

    // 发送 resize 事件
    window.dispatchEvent(new Event('resize'));
  }

  // 在指定位置打开 Terminal
  /**
   * 在指定位置打开 Terminal。
   * @param {string} position Terminal 位置
   */
  function openTerminalAtPosition(position) {
    switch (position) {
      case POSITION_TYPES.SIDEBAR:
        SideBar.switchTo('terminal');
        break;
      case POSITION_TYPES.BOTTOM_PANEL:
        BottomPanel.switchTo('terminal');
        break;
      case POSITION_TYPES.WINDOW: {
        const window = createFloatingWindow();
        window.style.display = 'flex';

        // 添加 terminalContainer 到窗口
        window.appendChild(terminalContainer);
        terminalContainer.style.flex = '1';
        terminalContainer.style.overflow = 'auto';

        // 启用虚拟列表
        virtualList.show();

        // 在独立窗口模式下，terminalHeader 作为拖拽标题栏
        terminalHeader.style.cursor = 'move';
        terminalHeader.style.userSelect = 'none';

        // 显示关闭按钮
        if (windowCloseButton) {
          windowCloseButton.style.display = 'block';
        }

        // 启用拖拽功能
        terminalHeader.addEventListener('mousedown', handleWindowDragStart);

        // 在整个窗口上添加 mousedown 事件监听器，用于调整大小
        floatingWindow.addEventListener('mousedown', handleWindowResizeStart);

        // 添加鼠标移动事件监听器，用于更新鼠标样式
        floatingWindow.addEventListener('mousemove', updateCursorStyle);
        break;
      }
    }
  }

  // 关闭指定位置的 Terminal
  /**
   * 关闭指定位置的 Terminal。
   * @param {string} position Terminal 位置
   */
  function closeTerminalAtPosition(position) {
    switch (position) {
      case POSITION_TYPES.SIDEBAR:
        SideBar.close();
        break;
      case POSITION_TYPES.BOTTOM_PANEL:
        BottomPanel.close();
        break;
      case POSITION_TYPES.WINDOW:
        if (floatingWindow) {
          if (terminalContainer.parentNode === floatingWindow) {
            virtualList.hide();
            floatingWindow.removeChild(terminalContainer);
          }
          floatingWindow.style.display = 'none';

          // 恢复 terminalHeader 样式
          terminalHeader.style.cursor = '';
          terminalHeader.style.userSelect = '';

          // 隐藏关闭按钮
          if (windowCloseButton) {
            windowCloseButton.style.display = 'none';
          }

          // 禁用拖拽功能
          terminalHeader.removeEventListener('mousedown', handleWindowDragStart);
          floatingWindow.removeEventListener('mousedown', handleWindowResizeStart);

          // 移除鼠标移动事件监听器
          floatingWindow.removeEventListener('mousemove', updateCursorStyle);
        }
        break;
    }
  }

  // 处理窗口拖拽开始
  /**
   * 开始拖动窗口。
   * @param {MouseEvent} e 鼠标事件
   */
  function handleWindowDragStart(e) {
    // 不在拖拽按钮上开始拖拽
    if (e.target.tagName === 'BUTTON') return;

    // 直接进行窗口拖拽
    isDraggingWindow = true;
    dragOffsetX = e.clientX - floatingWindow.offsetLeft;
    dragOffsetY = e.clientY - floatingWindow.offsetTop;
    document.addEventListener('mousemove', handleWindowDrag);
    document.addEventListener('mouseup', stopWindowDrag);
  }

  // 处理窗口调整大小开始（在整个窗口）
  /**
   * 开始调整窗口大小。
   * @param {MouseEvent} e 鼠标事件
   */
  function handleWindowResizeStart(e) {
    // 不在按钮上开始调整大小
    if (e.target.tagName === 'BUTTON') return;

    // 检查是否在窗口边缘（调整大小）
    const direction = getResizeDirection(e);
    if (direction) {
      isResizing = true;
      resizeDirection = direction;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartWidth = floatingWindow.offsetWidth;
      resizeStartHeight = floatingWindow.offsetHeight;
      resizeStartLeft = floatingWindow.offsetLeft;
      resizeStartTop = floatingWindow.offsetTop;

      document.addEventListener('mousemove', handleWindowResize);
      document.addEventListener('mouseup', stopWindowResize);
    }
  }

  // 切换 Terminal 显示/隐藏
  /**
   * 切换 Terminal 显示状态。
   * @param {boolean} [show] 是否显示
   */
  function toggleTerminal(show) {
    if (show === undefined) {
      show = !isTerminalVisible();
    }

    if (show) {
      openTerminalAtPosition(currentPosition);
    } else {
      closeTerminalAtPosition(currentPosition);
    }
  }

  // 检查 Terminal 是否可见
  /**
   * 判断 Terminal 是否可见。
   * @returns {boolean} 是否可见
   */
  function isTerminalVisible() {
    switch (currentPosition) {
      case POSITION_TYPES.SIDEBAR:
        return SideBar.isOpen() && SideBar.getActivePlugin() === 'terminal';
      case POSITION_TYPES.BOTTOM_PANEL:
        return BottomPanel.isOpen() && BottomPanel.getActivePlugin() === 'terminal';
      case POSITION_TYPES.WINDOW:
        return floatingWindow && floatingWindow.style.display !== 'none';
      default:
        return false;
    }
  }

  // 等待项目加载完成
  await new Promise((resolve) => {
    if (vm.editingTarget) return resolve();
    vm.runtime.once('PROJECT_LOADED', resolve);
  });

  // 创建终端容器
  const switchToSprite = (targetId) => {
    if (targetId !== vm.editingTarget.id) {
      const target = vm.runtime.getTargetById(targetId);
      if (target) {
        vm.setEditingTarget(targetId);
      }
    }
  };

  // 激活代码选项卡
  const activateCodeTab = () => {
    const redux = addon.tab.redux;
    if (redux.state.scratchGui.editorTab.activeTabIndex !== 0) {
      redux.dispatch({
        type: 'scratch-gui/navigation/ACTIVATE_TAB',
        activeTabIndex: 0
      });
    }
  };

  // 定位到指定块
  const goToBlock = async (blockId) => {
    const ScratchBlocks = await addon.tab.traps.getBlockly();
    const workspace = ScratchBlocks.getMainWorkspace();
    const block = workspace.getBlockById(blockId);
    if (!block || block.workspace.isFlyout) return;

    workspace.centerOnBlock(blockId);
    block.select();
  };

  // 创建跳转到块的链接
  const createBlockLink = (targetInfo, blockId) => {
    const link = document.createElement('a');
    link.className = 'sa-terminal-block-link';

    const { exists, name, originalId } = targetInfo;
    link.textContent = name;
    link.title = msg('block-link-title') || '点击跳转到积木';

    if (exists && originalId) {
      link.addEventListener('mousedown', () => {
        switchToSprite(originalId);
        activateCodeTab();
        goToBlock(blockId);
      });
    } else {
      link.classList.add('sa-terminal-block-link-unknown');
    }

    return link;
  };

  // 获取目标信息
  const getTargetInfoById = (id) => {
    const target = vm.runtime.getTargetById(id);
    if (target) {
      let name = target.getName();
      let original = target;
      if (!target.isOriginal) {
        name = `克隆体 (${name})`;
        original = target.sprite.clones[0];
      }
      return {
        exists: true,
        originalId: original ? original.id : null,
        name
      };
    }
    return {
      exists: false,
      originalId: null,
      name: '（未知角色）'
    };
  };

  // 创建终端容器
  const terminalContainer = document.createElement('div');
  addon.tab.displayNoneWhileDisabled(terminalContainer, { display: 'flex' });
  terminalContainer.className = 'sa-terminal-container';

  // 创建终端头部
  const terminalHeader = document.createElement('div');
  terminalHeader.className = 'sa-terminal-header';

  const terminalTitle = document.createElement('span');
  terminalTitle.className = 'sa-terminal-title';
  terminalTitle.textContent = 'AstraEditor Terminal';

  // 创建继续按钮（默认隐藏）
  const continueButton = document.createElement('button');
  continueButton.className = 'sa-terminal-continue-button';
  continueButton.title = msg('button-continue') || '继续运行';

  continueButton.style.display = 'none';

  // 为继续按钮添加SVG图标
  const continueBtnIcon = document.createElement('img');
  // 使用正确的图标导入方式
  continueBtnIcon.src = iconContinue();
  continueBtnIcon.style.width = '16px';
  continueBtnIcon.style.height = '16px';
  continueBtnIcon.style.filter = 'grayscale(100%)';
  continueButton.appendChild(continueBtnIcon);

  continueButton.addEventListener('click', () => {
    setPausedDebugger(false);
  });

  // 创建单步执行按钮（默认隐藏）
  const stepButton = document.createElement('button');
  stepButton.className = 'sa-terminal-step-button';
  stepButton.title = msg('button-step') || '单步执行 (Step)';
  stepButton.style.display = 'none';

  const stepBtnIcon = document.createElement('img');
  stepBtnIcon.src = iconStep();
  stepBtnIcon.style.width = '16px';
  stepBtnIcon.style.height = '16px';
  stepBtnIcon.style.filter = 'grayscale(100%)';
  stepButton.appendChild(stepBtnIcon);

  stepButton.addEventListener('click', () => {
    singleStepDebugger();
  });

  onPauseChangedDebugger((paused) => {
    continueButton.style.display = paused ? 'flex' : 'none';
    stepButton.style.display = paused ? 'flex' : 'none';
  });

  // 创建导出日志按钮
  const exportButton = document.createElement('button');
  exportButton.className = 'sa-terminal-export-button';
  exportButton.title = msg('button-export') || '导出日志';

  // 为导出按钮添加SVG图标
  const exportBtnIcon = document.createElement('img');
  // 使用正确的图标导入方式
  exportBtnIcon.src = iconExport();
  exportBtnIcon.style.width = '16px';
  exportBtnIcon.style.height = '16px';
  exportBtnIcon.style.filter = 'grayscale(100%)';
  exportButton.appendChild(exportBtnIcon);

  // 导出日志功能
  const exportLogs = () => {
    const logs = [];
    for (const row of virtualList.rows) {
      if (row.element) {
        logs.push(row.element.textContent);
      }
    }
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-log-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  exportButton.addEventListener('click', exportLogs);

  // 创建设置按钮
  const settingsButton = document.createElement('button');
  settingsButton.className = 'sa-terminal-settings-button';
  settingsButton.title = msg('button-settings') || '设置';

  const settingsBtnIcon = document.createElement('img');
  settingsBtnIcon.src = iconSetting();
  settingsBtnIcon.style.cssText = `
    width: 16px;
    height: 16px;
    filter: grayscale(100%);
  `;
  settingsButton.appendChild(settingsBtnIcon);

  // 创建设置界面
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'sa-terminal-settings-panel';
  settingsPanel.style.cssText = `
    display: none;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    padding: 12px;
  `;

  // 设置界面标题栏
  const settingsHeader = document.createElement('div');
  settingsHeader.className = 'sa-terminal-settings-header';
  settingsHeader.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #3c3c3c;
  `;

  const backButton = document.createElement('button');
  backButton.className = 'sa-terminal-back-button';
  backButton.style.cssText = `
    background: none;
    border: 1px solid var(--ui-black-transparent);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--ui-text-primary);
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
  `;
  backButton.textContent = msg('button-back') || '← 返回';

  const settingsTitle = document.createElement('span');
  settingsTitle.style.cssText = `
    font-weight: bold;
    color: #ffffff;
    font-size: 14px;
  `;
  settingsTitle.textContent = msg('settings-title') || '控制台设置';

  settingsHeader.appendChild(backButton);
  settingsHeader.appendChild(settingsTitle);
  settingsPanel.appendChild(settingsHeader);

  // 设置内容区域
  const settingsContent = document.createElement('div');
  settingsContent.className = 'sa-terminal-settings-content';
  settingsContent.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  // 控制台报错开关设置
  const consoleErrorSwitchContainer = document.createElement('div');
  consoleErrorSwitchContainer.className = 'sa-terminal-setting-item';
  consoleErrorSwitchContainer.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #2d2d2d;
    border-radius: 6px;
  `;

  const consoleErrorLabel = document.createElement('span');
  consoleErrorLabel.style.cssText = `
    color: #d4d4d4;
    font-size: 13px;
  `;
  consoleErrorLabel.textContent = msg('setting-console-error') || '在终端中显示控制台报错';

  const consoleErrorSwitch = document.createElement('label');
  consoleErrorSwitch.className = 'sa-terminal-switch';
  consoleErrorSwitch.style.cssText = `
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
  `;

  const consoleErrorSwitchInput = document.createElement('input');
  consoleErrorSwitchInput.type = 'checkbox';
  consoleErrorSwitchInput.className = 'sa-terminal-switch-input';
  consoleErrorSwitchInput.style.cssText = `
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  `;

  const consoleErrorSwitchBackground = document.createElement('span');
  consoleErrorSwitchBackground.className = 'sa-terminal-switch-background';
  consoleErrorSwitchBackground.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #555555;
    transition: 0.3s;
    border-radius: 22px;
  `;

  const consoleErrorSwitchSlider = document.createElement('span');
  consoleErrorSwitchSlider.className = 'sa-terminal-switch-slider';
  consoleErrorSwitchSlider.style.cssText = `
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
    z-index: 1;
  `;

  consoleErrorSwitchInput.addEventListener('change', (e) => {
    if (e.target.checked) {
      consoleErrorSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      consoleErrorSwitchSlider.style.transform = 'translateX(18px)';
      enableConsoleErrorInterceptor();
      saveSettings({ consoleErrorEnabled: true });
    } else {
      consoleErrorSwitchBackground.style.backgroundColor = '#555555';
      consoleErrorSwitchSlider.style.transform = 'translateX(0)';
      disableConsoleErrorInterceptor();
      saveSettings({ consoleErrorEnabled: false });
    }
  });

  consoleErrorSwitch.appendChild(consoleErrorSwitchInput);
  consoleErrorSwitch.appendChild(consoleErrorSwitchBackground);
  consoleErrorSwitch.appendChild(consoleErrorSwitchSlider);
  consoleErrorSwitchContainer.appendChild(consoleErrorLabel);
  consoleErrorSwitchContainer.appendChild(consoleErrorSwitch);
  settingsContent.appendChild(consoleErrorSwitchContainer);

  // 折叠相同内容开关设置
  const mergeOutputSwitchContainer = document.createElement('div');
  mergeOutputSwitchContainer.className = 'sa-terminal-setting-item';
  mergeOutputSwitchContainer.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #2d2d2d;
    border-radius: 6px;
  `;

  const mergeOutputLabel = document.createElement('span');
  mergeOutputLabel.style.cssText = `
    color: #d4d4d4;
    font-size: 13px;
  `;
  mergeOutputLabel.textContent = msg('setting-merge-output') || '折叠相同内容输出';

  const mergeOutputSwitch = document.createElement('label');
  mergeOutputSwitch.className = 'sa-terminal-switch';
  mergeOutputSwitch.style.cssText = `
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
  `;

  const mergeOutputSwitchInput = document.createElement('input');
  mergeOutputSwitchInput.type = 'checkbox';
  mergeOutputSwitchInput.className = 'sa-terminal-switch-input';
  mergeOutputSwitchInput.style.cssText = `
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  `;

  const mergeOutputSwitchBackground = document.createElement('span');
  mergeOutputSwitchBackground.className = 'sa-terminal-switch-background';
  mergeOutputSwitchBackground.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #555555;
    transition: 0.3s;
    border-radius: 22px;
  `;

  const mergeOutputSwitchSlider = document.createElement('span');
  mergeOutputSwitchSlider.className = 'sa-terminal-switch-slider';
  mergeOutputSwitchSlider.style.cssText = `
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
    z-index: 1;
  `;

  mergeOutputSwitchInput.addEventListener('change', (e) => {
    if (e.target.checked) {
      mergeOutputSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      mergeOutputSwitchSlider.style.transform = 'translateX(18px)';
      enableMergeOutput();
      saveSettings({ mergeOutputEnabled: true });
    } else {
      mergeOutputSwitchBackground.style.backgroundColor = '#555555';
      mergeOutputSwitchSlider.style.transform = 'translateX(0)';
      disableMergeOutput();
      saveSettings({ mergeOutputEnabled: false });
    }
  });

  mergeOutputSwitch.appendChild(mergeOutputSwitchInput);
  mergeOutputSwitch.appendChild(mergeOutputSwitchBackground);
  mergeOutputSwitch.appendChild(mergeOutputSwitchSlider);
  mergeOutputSwitchContainer.appendChild(mergeOutputLabel);
  mergeOutputSwitchContainer.appendChild(mergeOutputSwitch);
  settingsContent.appendChild(mergeOutputSwitchContainer);

  // 显示跳转按钮开关设置
  let showBlockLinksEnabled = true;

  const showBlockLinksSwitchContainer = document.createElement('div');
  showBlockLinksSwitchContainer.className = 'sa-terminal-setting-item';
  showBlockLinksSwitchContainer.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #2d2d2d;
    border-radius: 6px;
  `;

  const showBlockLinksLabel = document.createElement('span');
  showBlockLinksLabel.style.cssText = `
    color: #d4d4d4;
    font-size: 13px;
  `;
  showBlockLinksLabel.textContent = msg('setting-show-block-links') || '显示输出积木跳转按钮';

  const showBlockLinksSwitch = document.createElement('label');
  showBlockLinksSwitch.className = 'sa-terminal-switch';
  showBlockLinksSwitch.style.cssText = `
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
  `;

  const showBlockLinksSwitchInput = document.createElement('input');
  showBlockLinksSwitchInput.type = 'checkbox';
  showBlockLinksSwitchInput.className = 'sa-terminal-switch-input';
  showBlockLinksSwitchInput.checked = true;
  showBlockLinksSwitchInput.style.cssText = `
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  `;

  const showBlockLinksSwitchBackground = document.createElement('span');
  showBlockLinksSwitchBackground.className = 'sa-terminal-switch-background';
  showBlockLinksSwitchBackground.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--looks-secondary);
    transition: 0.3s;
    border-radius: 22px;
  `;

  const showBlockLinksSwitchSlider = document.createElement('span');
  showBlockLinksSwitchSlider.className = 'sa-terminal-switch-slider';
  showBlockLinksSwitchSlider.style.cssText = `
    position: absolute;
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
    z-index: 1;
    transform: translateX(18px);
  `;

  showBlockLinksSwitchInput.addEventListener('change', (e) => {
    if (e.target.checked) {
      showBlockLinksSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      showBlockLinksSwitchSlider.style.transform = 'translateX(18px)';
      showBlockLinksEnabled = true;
      saveSettings({ showBlockLinksEnabled: true });
    } else {
      showBlockLinksSwitchBackground.style.backgroundColor = '#555555';
      showBlockLinksSwitchSlider.style.transform = 'translateX(0)';
      showBlockLinksEnabled = false;
      saveSettings({ showBlockLinksEnabled: false });
    }
  });

  showBlockLinksSwitch.appendChild(showBlockLinksSwitchInput);
  showBlockLinksSwitch.appendChild(showBlockLinksSwitchBackground);
  showBlockLinksSwitch.appendChild(showBlockLinksSwitchSlider);
  showBlockLinksSwitchContainer.appendChild(showBlockLinksLabel);
  showBlockLinksSwitchContainer.appendChild(showBlockLinksSwitch);
  settingsContent.appendChild(showBlockLinksSwitchContainer);

  settingsPanel.appendChild(settingsContent);

  // 切换显示设置界面（完全替代整个 Terminal 面板）
  const showSettingsPanel = () => {
    terminalHeader.style.display = 'none';
    terminalOutput.style.display = 'none';
    settingsPanel.style.display = 'flex';
  };

  const hideSettingsPanel = () => {
    terminalHeader.style.display = '';
    terminalOutput.style.display = '';
    settingsPanel.style.display = 'none';
  };

  settingsButton.addEventListener('click', showSettingsPanel);
  backButton.addEventListener('click', hideSettingsPanel);

  // 创建位置切换按钮容器
  const positionSwitchContainer = document.createElement('div');
  positionSwitchContainer.className = 'sa-terminal-position-switch';
  positionSwitchContainer.style.cssText = `
    display: flex;
    gap: 4px;
    align-items: center;
    position: relative;
  `;

  // 位置标题映射
  const positionTitles = {
    [POSITION_TYPES.SIDEBAR]: msg('position-sidebar') || '侧边栏',
    [POSITION_TYPES.BOTTOM_PANEL]: msg('position-bottom') || '底部面板',
    [POSITION_TYPES.WINDOW]: msg('position-window') || '独立窗口'
  };

  // 更新位置图标映射（重新生成SVG数据）
  /**
   * 获取各位置对应的图标。
   * @returns {object} 位置图标映射
   */
  function updatePositionIcons() {
    return {
      [POSITION_TYPES.SIDEBAR]: iconSidebar(),
      [POSITION_TYPES.BOTTOM_PANEL]: iconBottom(),
      [POSITION_TYPES.WINDOW]: iconWindow()
    };
  }

  // 位置图标映射
  let positionIcons = updatePositionIcons();

  // 创建轮换按钮
  const rotateButton = document.createElement('button');
  rotateButton.className = 'sa-terminal-rotate-button';
  const switchPositionTitle = msg('button-switch-position') || 'Current position: %s (click to switch)';
  rotateButton.title = switchPositionTitle.replace('%s', positionTitles[currentPosition]);
  rotateButton.style.cssText = `
    background: none;
    border: 1px solid var(--ui-black-transparent);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--ui-text-primary);
    min-width: 32px;
  `;

  // 添加SVG图标
  const rotateBtnIcon = document.createElement('img');
  rotateBtnIcon.src = positionIcons[currentPosition];
  rotateBtnIcon.style.width = '16px';
  rotateBtnIcon.style.height = '16px';
  rotateBtnIcon.style.filter = 'grayscale(100%)';
  rotateButton.appendChild(rotateBtnIcon);

  // 点击轮换按钮切换到下一个位置
  rotateButton.addEventListener('click', () => {
    const positions = [POSITION_TYPES.SIDEBAR, POSITION_TYPES.BOTTOM_PANEL, POSITION_TYPES.WINDOW];
    const currentIndex = positions.indexOf(currentPosition);
    const nextIndex = (currentIndex + 1) % positions.length;
    const nextPosition = positions[nextIndex];

    // 检查是否可以使用 VSCode 布局
    if (nextPosition === POSITION_TYPES.SIDEBAR && !isVSCodeLayoutEnabled()) {
      // 如果侧边栏不可用，跳过它
      const nextNextIndex = (nextIndex + 1) % positions.length;
      switchTerminalPosition(positions[nextNextIndex]);
    } else {
      switchTerminalPosition(nextPosition);
    }
  });

  positionSwitchContainer.appendChild(rotateButton);

  // 创建浮窗容器
  const popupContainer = document.createElement('div');
  popupContainer.className = 'sa-terminal-position-popup';
  popupContainer.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    border: 1px solid var(--ui-black-transparent);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px;
    display: none;
    flex-direction: column;
    gap: 2px;
    z-index: 1000;
    min-width: 120px;
  `;

  // 创建浮窗中的位置按钮
  const createPopupButton = (type, iconFunction, title) => {
    const button = document.createElement('button');
    button.className = 'sa-terminal-popup-button';
    button.dataset.position = type;
    button.style.cssText = `
      background: none;
      border: none;
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      color: var(--ui-text-primary);
      text-align: left;
      display: flex;
      align-items: center;
      font-family: inherit;
      gap: 8px;
    `;

    // 添加SVG图标
    const img = document.createElement('img');
    img.src = iconFunction();
    img.style.width = '16px';
    img.style.height = '16px';
    img.style.filter = 'grayscale(100%)';
    button.appendChild(img);

    // 添加文本
    const text = document.createElement('span');
    text.textContent = title;
    button.appendChild(text);

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = 'var(--ui-primary-transparent)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = 'none';
    });

    button.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发轮换按钮的点击
      const targetPosition = button.dataset.position;
      if (targetPosition !== currentPosition) {
        switchTerminalPosition(targetPosition);
      }
      // 隐藏浮窗
      popupContainer.style.display = 'none';
    });

    return button;
  };

  const sidebarPopupButton = createPopupButton(
    POSITION_TYPES.SIDEBAR,
    iconSidebar,
    msg('position-sidebar') || '侧边栏'
  );

  const bottomPopupButton = createPopupButton(
    POSITION_TYPES.BOTTOM_PANEL,
    iconBottom,
    msg('position-bottom') || '底部面板'
  );

  const windowPopupButton = createPopupButton(POSITION_TYPES.WINDOW, iconWindow, msg('position-window') || '独立窗口');

  popupContainer.appendChild(sidebarPopupButton);
  popupContainer.appendChild(bottomPopupButton);
  popupContainer.appendChild(windowPopupButton);
  positionSwitchContainer.appendChild(popupContainer);

  // 鼠标悬浮显示浮窗
  let popupTimeout = null;

  rotateButton.addEventListener('mouseenter', () => {
    clearTimeout(popupTimeout);
    popupContainer.style.display = 'flex';
  });

  positionSwitchContainer.addEventListener('mouseleave', () => {
    popupTimeout = setTimeout(() => {
      popupContainer.style.display = 'none';
    }, 200);
  });

  popupContainer.addEventListener('mouseenter', () => {
    clearTimeout(popupTimeout);
  });

  popupContainer.addEventListener('mouseleave', () => {
    popupTimeout = setTimeout(() => {
      popupContainer.style.display = 'none';
    }, 200);
  });

  // 更新位置切换按钮状态
  /**
   * 更新位置切换按钮的显示状态。
   */
  function updatePositionSwitchButton() {
    // 重新生成图标数据
    positionIcons = updatePositionIcons();

    // 更新轮换按钮的图标
    rotateBtnIcon.src = positionIcons[currentPosition];
    rotateButton.title = `当前位置: ${positionTitles[currentPosition]} (点击轮换)`;

    // 更新浮窗按钮的状态
    const popupButtons = popupContainer.querySelectorAll('.sa-terminal-popup-button');
    popupButtons.forEach((button) => {
      if (button.dataset.position === currentPosition) {
        // button.style.backgroundColor = "var(--ui-primary)";
        button.style.color = 'white';
        // 更新图标颜色
        const img = button.querySelector('img');
        if (img) {
          img.style.filter = 'none';
        }
      } else {
        button.style.backgroundColor = '';
        button.style.color = '';
        // 更新图标颜色
        const img = button.querySelector('img');
        if (img) {
          img.style.filter = 'grayscale(100%)';
        }
      }
    });

    // 更新侧边栏按钮的可用状态
    const useVSCodeLayout = isVSCodeLayoutEnabled();
    if (!useVSCodeLayout) {
      sidebarPopupButton.style.opacity = '0.3';
      sidebarPopupButton.style.cursor = 'not-allowed';
      sidebarPopupButton.disabled = true;
    } else {
      sidebarPopupButton.style.opacity = '1';
      sidebarPopupButton.style.cursor = 'pointer';
      sidebarPopupButton.disabled = false;
    }
  }

  // 创建按钮容器（用于并排放置所有操作按钮）
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'sa-terminal-header-buttons';
  buttonContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  // 初始化独立窗口（确保 windowCloseButton 被创建）
  createFloatingWindow();

  // 将按钮添加到容器中
  buttonContainer.appendChild(continueButton);
  buttonContainer.appendChild(stepButton);
  buttonContainer.appendChild(exportButton);
  buttonContainer.appendChild(settingsButton);
  buttonContainer.appendChild(positionSwitchContainer);

  // 将关闭按钮添加到按钮容器（默认隐藏，只在独立窗口模式显示）
  // 注意：windowCloseButton 已在 createFloatingWindow 中创建
  if (windowCloseButton) {
    buttonContainer.appendChild(windowCloseButton);
  }

  terminalHeader.appendChild(terminalTitle);
  terminalHeader.appendChild(buttonContainer);
  terminalContainer.appendChild(terminalHeader);

  // 创建终端输出区域（虚拟滚动列表）
  const virtualList = new TerminalVirtualList();
  const terminalOutput = virtualList.outerElement;

  // 初始化欢迎信息
  const welcomeLine1 = document.createElement('div');
  welcomeLine1.textContent = msg('welcome-title') || 'AstraEditor Terminal v1.3.0';
  virtualList.appendLog({ element: welcomeLine1, contentHash: welcomeLine1.textContent });

  const welcomeLine2 = document.createElement('div');
  welcomeLine2.textContent = msg('welcome-help') || "输入 'help' 查看可用命令。";
  virtualList.appendLog({ element: welcomeLine2, contentHash: welcomeLine2.textContent });

  const welcomeLine3 = document.createElement('div');
  welcomeLine3.textContent = '';
  virtualList.appendLog({ element: welcomeLine3, contentHash: '' });

  terminalContainer.appendChild(terminalOutput);
  terminalContainer.appendChild(settingsPanel);

  // 设置存储键名
  const SETTINGS_STORAGE_KEY = 'AETerminalSettings';

  // 加载设置
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // ignore
    }
    return { consoleErrorEnabled: true, mergeOutputEnabled: true, showBlockLinksEnabled: true };
  };

  // 保存设置
  const saveSettings = (newSettings) => {
    try {
      const current = loadSettings();
      const updated = { ...current, ...newSettings };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      // ignore
    }
  };

  // 控制台错误拦截器状态
  let isConsoleErrorInterceptorEnabled = true;

  // 启用控制台错误拦截器
  const enableConsoleErrorInterceptor = () => {
    isConsoleErrorInterceptorEnabled = true;
  };

  // 禁用控制台错误拦截器
  const disableConsoleErrorInterceptor = () => {
    isConsoleErrorInterceptorEnabled = false;
  };

  // 折叠相同内容状态
  let isMergeOutputEnabled = true;

  // 启用折叠相同内容
  const enableMergeOutput = () => {
    isMergeOutputEnabled = true;
    // 重新检查并合并已有的日志内容
    mergeExistingLogs();
  };

  // 禁用折叠相同内容
  const disableMergeOutput = () => {
    isMergeOutputEnabled = false;
    // 展开所有已合并的内容
    expandAllMergedLogs();
  };

  // 获取行的实际内容（不包含计数器和链接）
  const getRowContent = (row) => {
    if (row.element) {
      // 优先获取日志文本部分
      const textElement = row.element.querySelector('.sa-terminal-log-text');
      if (textElement) {
        return textElement.textContent.replace(/\s+/g, ' ').trim();
      }
      // 如果没有 .sa-terminal-log-text，返回空字符串让行不被处理
      return '';
    }
    // 如果没有 element 但有 contentHash（欢迎信息等），返回 contentHash
    if (row.contentHash) {
      return row.contentHash;
    }
    return '';
  };

  // 获取行的合并计数
  const getRowCount = (row) => {
    if (row.count) {
      return row.count;
    }
    if (row.element) {
      const counter = row.element.querySelector('.sa-terminal-log-counter');
      if (counter) {
        const count = parseInt(counter.textContent);
        return isNaN(count) ? 1 : count;
      }
    }
    return 1;
  };

  // 合并已有的日志内容（只合并连续的相同内容）
  const mergeExistingLogs = () => {
    if (virtualList.rows.length === 0) return;

    // 从后往前遍历，只合并连续的相同内容
    let i = virtualList.rows.length - 1;
    while (i > 0) {
      const currentRow = virtualList.rows[i];
      const prevRow = virtualList.rows[i - 1];

      const currentContent = getRowContent(currentRow);
      const prevContent = getRowContent(prevRow);

      // 如果当前行和上一行内容相同，则合并
      if (currentContent && currentContent === prevContent) {
        // 获取当前行的计数
        const currentCount = getRowCount(currentRow);
        // 更新上一行的计数
        const prevCount = getRowCount(prevRow);
        const newCount = prevCount + currentCount;

        if (prevRow.element) {
          let counter = prevRow.element.querySelector('.sa-terminal-log-counter');
          if (!counter) {
            counter = document.createElement('span');
            counter.className = 'sa-terminal-log-counter';
            prevRow.element.insertBefore(counter, prevRow.element.firstChild);
          }
          counter.textContent = newCount;
        }
        prevRow.count = newCount;

        // 移除当前行
        if (currentRow.element && currentRow.element.parentNode) {
          currentRow.element.remove();
        }
        virtualList.rows.splice(i, 1);
      }

      i--;
    }

    // 更新虚拟列表
    virtualList.renderedStartIndex = -1;
    virtualList.renderedEndIndex = -1;
    if (virtualList.visible) {
      virtualList._updateContent();
    }

    // 更新 lastLogData
    if (virtualList.rows.length > 0) {
      const lastRow = virtualList.rows[virtualList.rows.length - 1];
      lastLogData = {
        contentHash: lastRow.contentHash,
        element: lastRow.element,
        count: lastRow.count || 1
      };
      lastLogCount = lastLogData.count;
    }
  };

  // 展开所有已合并的内容
  const expandAllMergedLogs = () => {
    if (virtualList.rows.length === 0) return;

    const newRows = [];

    for (const row of virtualList.rows) {
      // 使用 getRowContent 获取纯文本内容（不包含链接）
      const content = getRowContent(row);
      // 使用 getRowCount 获取正确的计数
      const count = getRowCount(row);

      // 克隆原元素并移除计数器
      let counterRemovedElement = null;
      if (row.element) {
        counterRemovedElement = row.element.cloneNode(true);
        const counter = counterRemovedElement.querySelector('.sa-terminal-log-counter');
        if (counter) {
          counter.remove();
        }
      }

      // 根据重复次数添加多行
      for (let i = 0; i < count; i++) {
        if (i === 0) {
          // 保留原行（包含链接等结构），但先移除计数器
          if (row.element) {
            const counter = row.element.querySelector('.sa-terminal-log-counter');
            if (counter) {
              counter.remove();
            }
          }
          newRows.push({
            element: row.element,
            contentHash: content,
            count: 1
          });
        } else {
          // 使用 cloneNode 复制完整结构
          const newElement = counterRemovedElement
            ? counterRemovedElement.cloneNode(true)
            : document.createElement('div');
          if (!counterRemovedElement) {
            newElement.className = 'sa-terminal-log-line';
          }
          newRows.push({
            element: newElement,
            contentHash: content,
            count: 1
          });
        }
      }
    }

    // 替换所有行
    virtualList.rows = newRows;

    // 更新虚拟列表
    virtualList.renderedStartIndex = -1;
    virtualList.renderedEndIndex = -1;
    if (virtualList.visible) {
      virtualList._updateContent();
      virtualList._scrollToEnd();
    }

    // 重置 lastLogData
    if (virtualList.rows.length > 0) {
      const lastRow = virtualList.rows[virtualList.rows.length - 1];
      lastLogData = {
        contentHash: lastRow.contentHash,
        element: lastRow.element,
        count: 1
      };
      lastLogCount = 1;
    }
  };

  // 初始化设置开关状态
  const initSettingsSwitch = () => {
    const settings = loadSettings();
    if (!settings.consoleErrorEnabled) {
      consoleErrorSwitchInput.checked = false;
      consoleErrorSwitchBackground.style.backgroundColor = '#555555';
      consoleErrorSwitchSlider.style.transform = 'translateX(0)';
      disableConsoleErrorInterceptor();
    } else {
      consoleErrorSwitchInput.checked = true;
      consoleErrorSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      consoleErrorSwitchSlider.style.transform = 'translateX(18px)';
      enableConsoleErrorInterceptor();
    }

    if (!settings.mergeOutputEnabled) {
      mergeOutputSwitchInput.checked = false;
      mergeOutputSwitchBackground.style.backgroundColor = '#555555';
      mergeOutputSwitchSlider.style.transform = 'translateX(0)';
      disableMergeOutput();
    } else {
      mergeOutputSwitchInput.checked = true;
      mergeOutputSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      mergeOutputSwitchSlider.style.transform = 'translateX(18px)';
      enableMergeOutput();
    }

    if (!settings.showBlockLinksEnabled) {
      showBlockLinksSwitchInput.checked = false;
      showBlockLinksSwitchBackground.style.backgroundColor = '#555555';
      showBlockLinksSwitchSlider.style.transform = 'translateX(0)';
      showBlockLinksEnabled = false;
    } else {
      showBlockLinksSwitchInput.checked = true;
      showBlockLinksSwitchBackground.style.backgroundColor = 'var(--looks-secondary)';
      showBlockLinksSwitchSlider.style.transform = 'translateX(18px)';
      showBlockLinksEnabled = true;
    }
  };
  initSettingsSwitch();

  // 控制台错误拦截器 - 将 console.error 同步到 Terminal
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    originalConsoleError(...args);

    if (terminalOutput && isConsoleErrorInterceptorEnabled) {
      resetLogTracking();

      const line = document.createElement('div');
      line.className = 'sa-terminal-log-line';

      const mark = document.createElement('span');
      mark.className = 'sa-terminal-log-mark console-error';
      mark.textContent = '[console.error]';
      line.appendChild(mark);

      const textSpan = document.createElement('span');
      textSpan.className = 'sa-terminal-log-text';

      const message = args
        .map((arg) => {
          if (arg instanceof Error) {
            return arg.message;
          }
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      textSpan.textContent = ` ${message}`;
      line.appendChild(textSpan);

      if (args[0] instanceof Error && args[0].stack) {
        const stackInfo = document.createElement('span');
        stackInfo.className = 'sa-terminal-log-stack';
        const stackLines = args[0].stack.split('\n');
        const relevantLines = stackLines.filter((l) => !l.includes('extension-hoste'));
        const locationInfo = relevantLines
          .slice(1, 3)
          .map((l) => l.trim())
          .join(' | ');
        stackInfo.textContent = locationInfo ? ` (${locationInfo})` : '';
        line.appendChild(stackInfo);
      }

      addLogLineWithElement(line);
    }
  };

  // 重复内容处理
  let lastLogData = null;
  let lastLogCount = 1;

  // 重置重复内容记录（用于非积木输出的内容）
  const resetLogTracking = () => {
    lastLogData = null;
    lastLogCount = 1;
  };

  // 获取元素的内容标识符（用于比较重复内容）
  const getElementContentHash = (element) => {
    // 优先获取日志文本部分（不包含链接）
    const textElement = element.querySelector('.sa-terminal-log-text');
    if (textElement) {
      return textElement.textContent.replace(/\s+/g, ' ').trim();
    }
    return element.textContent.replace(/\s+/g, ' ').trim();
  };

  // 添加日志行（支持重复内容合并）
  const addLogLineWithElement = (element) => {
    const contentHash = getElementContentHash(element);

    if (isMergeOutputEnabled && lastLogData && contentHash === lastLogData.contentHash) {
      lastLogCount++;
      lastLogData.count = lastLogCount;
      if (lastLogData.element && lastLogData.element.parentNode) {
        let counter = lastLogData.element.querySelector('.sa-terminal-log-counter');
        if (!counter) {
          counter = document.createElement('span');
          counter.className = 'sa-terminal-log-counter';
          lastLogData.element.insertBefore(counter, lastLogData.element.firstChild);
        }
        counter.textContent = lastLogCount;
      }
      element.remove();
    } else {
      virtualList.appendLog({ element, contentHash });
      lastLogData = { contentHash, element, count: 1 };
      lastLogCount = 1;
    }
  };

  // 添加断点积木
  addon.tab.addBlock('\u200B\u200Bbreakpoint\u200B\u200B', {
    args: [],
    displayName: msg('block-breakpoint'),
    callback: (_, thread) => {
      if (addon.tab.redux.state.scratchGui.mode.isPlayerOnly) {
        if (terminalOutput) {
          const line = document.createElement('div');
          line.className = 'sa-terminal-log-line';

          const mark = document.createElement('span');
          mark.className = 'sa-terminal-log-mark error';
          mark.textContent = '[error]';
          line.appendChild(mark);

          const textSpan = document.createElement('span');
          textSpan.className = 'sa-terminal-log-text';
          textSpan.textContent = ` ${msg('breakpoint-editor-only') || '断点积木只能在编辑器中使用。'}`;
          line.appendChild(textSpan);

          addLogLineWithElement(line);
        }
        return;
      }

      setPausedDebugger(true);
      continueButton.style.display = 'flex';
      stepButton.style.display = 'flex';

      if (terminalOutput) {
        const line = document.createElement('div');
        line.className = 'sa-terminal-log-line';

        const mark = document.createElement('span');
        mark.className = 'sa-terminal-log-mark log';
        mark.textContent = '[breakpoint]';
        line.appendChild(mark);

        const textSpan = document.createElement('span');
        textSpan.className = 'sa-terminal-log-text';
        textSpan.textContent = ` ${msg('breakpoint-paused') || '程序已暂停'}`;
        line.appendChild(textSpan);

        if (thread) {
          const blockId = thread.peekStack();
          const targetId = thread.target.id;
          const targetInfo = getTargetInfoById(targetId);
          if (showBlockLinksEnabled && blockId && targetInfo.exists) {
            const linkWrapper = document.createElement('span');
            linkWrapper.className = 'sa-terminal-log-link-wrapper';
            linkWrapper.textContent = '[';
            const link = createBlockLink(targetInfo, blockId);
            link.className = 'sa-terminal-block-link';
            linkWrapper.appendChild(link);
            linkWrapper.appendChild(document.createTextNode(']'));
            line.appendChild(linkWrapper);
          }
        }

        addLogLineWithElement(line);
      }
    }
  });

  addon.tab.addBlock('\u200B\u200Bclear\u200B\u200B', {
    args: [],
    displayName: msg('block-clear') || '清空终端',
    callback: () => {
      virtualList.clear();
      resetLogTracking();
    }
  });

  addon.tab.addBlock('\u200B\u200Bdelete_last\u200B\u200B', {
    args: [],
    displayName: msg('block-delete-last') || '删除上一句输出',
    callback: () => {
      if (lastLogData && lastLogData.count > 1) {
        lastLogData.count--;
        lastLogCount = lastLogData.count;
        if (lastLogData.element) {
          const counter = lastLogData.element.querySelector('.sa-terminal-log-counter');
          if (counter) {
            if (lastLogData.count === 1) {
              counter.remove();
            } else {
              counter.textContent = lastLogData.count;
            }
          }
        }
      } else {
        const removed = virtualList.removeLastRow();
        if (removed) {
          lastLogData = null;
          lastLogCount = 1;
        }
      }
    }
  });

  // 转义 HTML，避免 BBCode 内容注入脚本或标签
  const escapeHTML = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[char]
    );

  // 仅允许常见 CSS 颜色格式，避免通过颜色值注入样式
  const sanitizeCssColor = (value) => {
    const color = String(value).trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
      return color;
    }
    if (/^[a-z]+$/i.test(color)) return color;
    if (/^rgba?\([\d\s.,%]+\)$/i.test(color)) return color;
    if (/^hsla?\([\d\s.,%]+\)$/i.test(color)) return color;
    return null;
  };

  const parseColorList = (value) => {
    const colors = String(value).trim().split(/\s+/).map(sanitizeCssColor).filter(Boolean);
    return colors.length > 0 ? colors : null;
  };

  const sanitizeUrl = (value) => {
    try {
      // HTML 转义阶段可能把 URL 中的 & 转成 &amp;，解析前先还原
      const url = new URL(String(value).replace(/&amp;/g, '&').trim(), window.location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.href;
      }
    } catch {
      // 无效 URL 不生成链接
    }
    return null;
  };

  // BBCode 解析函数
  const parseBBCode = (text) => {
    // 先保护反斜杠转义，再转义 HTML，最后解析 BBCode。
    // 这样用户输入中的原始 HTML 不会进入 innerHTML。
    const escapeMap = {};
    let escapeIndex = 0;
    let result = String(text ?? '').replace(/\\(.)/g, (match, char) => {
      const key = `__ESCAPE_${escapeIndex++}__`;
      escapeMap[key] = char;
      return key;
    });

    result = escapeHTML(result);

    // 渐变颜色（多个颜色用空格分隔）- 必须先于单色处理
    result = result.replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gi, (match, colorValue, content) => {
      const colors = parseColorList(colorValue);
      if (!colors) return content;
      if (colors.length >= 2) {
        return `<span style="background: linear-gradient(to right, ${colors.join(', ')}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${content}</span>`;
      }
      return `<span style="color:${colors[0]}">${content}</span>`;
    });
    result = result.replace(/\[c=([^\]]+)\](.*?)\[\/c\]/gi, (match, colorValue, content) => {
      const colors = parseColorList(colorValue);
      if (!colors) return content;
      if (colors.length >= 2) {
        return `<span style="background: linear-gradient(to right, ${colors.join(', ')}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${content}</span>`;
      }
      return `<span style="color:${colors[0]}">${content}</span>`;
    });

    // 渐变背景（多个颜色用空格分隔）- 必须先于单色处理
    result = result.replace(/\[background=([^\]]+)\](.*?)\[\/background\]/gi, (match, colorValue, content) => {
      const colors = parseColorList(colorValue);
      if (!colors) return content;
      if (colors.length >= 2) {
        return `<span style="background: linear-gradient(to right, ${colors.join(', ')});">${content}</span>`;
      }
      return `<span style="background-color:${colors[0]}">${content}</span>`;
    });
    result = result.replace(/\[bg=([^\]]+)\](.*?)\[\/bg\]/gi, (match, colorValue, content) => {
      const colors = parseColorList(colorValue);
      if (!colors) return content;
      if (colors.length >= 2) {
        return `<span style="background: linear-gradient(to right, ${colors.join(', ')});">${content}</span>`;
      }
      return `<span style="background-color:${colors[0]}">${content}</span>`;
    });

    // 将换行符转换为 <br>
    result = result.replace(/\n/g, '<br>');

    // 粗体标签 [bold=...] 或 [b=...]
    result = result.replace(/\[bold(=([\d]+(px)?))?\](.*?)\[\/bold\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[bold(=[^\]]+)?\]/gi, '').replace(/\[\/bold\]/gi, '');
      if (weight) {
        return `<span style="font-weight:${weight}">${content}</span>`;
      }
      return `<strong>${content}</strong>`;
    });
    result = result.replace(/\[b(=([\d]+(px)?))?\](.*?)\[\/b\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[b(=[^\]]+)?\]/gi, '').replace(/\[\/b\]/gi, '');
      if (weight) {
        return `<span style="font-weight:${weight}">${content}</span>`;
      }
      return `<strong>${content}</strong>`;
    });

    // 斜体标签 [italic] 或 [i]
    result = result.replace(/\[italic\](.*?)\[\/italic\]/gi, '<em>$1</em>');
    result = result.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');

    // 下划线标签 [underline=...] 或 [u=...]
    result = result.replace(/\[underline(=([\d]+(px)?))?\](.*?)\[\/underline\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[underline(=[^\]]+)?\]/gi, '').replace(/\[\/underline\]/gi, '');
      if (weight) {
        return `<span style="text-decoration: underline; text-decoration-thickness:${weight}">${content}</span>`;
      }
      return `<u>${content}</u>`;
    });
    result = result.replace(/\[u(=([\d]+(px)?))?\](.*?)\[\/u\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[u(=[^\]]+)?\]/gi, '').replace(/\[\/u\]/gi, '');
      if (weight) {
        return `<span style="text-decoration: underline; text-decoration-thickness:${weight}">${content}</span>`;
      }
      return `<u>${content}</u>`;
    });

    // 删除线标签 [strikethrough=...] 或 [s=...]
    result = result.replace(/\[strikethrough(=([\d]+(px)?))?\](.*?)\[\/strikethrough\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[strikethrough(=[^\]]+)?\]/gi, '').replace(/\[\/strikethrough\]/gi, '');
      if (weight) {
        return `<span style="text-decoration: line-through; text-decoration-thickness:${weight}">${content}</span>`;
      }
      return `<s>${content}</s>`;
    });
    result = result.replace(/\[s(=([\d]+(px)?))?\](.*?)\[\/s\]/gi, (match, p1, weight) => {
      const content = match.replace(/\[s(=[^\]]+)?\]/gi, '').replace(/\[\/s\]/gi, '');
      if (weight) {
        return `<span style="text-decoration: line-through; text-decoration-thickness:${weight}">${content}</span>`;
      }
      return `<s>${content}</s>`;
    });

    // 链接标签 [url=...]
    result = result.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, (match, url, content) => {
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) return content;
      return `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer" class="sa-terminal-url-link">${content}</a>`;
    });

    // 恢复转义字符；恢复时同样做 HTML 转义，避免绕过上面的保护
    Object.keys(escapeMap).forEach((key) => {
      result = result.replace(key, escapeHTML(escapeMap[key]));
    });

    return result;
  };

  const createTextWithLinks = (container, text, color) => {
    container.innerHTML = '';
    container.style.color = color || '';

    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+|data:[^\s<>"{}|\\^`[\]]+)/gi;
    const matches = [...text.matchAll(urlRegex)];

    if (matches.length === 0) {
      container.textContent = text;
      return;
    }

    let lastIndex = 0;
    matches.forEach((match) => {
      if (match.index > lastIndex) {
        const textNode = document.createElement('span');
        textNode.className = 'sa-terminal-text-plain';
        textNode.style.whiteSpace = 'pre';
        textNode.textContent = text.slice(lastIndex, match.index);
        container.appendChild(textNode);
      }

      const link = document.createElement('a');
      link.className = 'sa-terminal-url-link';
      link.textContent = match[0];
      link.title = msg('ctrl-click-to-open') || '按下 Ctrl 并单击以打开链接';
      link.href = '#';
      link.dataset.url = match[0];
      link.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const url = e.target.dataset.url;
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }
      });
      container.appendChild(link);

      lastIndex = match.index + match[0].length;
    });

    if (lastIndex < text.length) {
      const textNode = document.createElement('span');
      textNode.className = 'sa-terminal-text-plain';
      textNode.style.whiteSpace = 'pre';
      textNode.textContent = text.slice(lastIndex);
      container.appendChild(textNode);
    }
  };

  const createLogLines = (text, thread, options = {}) => {
    const { markClass, markText, color } = options;
    const textStr = String(text ?? '');

    // 创建新行（移除追加逻辑，避免竞态条件和开头空格丢失问题）
    const line = document.createElement('div');
    line.className = 'sa-terminal-log-line';

    if (markClass && markText) {
      const mark = document.createElement('span');
      mark.className = `sa-terminal-log-mark ${markClass}`;
      mark.textContent = markText;
      line.appendChild(mark);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'sa-terminal-log-text';
    const displayText = markClass && markText ? ` ${textStr}` : textStr;
    createTextWithLinks(textSpan, displayText, color);
    textSpan.title = textStr;
    line.appendChild(textSpan);

    const blockId = thread ? thread.peekStack() : null;
    const targetId = thread ? thread.target.id : null;
    const targetInfo = blockId && targetId ? getTargetInfoById(targetId) : null;

    if (showBlockLinksEnabled && targetInfo && targetInfo.exists && blockId) {
      const linkWrapper = document.createElement('span');
      linkWrapper.className = 'sa-terminal-log-link-wrapper';
      linkWrapper.textContent = '[';
      const link = createBlockLink(targetInfo, blockId);
      link.className = 'sa-terminal-block-link';
      linkWrapper.appendChild(link);
      linkWrapper.appendChild(document.createTextNode(']'));
      line.appendChild(linkWrapper);
    }

    addLogLineWithElement(line);
  };

  // BBCode 输出队列，解决快速调用时的竞态条件
  const bbcodeOutputQueue = [];
  let isProcessingBBCodeQueue = false;

  // 处理 BBCode 输出队列
  const processBBCodeQueue = () => {
    if (isProcessingBBCodeQueue || bbcodeOutputQueue.length === 0) {
      return;
    }

    isProcessingBBCodeQueue = true;

    const { text, thread, options } = bbcodeOutputQueue.shift();
    const { markClass, markText } = options || {};
    let textStr = String(text ?? '');

    // 先处理双反斜杠后跟 n 的情况，保护起来
    // \\n 应该显示为字面的 \n
    const escapedNewlineMap = {};
    let escapeIndex = 0;
    textStr = textStr.replace(/\\\\n/g, () => {
      const key = `__ESC_NL_${escapeIndex++}__`;
      escapedNewlineMap[key] = '\\n';
      return key;
    });

    // 按转义的 \n 或实际的换行符分割，创建多个行
    const lines = textStr.split(/(?:\\n|\n)/g);

    // 同步处理所有行
    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i];

      // 如果是空行（连续换行），创建空行
      if (lineContent === '' && i > 0) {
        const emptyLine = document.createElement('div');
        emptyLine.className = 'sa-terminal-log-line';

        const textSpan = document.createElement('span');
        textSpan.className = 'sa-terminal-log-text';
        textSpan.textContent = '';
        textSpan.title = '';
        emptyLine.appendChild(textSpan);

        addLogLineWithElement(emptyLine);
        continue;
      }

      // 创建新行
      const line = document.createElement('div');
      line.className = 'sa-terminal-log-line';

      if (markClass && markText) {
        const mark = document.createElement('span');
        mark.className = `sa-terminal-log-mark ${markClass}`;
        mark.textContent = markText;
        line.appendChild(mark);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'sa-terminal-log-text';
      // 解析 BBCode
      let parsedText = parseBBCode(lineContent);
      // 恢复转义的换行符
      Object.keys(escapedNewlineMap).forEach((key) => {
        parsedText = parsedText.replace(key, escapedNewlineMap[key]);
      });
      textSpan.innerHTML = parsedText;

      // 恢复 title 中的转义换行符
      let titleContent = lineContent;
      Object.keys(escapedNewlineMap).forEach((key) => {
        titleContent = titleContent.replace(key, escapedNewlineMap[key]);
      });
      textSpan.title = titleContent;
      line.appendChild(textSpan);

      // 只有第一行需要添加链接
      if (i === 0 && thread) {
        const blockId = thread.peekStack();
        const targetId = thread.target.id;
        const targetInfo = blockId && targetId ? getTargetInfoById(targetId) : null;

        if (showBlockLinksEnabled && targetInfo && targetInfo.exists && blockId) {
          const linkWrapper = document.createElement('span');
          linkWrapper.className = 'sa-terminal-log-link-wrapper';
          linkWrapper.textContent = '[';
          const link = createBlockLink(targetInfo, blockId);
          link.className = 'sa-terminal-block-link';
          linkWrapper.appendChild(link);
          linkWrapper.appendChild(document.createTextNode(']'));
          line.appendChild(linkWrapper);
        }
      }

      addLogLineWithElement(line);
    }

    isProcessingBBCodeQueue = false;

    // 处理下一个队列项
    setTimeout(processBBCodeQueue, 0);
  };

  // 创建支持 BBCode 的日志行（\n 创建新行）
  const createBBCodeLogLines = (text, thread, options = {}) => {
    // 将输出请求加入队列
    bbcodeOutputQueue.push({ text, thread, options });

    // 启动队列处理
    processBBCodeQueue();
  };

  // 添加输出块到 Scratch
  addon.tab.addBlock('\u200B\u200Bterminal_log\u200B\u200B %s', {
    args: ['text'],
    displayName: msg('block-log'),
    callback: ({ text }, thread) => {
      if (terminalOutput) {
        // 默认 log 函数在输出末尾添加换行符
        createLogLines(`${text}\n`, thread);
      }
    }
  });

  addon.tab.addBlock('\u200B\u200Bterminal_log_colored\u200B\u200B %s %s', {
    args: ['text', 'color'],
    displayName: msg('block-log-colored'),
    callback: ({ text, color }, thread) => {
      if (terminalOutput) {
        // 默认 log 函数在输出末尾添加换行符
        createLogLines(`${text}\n`, thread, { color });
      }
    }
  });

  addon.tab.addBlock('\u200B\u200Blog\u200B\u200B %s', {
    args: ['text'],
    displayName: msg('block-log-debug'),
    callback: ({ text }, thread) => {
      if (terminalOutput) {
        // 默认 log 函数在输出末尾添加换行符
        createLogLines(`${text}\n`, thread, { markClass: 'log', markText: '[log]' });
      }
    }
  });

  addon.tab.addBlock('\u200B\u200Bwarn\u200B\u200B %s', {
    args: ['text'],
    displayName: msg('block-warn'),
    callback: ({ text }, thread) => {
      if (terminalOutput) {
        // 默认 log 函数在输出末尾添加换行符
        createLogLines(`${text}\n`, thread, { markClass: 'warn', markText: '[warn]' });
      }
    }
  });

  addon.tab.addBlock('\u200B\u200Berror\u200B\u200B %s', {
    args: ['text'],
    displayName: msg('block-error'),
    callback: ({ text }, thread) => {
      if (terminalOutput) {
        // 默认 log 函数在输出末尾添加换行符
        createLogLines(`${text}\n`, thread, { markClass: 'error', markText: '[error]' });
      }
    }
  });

  // 添加输出积木（可指定结尾字符）
  addon.tab.addBlock('\u200B\u200Bterminal_write\u200B\u200B %s %s', {
    args: ['text', 'end'],
    displayName: msg('block-write') || '输出 %s 并以 %s 结尾',
    callback: ({ text, end }, thread) => {
      if (terminalOutput) {
        // 根据结尾字符决定输出内容
        let outputText = text;
        if (end === '\\n' || end === '\n') {
          // 如果结尾是换行符，则添加换行符
          outputText = `${text}\n`;
        } else if (end && end !== '') {
          // 如果结尾是其他非空字符串，则添加该字符串到输出末尾
          outputText = text + end;
        }
        // 如果 end 是空字符串，则只输出 text，不添加任何结尾
        createLogLines(outputText, thread);
      }
    }
  });

  // // 添加支持 BBCode 的输出积木（默认换行）
  addon.tab.addBlock('\u200B\u200Bterminal_log_bbcode\u200B\u200B %s', {
    args: ['text'],
    displayName: msg('block-log-bbcode') || '输出 BBCode %s',
    callback: ({ text }, thread) => {
      if (terminalOutput) {
        // 默认在输出末尾添加换行符
        createBBCodeLogLines(text, thread);
      }
    }
  });

  // 添加支持 BBCode 的输出积木（可指定结尾字符）
  // addon.tab.addBlock("\u200B\u200Bterminal_write_bbcode\u200B\u200B %s %s", {
  //   args: ["text", "end"],
  //   displayName: msg("block-write-bbcode") || "输出 BBCode %s 并以 %s 结尾",
  //   callback: ({ text, end }, thread) => {
  //     if (terminalOutput) {
  //       let outputText = text;
  //       if (end === "\\n" || end === "\n") {
  //         outputText = text + "\n";
  //       } else if (end && end !== "") {
  //         outputText = text + end;
  //       }
  //       createBBCodeLogLines(outputText, thread);
  //     }
  //   },
  // });

  // 添加 BBCode 示例
  vm.addAddonBlock({
    procedureCode: 'terminal_bbcode_example',
    displayName: msg('block-bbcode-example') || 'BBCode 示例',
    callback: () => {
      // 返回 BBCode 示例
      return '可以使用少量BBCode来自定义输出内容的样式。比如使用\\[color=#66ccff]文本\\[/color]或者\\[c]就可以显示[color=#66ccff]有颜色的文本[/color]了。\n同时，多个颜色将创建一个渐变色的文本，比如你可以使用\\[color=red blue]来创建一个[color=red blue]红到蓝渐变的文本[/color]。\n使用\\[background]或\\[bg]标签可以为指定文本设置[background=#0099ff]背景色[/background]，同时[bg=#66ccff #0099ff]渐变色[/bg]依旧受用。\\n同样的，\\[bold]或者\\[b]可以让[b]文本加粗[/b]，\\[italic]或者\\[i]可以让[i]文本倾斜[/i]，\n\\[underline]或者\\[u]可以给[u]文本下划线[/u]，\\[strikethrough]或者\\[s]可以[s]划掉文本[/s]，甚至你可以使用\\[url]标签来给一段文本加上[url=https://cyberneko.cn]超链接[/url]。\n最后，记住使用\\\\n来换行（当然，直接使用换行符也可以换行）。';
    },
    return: 1
  });

  // 添加用户指令积木
  addon.tab.addBlock('\u200B\u200Badd_user_command\u200B\u200B %s %s', {
    args: ['name', 'description'],
    displayName: msg('block-add-user-command') || '添加用户指令 %s 简介 %s',
    callback: ({ name, description }) => {
      if (name && description) {
        userCommands[name.trim()] = description.trim();
      }
    }
  });

  // 添加导出日志积木
  addon.tab.addBlock('\u200B\u200Bexport_logs\u200B\u200B', {
    args: [],
    displayName: msg('block-export-logs') || '导出日志',
    callback: () => {
      exportLogs();
    }
  });

  // 添加返回值积木（返回用户刚才输入的内容）
  // 直接使用 vm.addAddonBlock 创建返回值块
  vm.addAddonBlock({
    procedureCode: 'terminal_get_input',
    displayName: msg('block-get-input'),
    callback: () => {
      // 返回用户最后一次输入，如果没有则返回空字符串
      return lastUserInput || '';
    },
    return: 1 // 1 表示圆角返回值块
  });

  // 添加返回值积木（返回上次输入时间戳）
  vm.addAddonBlock({
    procedureCode: 'terminal_get_input_timestamp',
    displayName: msg('block-input-timestamp'),
    callback: () => {
      // 返回上次用户输入的时间戳，如果没有则返回0
      return lastInputTimestamp;
    },
    return: 1
  });

  // 添加返回值积木（返回上一行输出内容）
  vm.addAddonBlock({
    procedureCode: 'terminal_get_last_output',
    displayName: msg('block-last-output'),
    callback: () => {
      // 返回上一行输出的内容，不包含定位按钮，保留空格
      if (virtualList.rows.length > 0) {
        const lastRow = virtualList.rows[virtualList.rows.length - 1];
        if (lastRow.element) {
          // 尝试获取日志文本（积木输出）
          let textElement = lastRow.element.querySelector('.sa-terminal-log-text');
          if (textElement) {
            return textElement.textContent || '';
          }
          // 尝试获取结果行文本（命令输出，如 echo）
          if (lastRow.element.classList.contains('sa-terminal-result-line')) {
            return lastRow.element.textContent || '';
          }
          // 尝试获取错误行文本（命令错误）
          if (lastRow.element.classList.contains('sa-terminal-error-line')) {
            return lastRow.element.textContent || '';
          }
          // 尝试获取日志行文本（硬编码指令输出）
          if (lastRow.element.classList.contains('sa-terminal-log-line')) {
            return lastRow.element.textContent || '';
          }
          // 尝试获取命令行文本（用户输入）
          textElement = lastRow.element.querySelector('.sa-terminal-command-line-text');
          if (textElement) {
            // 移除开头的 "> " 提示符，并添加 [user] 前缀
            const content = textElement.textContent || '';
            const userInput = content.startsWith('> ') ? content.slice(2) : content;
            return `[user] ${userInput}`;
          }
        }
      }
      return '';
    },
    return: 1
  });

  // 创建 CUI 性能监控状态条 (停靠在输入框上一行)
  const cuiBar = document.createElement('div');
  cuiBar.className = 'sa-terminal-cui-bar';
  cuiBar.style.display = 'none';

  const cuiBadge = document.createElement('span');
  cuiBadge.className = 'sa-terminal-cui-badge';
  cuiBadge.textContent = 'TOP';

  const cuiChartBox = document.createElement('div');
  cuiChartBox.className = 'sa-terminal-cui-chart-box';
  const cuiCanvas = document.createElement('canvas');
  cuiCanvas.className = 'sa-terminal-cui-canvas';
  cuiCanvas.width = 110;
  cuiCanvas.height = 24;
  cuiChartBox.appendChild(cuiCanvas);

  const cuiFps = document.createElement('span');
  cuiFps.className = 'sa-terminal-cui-fps';
  cuiFps.textContent = '60 FPS';

  const createCuiSeparator = () => {
    const sep = document.createElement('span');
    sep.className = 'sa-terminal-cui-separator';
    sep.textContent = '│';
    return sep;
  };

  const cuiClones = document.createElement('div');
  cuiClones.className = 'sa-terminal-cui-section';
  cuiClones.title = '克隆体数量';
  const cuiClonesVal = document.createElement('span');
  cuiClonesVal.className = 'cui-val';
  cuiClonesVal.textContent = '0/300';
  cuiClones.append('Clones: ', cuiClonesVal);

  const cuiThreads = document.createElement('div');
  cuiThreads.className = 'sa-terminal-cui-section';
  cuiThreads.title = '活动线程数量';
  const cuiThreadsVal = document.createElement('span');
  cuiThreadsVal.className = 'cui-val';
  cuiThreadsVal.textContent = '0';
  cuiThreads.append('Threads: ', cuiThreadsVal);

  const cuiFrame = document.createElement('div');
  cuiFrame.className = 'sa-terminal-cui-section';
  cuiFrame.title = 'VM单帧耗时';
  const cuiFrameVal = document.createElement('span');
  cuiFrameVal.className = 'cui-val';
  cuiFrameVal.textContent = '0.0ms';
  cuiFrame.append('Step: ', cuiFrameVal);

  const cuiTarget = document.createElement('div');
  cuiTarget.className = 'sa-terminal-cui-section';
  cuiTarget.title = '当前活动角色';
  const cuiTargetVal = document.createElement('span');
  cuiTargetVal.className = 'cui-val';
  cuiTargetVal.textContent = 'Stage';
  cuiTarget.append('Target: ', cuiTargetVal);

  const cuiCloseBtn = document.createElement('button');
  cuiCloseBtn.className = 'sa-terminal-cui-close';
  cuiCloseBtn.title = '关闭监控条 (或输入 top)';
  cuiCloseBtn.textContent = '✕';

  cuiBar.append(
    cuiBadge,
    cuiChartBox,
    cuiFps,
    createCuiSeparator(),
    cuiClones,
    createCuiSeparator(),
    cuiThreads,
    createCuiSeparator(),
    cuiFrame,
    createCuiSeparator(),
    cuiTarget,
    cuiCloseBtn
  );

  let isCuiActive = false;
  const fpsHistory = Array(25).fill(60);
  const renderTimes = [];
  let lastFpsCalcTime = performance.now();
  let currentFps = 60;
  let lastStepDuration = 0;

  const drawFpsChart = (fps, maxFps = 60) => {
    const ctx = cuiCanvas.getContext('2d');
    if (!ctx) return;
    const w = cuiCanvas.width;
    const h = cuiCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 绘制微弱背景参考线 (30fps 和 60fps)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    let strokeColor = '#29beb8';
    let gradientStart = 'rgba(41, 190, 184, 0.4)';
    if (fps < 30) {
      strokeColor = '#e06c75';
      gradientStart = 'rgba(224, 108, 117, 0.4)';
    } else if (fps < 50) {
      strokeColor = '#e5c07b';
      gradientStart = 'rgba(229, 192, 123, 0.4)';
    }

    const len = fpsHistory.length;
    const stepX = w / (len - 1);

    // 渐变填充折线下方区域
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < len; i++) {
      const val = Math.max(0, Math.min(maxFps, fpsHistory[i]));
      const x = i * stepX;
      const y = h - (val / maxFps) * (h - 4) - 2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 绘制折线
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const val = Math.max(0, Math.min(maxFps, fpsHistory[i]));
      const x = i * stepX;
      const y = h - (val / maxFps) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 绘制末端指示光点
    const lastVal = Math.max(0, Math.min(maxFps, fpsHistory[len - 1]));
    const lastX = w - 1;
    const lastY = h - (lastVal / maxFps) * (h - 4) - 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const updateCuiDisplay = () => {
    if (!isCuiActive) return;

    const maxFps = vm.runtime.frameLoop.framerate === 0 ? 60 : vm.runtime.frameLoop.framerate;

    cuiFps.textContent = `${currentFps} FPS`;
    cuiFps.style.color = currentFps >= 50 ? '#29beb8' : currentFps >= 30 ? '#e5c07b' : '#e06c75';

    const clones = vm.runtime._cloneCounter || 0;
    cuiClonesVal.textContent = `${clones}/300`;
    cuiClonesVal.style.color = clones > 250 ? '#e06c75' : '#ffffff';

    const threadsCount = vm.runtime.threads ? vm.runtime.threads.length : 0;
    cuiThreadsVal.textContent = threadsCount;

    cuiFrameVal.textContent = `${lastStepDuration.toFixed(1)}ms`;

    const target = vm.runtime.getEditingTarget();
    cuiTargetVal.textContent = target ? target.getName() : 'Stage';

    drawFpsChart(currentFps, maxFps);
  };

  const toggleCui = (forceState) => {
    isCuiActive = typeof forceState === 'boolean' ? forceState : !isCuiActive;
    cuiBar.style.display = isCuiActive ? 'flex' : 'none';
    if (isCuiActive) {
      updateCuiDisplay();
    }
    return isCuiActive;
  };

  cuiCloseBtn.addEventListener('click', () => {
    toggleCui(false);
  });

  // 变量查找与监听管理
  const findVariable = (name) => {
    const target = vm.runtime.getEditingTarget();
    const stage = vm.runtime.getTargetForStage();

    if (target && !target.isStage && target.variables) {
      for (const v of Object.values(target.variables)) {
        if (v.name === name) {
          return { variable: v, target, isLocal: true };
        }
      }
    }
    if (stage && stage.variables) {
      for (const v of Object.values(stage.variables)) {
        if (v.name === name) {
          return { variable: v, target: stage, isLocal: false };
        }
      }
    }
    return null;
  };

  const watchedVariables = new Map();
  // 积木执行热力图管理器
  const heatmapManager = new HeatmapManager(() => addon.tab.traps.getWorkspace(), vm);

  const checkWatchedVariables = () => {
    if (watchedVariables.size === 0) return;
    for (const [id, info] of watchedVariables) {
      const target = vm.runtime.getTargetById(info.targetId);
      if (!target || !target.variables || !target.variables[id]) continue;
      const v = target.variables[id];
      const currentVal = Array.isArray(v.value) ? JSON.stringify(v.value) : v.value;
      if (currentVal !== info.lastValue) {
        const line = document.createElement('div');
        line.className = 'sa-terminal-log-line';

        const mark = document.createElement('span');
        mark.className = 'sa-terminal-log-mark warn';
        mark.textContent = '[watch]';
        line.appendChild(mark);

        const textSpan = document.createElement('span');
        textSpan.className = 'sa-terminal-log-text';
        textSpan.innerHTML = ` 变量 <b>${escapeHTML(info.name)}</b>: <code>${escapeHTML(String(info.lastValue))}</code> &rarr; <b style="color: #4ec9b0;">${escapeHTML(String(currentVal))}</b>`;
        line.appendChild(textSpan);

        addLogLineWithElement(line);
        info.lastValue = currentVal;
      }
    }
  };

  // 挂钩 VM 执行步进，实时采集性能并检测监听变量与热力图
  const originalStep = vm.runtime._step;
  vm.runtime._step = function (...args) {
    const start = performance.now();
    const ret = originalStep.call(this, ...args);
    const end = performance.now();
    lastStepDuration = end - start;

    if (heatmapManager && heatmapManager.isActive && this.threads) {
      for (const thread of this.threads) {
        if (!thread.updateMonitor) {
          const blockId = thread.peekStack ? thread.peekStack() : thread.topBlock;
          if (blockId) {
            heatmapManager.trackBlock(blockId);
          }
        }
      }
    }

    renderTimes.push(end);
    while (renderTimes.length > 0 && renderTimes[0] <= end - 1000) {
      renderTimes.shift();
    }

    if (end - lastFpsCalcTime >= 200) {
      lastFpsCalcTime = end;
      const maxFps = vm.runtime.frameLoop.framerate === 0 ? 60 : vm.runtime.frameLoop.framerate;
      currentFps = Math.min(renderTimes.length, maxFps);
      fpsHistory.shift();
      fpsHistory.push(currentFps);
      if (isCuiActive) {
        updateCuiDisplay();
      }
    }

    checkWatchedVariables();
    return ret;
  };

  if (vm.runtime.sequencer && vm.runtime.sequencer.stepThread) {
    const originalStepThread = vm.runtime.sequencer.stepThread;
    vm.runtime.sequencer.stepThread = function (thread) {
      if (heatmapManager && heatmapManager.isActive && thread && !thread.updateMonitor) {
        const blockId = thread.peekStack ? thread.peekStack() : thread.topBlock;
        if (blockId) {
          heatmapManager.trackBlock(blockId);
        }
      }
      return originalStepThread.call(this, thread);
    };
  }

  // 创建输入行
  const inputLine = document.createElement('div');
  inputLine.className = 'sa-terminal-input-line';

  const prompt = document.createElement('span');
  prompt.className = 'sa-terminal-prompt';
  prompt.textContent = '> ';

  const terminalInput = document.createElement('input');
  terminalInput.type = 'text';
  terminalInput.className = 'sa-terminal-input';
  terminalInput.placeholder = msg('input-placeholder') || '输入命令... (输入 help 查看帮助)';

  inputLine.appendChild(prompt);
  inputLine.appendChild(terminalInput);
  terminalContainer.appendChild(cuiBar);
  terminalContainer.appendChild(inputLine);

  // 命令历史
  const commandHistory = [];
  let historyIndex = -1;

  // 存储用户输入用于返回值积木
  let lastUserInput = '';
  // 存储用户输入时间戳
  let lastInputTimestamp = 0;

  // 存储用户指令
  const userCommands = {};

  // 渲染多行输出并解析 BBCode 格式
  const renderOutputLines = (text) => {
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach((lineContent) => {
      const resultLine = document.createElement('div');
      resultLine.className = 'sa-terminal-result-line';
      let parsedContent = parseBBCode(lineContent);
      parsedContent = parsedContent.replace(
        /(^|>)([^<]*)(?=<|$)/g,
        (match, prefix, content) => prefix + content.replace(/ /g, '&nbsp;')
      );
      resultLine.innerHTML = parsedContent;
      resultLine.title = lineContent;
      virtualList.appendLog({ element: resultLine, contentHash: lineContent });
    });
  };

  // 生成格式化的指令帮助信息卡片
  const formatCommandHelp = (name, cmd) => {
    let out = `【指令】${name.toUpperCase()}\n`;
    out += `  说明：${cmd.description || '暂无说明'}\n`;
    if (cmd.usage) {
      out += `  用法：${cmd.usage}\n`;
    }
    if (cmd.example) {
      const exLines = cmd.example.split('\n');
      if (exLines.length === 1) {
        out += `  示例：${cmd.example}\n`;
      } else {
        out += `  示例：${exLines[0]}\n`;
        for (let i = 1; i < exLines.length; i++) {
          out += `        ${exLines[i]}\n`;
        }
      }
    }
    if (cmd.aliases && cmd.aliases.length > 0) {
      out += `  别名：${cmd.aliases.join(', ')}\n`;
    }
    return out.trimEnd();
  };

  // 可用命令
  const commands = {
    help: {
      description: msg('command-help-desc') || '显示可用命令列表，或查询指定指令的详细用法',
      usage: 'help [指令名]',
      example: 'help\nhelp step\nhelp heatmap',
      aliases: ['?'],
      execute: (args) => {
        if (args && args.length > 0) {
          const target = args[0].toLowerCase();
          const targetCmd = commands[target];
          if (targetCmd) {
            return formatCommandHelp(target, targetCmd);
          }
          if (userCommands[target]) {
            return `【自定义指令】${target}\n  说明：${userCommands[target]}\n  用法：${target} [参数...]`;
          }
          return `未找到指令 "${target}"。输入 "help" 查看所有可用指令。`;
        }

        let output = `${msg('command-help-available') || '可用指令列表：'}\n\n`;
        for (const [name, cmd] of Object.entries(commands)) {
          if (name !== 'creeper?') {
            output += `  ${name.padEnd(12)} - ${cmd.description}\n`;
          }
        }

        // 显示用户指令
        const userCommandCount = Object.keys(userCommands).length;
        if (userCommandCount > 0) {
          output += `\n${msg('command-user-command') || '自定义积木指令：'}\n`;
          for (const [name, description] of Object.entries(userCommands)) {
            output += `  ${name.padEnd(12)} - ${description}\n`;
          }
        }

        output += '\n提示: 输入 "<指令名> help" 或 "help <指令名>" 可查询指定指令的详细用法。';
        return output;
      }
    },
    clear: {
      description: '清空终端屏幕历史日志',
      usage: 'clear',
      example: 'clear',
      aliases: [],
      execute: () => {
        virtualList.clear();
        resetLogTracking();
        return null;
      }
    },
    fastfetch: {
      description: msg('command-fastfetch-desc') || '显示系统与设备运行环境状态信息',
      usage: 'fastfetch',
      example: 'fastfetch',
      aliases: [],
      execute: async () => {
        const asciiArt = `               ░░░░░░░░░                                
          ░░░░░░░░░░░░░░░░░░░                           
       ░░░░░░░░░░░░░░░░░░░░░░░░░                        
     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                      
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                    
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                   
 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  
 ░░░░░░░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒░░                
░░░░░░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░              
░░░░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░            
░░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░          
░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░          
 ░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░          
  ░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░          
  ░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░          
   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░          
  ░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░          
  ░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░            
  ░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▓▒▒▒▒░░░░░░░░░░░░░░░              
  ░░░░░░░░░░░░░░░░░░░░░   ░░░░░░░░░░░░                  
    ░░░░░░░░░░░░░░░░░                                   
     ░░░░░░░░░░░░░░░                                    
       ░░░░░░░░░░░                                       `;

        let output = '【系统与设备环境状态】:\n\n';

        if (navigator.userAgent) {
          output += `  用户代理 (UA): ${navigator.userAgent.substring(0, 100)}${navigator.userAgent.length > 100 ? '...' : ''}\n`;
        }

        if (navigator.platform) {
          output += `  操作系统: ${navigator.platform}\n`;
        }

        if (navigator.language) {
          output += `  系统语言: ${navigator.language}\n`;
        }

        if (navigator.hardwareConcurrency) {
          output += `  CPU 逻辑核心: ${navigator.hardwareConcurrency}\n`;
        }

        if (navigator.deviceMemory) {
          output += `  设备物理内存: ${navigator.deviceMemory} GB\n`;
        }

        if (screen.width && screen.height) {
          output += `  屏幕分辨率: ${screen.width}x${screen.height}\n`;
        }

        if (screen.colorDepth) {
          output += `  色彩深度: ${screen.colorDepth} bits\n`;
        }

        if ('gpu' in navigator) {
          output += `  WebGPU 加速: 支持\n`;
          try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
              output += `  图形适配器: ${adapter.name || '默认适配器'}\n`;

              const features = [];
              for (const feature of adapter.features) {
                features.push(feature);
              }
              if (features.length > 0) {
                output += `  GPU 特性: ${features.slice(0, 5).join(', ')}${features.length > 5 ? '...' : ''}\n`;
              }

              const limits = adapter.limits;
              if (limits && limits.maxTextureDimension2D) {
                output += `  最大纹理尺寸: ${limits.maxTextureDimension2D}x${limits.maxTextureDimension2D}\n`;
              }

              try {
                const device = await adapter.requestDevice();
                output += `  GPU 设备名称: ${device.label || 'Default Device'}\n`;
                device.destroy();
              } catch (deviceError) {}
            } else {
              output += `  图形适配器: 无法获取\n`;
            }
          } catch (error) {
            output += `  GPU 信息错误: ${error.message}\n`;
          }
        } else {
          output += `  WebGPU 加速: 不支持\n`;
        }

        if (navigator.connection) {
          const connection = navigator.connection;
          output += `  网络类型: ${connection.type || '未知'}\n`;
          if (connection.effectiveType) {
            output += `  网络制式: ${connection.effectiveType}\n`;
          }
          if (connection.downlink) {
            output += `  下行速率: ${connection.downlink} Mbps\n`;
          }
        }

        output += `\n  AstraEditor 版本: ${aeVersion.version} (构建于 ${aeVersion.date})\n`;
        output += '  终端组件版本: 1.3.0\n';

        const asciiLines = asciiArt.split('\n');
        const infoLines = output.split('\n');
        let combined = '';
        const maxLines = Math.max(asciiLines.length, infoLines.length);

        for (let i = 0; i < maxLines; i++) {
          const ascii = asciiLines[i] || '';
          const info = infoLines[i] || '';
          const paddedAscii = ascii.padEnd(24);
          combined += `${paddedAscii} ${info}\n`;
        }

        return combined;
      }
    },
    echo: {
      description: msg('command-echo-desc') || '在终端回显输出指定的文本内容（支持 BBCode 颜色与样式）',
      usage: 'echo <文本内容>',
      example: 'echo [color=#4ec9b0]Hello AstraEditor[/color]\necho [b]加粗文本[/b]',
      aliases: [],
      execute: (args) => {
        const text = args.join(' ');
        if (text) {
          createBBCodeLogLines(text, null);
        }
        return null;
      }
    },
    project: {
      description: msg('command-project-desc') || '显示当前 Scratch 项目基本统计信息',
      usage: 'project',
      example: 'project',
      aliases: [],
      execute: () => {
        try {
          const target = vm.runtime.getEditingTarget();
          const stage = vm.runtime.getTargetForStage();

          return `${msg('command-project-output') || '项目统计信息'}:
  ${msg('command-project-stage') || '舞台背景'}: ${stage ? stage.getName() : 'Stage'}
  ${msg('command-project-sprite') || '当前编辑角色'}: ${target ? target.getName() : '无'}
  ${msg('command-project-sprites') || '角色总数'}: ${Math.max(0, vm.runtime.targets.length - 1)}
  ${msg('command-project-variables') || '全局变量与列表数'}: ${stage ? Object.keys(stage.variables).length : 0}
  ${msg('command-project-broadcasts') || '广播事件数'}: ${stage ? Object.keys(stage.blocks).filter((k) => k.startsWith('broadcast_')).length : 0}
`;
        } catch (e) {
          return msg('command-project-error') || '错误：无法获取项目信息';
        }
      }
    },
    variables: {
      description: msg('command-variables-desc') || '列出当前角色的私有变量与舞台全局变量',
      usage: 'variables',
      example: 'variables',
      aliases: [],
      execute: () => {
        try {
          const target = vm.runtime.getEditingTarget();
          const stage = vm.runtime.getTargetForStage();

          let output = `${msg('command-variables-global') || '全局变量与列表：'}\n`;
          let hasGlobal = false;
          if (stage && stage.variables) {
            Object.values(stage.variables).forEach((v) => {
              if (v.type === '' || v.type === 'list') {
                hasGlobal = true;
                const value = v.type === 'list' ? `[${v.value.join(', ')}]` : v.value;
                output += `  ${v.name} = ${value}\n`;
              }
            });
          }
          if (!hasGlobal) output += '  (暂无全局变量)\n';

          output += `\n${msg('command-variables-local') || '当前角色私有变量与列表：'}\n`;
          let hasLocal = false;
          if (target && !target.isStage && target.variables) {
            Object.values(target.variables).forEach((v) => {
              if (v.type === '' || v.type === 'list') {
                hasLocal = true;
                const value = v.type === 'list' ? `[${v.value.join(', ')}]` : v.value;
                output += `  ${v.name} = ${value}\n`;
              }
            });
          }
          if (!hasLocal) output += '  (暂无私有变量)\n';

          return output;
        } catch (e) {
          return msg('command-variables-error') || '错误：无法获取变量信息';
        }
      }
    },
    sprites: {
      description: msg('command-sprites-desc') || '列出项目中所有的角色名称',
      usage: 'sprites',
      example: 'sprites',
      aliases: [],
      execute: () => {
        try {
          let output = `${msg('command-sprites-output') || '角色列表：'}\n`;
          let count = 0;
          vm.runtime.targets.forEach((target) => {
            if (!target.isStage) {
              count++;
              output += `  ${count}. ${target.getName()}\n`;
            }
          });
          if (count === 0) output += '  (暂无角色)\n';
          return output;
        } catch (e) {
          return msg('command-sprites-error') || '错误：无法获取角色列表';
        }
      }
    },
    version: {
      description: msg('command-version-desc') || '显示 AstraEditor Terminal 终端组件版本号',
      usage: 'version',
      example: 'version',
      aliases: [],
      execute: () => `AstraEditor Terminal v${aeVersion.version} (内核构建日期: ${aeVersion.date})`
    },
    top: {
      description: msg('command-top-desc') || '切换输入框上方的实时 CUI 性能监控条 (FPS/克隆/线程)',
      usage: 'top [-s | once]',
      example: 'top  (开启或关闭 CUI 性能条)\ntop -s  (仅输出一次性能快照)',
      aliases: ['perf'],
      execute: (args) => {
        if (args && (args[0] === '-s' || args[0] === 'once')) {
          const maxFps = vm.runtime.frameLoop.framerate === 0 ? 60 : vm.runtime.frameLoop.framerate;
          const clones = vm.runtime._cloneCounter || 0;
          const threads = vm.runtime.threads ? vm.runtime.threads.length : 0;
          const target = vm.runtime.getEditingTarget();
          return `性能快照:\n  实时帧率 (FPS): ${currentFps} / ${maxFps}\n  克隆体数量: ${clones} / 300\n  运行中积木线程: ${threads}\n  单帧步进耗时: ${lastStepDuration.toFixed(2)}ms\n  当前编辑角色: ${target ? target.getName() : '舞台'}`;
        }
        const active = toggleCui();
        if (active) {
          return (
            msg('top-started') || 'CUI 性能监控条已在输入框上方开启。输入 "top" 或点击 ✕ 可关闭。'
          );
        }
        return msg('top-closed') || 'CUI 性能监控条已关闭。';
      }
    },
    perf: {
      description: msg('command-perf-desc') || 'top 指令的快捷别名',
      usage: 'perf [-s | once]',
      example: 'perf',
      aliases: [],
      execute: (args) => commands.top.execute(args)
    },
    fps: {
      description: msg('command-fps-desc') || '查看当前实时帧率与目标帧率',
      usage: 'fps',
      example: 'fps',
      aliases: [],
      execute: (args) => {
        if (!args || args.length === 0) {
          const maxFps = vm.runtime.frameLoop.framerate === 0 ? 60 : vm.runtime.frameLoop.framerate;
          return `当前实时帧率: ${currentFps} FPS (目标帧率: ${maxFps} FPS)`;
        }
        return commands.top.execute(args);
      }
    },
    threads: {
      description: msg('command-threads-desc') || '列出所有当前正在运行的积木线程栈与跳转定位',
      usage: 'threads',
      example: 'threads',
      aliases: ['ps'],
      execute: () => {
        const threads = vm.runtime.threads;
        if (!threads || threads.length === 0) {
          return msg('no-threads-running') || '当前没有正在运行的积木线程。';
        }
        const statusMap = {
          0: '运行中 (RUNNING)',
          1: '等待中 (PROMISE_WAIT)',
          2: '让步 (YIELD)',
          3: '等待下一帧 (YIELD_TICK)',
          4: '已结束 (DONE)'
        };
        for (let i = 0; i < threads.length; i++) {
          const thread = threads[i];
          const target = thread.target;
          const targetInfo = getTargetInfoById(target ? target.id : null);
          const topBlockId = thread.peekStack ? thread.peekStack() : thread.topBlock;
          const status = statusMap[thread.status] || thread.status;

          const line = document.createElement('div');
          line.className = 'sa-terminal-result-line';
          const infoSpan = document.createElement('span');
          infoSpan.textContent = `  #${i + 1} [角色: ${targetInfo.name}] 状态: ${status} `;
          line.appendChild(infoSpan);

          if (topBlockId && targetInfo.exists) {
            const linkWrapper = document.createElement('span');
            linkWrapper.className = 'sa-terminal-log-link-wrapper';
            linkWrapper.textContent = '[';
            const link = createBlockLink(targetInfo, topBlockId);
            link.className = 'sa-terminal-block-link';
            linkWrapper.appendChild(link);
            linkWrapper.appendChild(document.createTextNode(']'));
            line.appendChild(linkWrapper);
          }
          virtualList.appendLog({ element: line, contentHash: line.textContent });
        }
        return `当前活跃线程总数: ${threads.length}`;
      }
    },
    ps: {
      description: msg('command-ps-desc') || 'threads 指令的快捷别名',
      usage: 'ps',
      example: 'ps',
      aliases: [],
      execute: () => commands.threads.execute()
    },
    step: {
      description: msg('command-step-desc') || '单步执行积木（项目运行中会自动挂起并单步推进）',
      usage: 'step [步数]',
      example: 'step  (单步执行 1 个积木)\nstep 5  (连续单步推进 5 步)',
      aliases: ['s'],
      execute: (args) => {
        if (!vm.runtime.threads || vm.runtime.threads.length === 0) {
          return '当前项目中没有正在执行的积木线程。请点击绿旗启动项目或点击积木运行。';
        }

        let count = 1;
        if (args && args.length > 0) {
          const parsed = parseInt(args[0], 10);
          if (!isNaN(parsed) && parsed > 0) {
            count = Math.min(parsed, 100);
          }
        }

        let autoPaused = false;
        if (!isPausedDebugger()) {
          setPausedDebugger(true);
          autoPaused = true;
        }

        let lastTargetName = '';
        let lastBlockId = '';
        for (let i = 0; i < count; i++) {
          singleStepDebugger();
          const running = getRunningThreadDebugger
            ? getRunningThreadDebugger()
            : vm.runtime.sequencer
              ? vm.runtime.sequencer.activeThread
              : null;
          if (running && running.target) {
            lastTargetName = running.target.getName ? running.target.getName() : running.target.id;
            lastBlockId = running.peekStack ? running.peekStack() : running.topBlock;
          }
        }

        const isCompiled = vm.runtime.compilerOptions && vm.runtime.compilerOptions.enabled;
        let compilerTip = '';
        if (isCompiled) {
          compilerTip =
            '\n提示: 当前处于 TurboWarp 编译模式。输入 "compiler off" 可切换为解释器模式，享受逐积木高亮高保真调试！';
        }

        const prefix = autoPaused ? '【已自动挂起项目】' : '';
        if (lastTargetName) {
          return `${prefix}单步推进 ${count} 步 (当前角色: ${lastTargetName}${lastBlockId ? `, 积木ID: ${lastBlockId}` : ''})${compilerTip}`;
        }
        return `${prefix}单步推进 ${count} 步。${compilerTip}`;
      }
    },
    s: {
      description: 'step 指令的快捷别名',
      usage: 's [步数]',
      example: 's\ns 5',
      aliases: [],
      execute: (args) => commands.step.execute(args)
    },
    continue: {
      description: msg('command-continue-desc') || '恢复被暂停的项目全速运行',
      usage: 'continue',
      example: 'continue',
      aliases: ['c'],
      execute: () => {
        if (isPausedDebugger()) {
          setPausedDebugger(false);
          return '已恢复项目运行。';
        }
        return '项目当前正在全速运行中。';
      }
    },
    c: {
      description: 'continue 指令的快捷别名',
      usage: 'c',
      example: 'c',
      aliases: [],
      execute: () => commands.continue.execute()
    },
    pause: {
      description: msg('command-pause-desc') || '暂停项目运行，准备单步调试',
      usage: 'pause',
      example: 'pause',
      aliases: [],
      execute: () => {
        if (!isPausedDebugger()) {
          setPausedDebugger(true);
          const threadCount = vm.runtime.threads ? vm.runtime.threads.length : 0;
          return `已暂停项目运行 (当前活跃线程: ${threadCount})。使用 "step" (或 "s") 进行单步调试，使用 "continue" (或 "c") 恢复全速运行。`;
        }
        return '项目当前已处于暂停状态。';
      }
    },
    kill: {
      description: msg('command-kill-desc') || '强制终止指定编号的执行线程（排查卡顿与死循环利器）',
      usage: 'kill <线程序号>',
      example: 'kill 1',
      aliases: [],
      execute: (args) => {
        const id = parseInt(args[0], 10);
        if (isNaN(id) || id < 1 || !vm.runtime.threads || id > vm.runtime.threads.length) {
          const max = vm.runtime.threads ? vm.runtime.threads.length : 0;
          return `用法: kill <1-${max}>。输入 "threads" 可查看当前活跃线程编号。`;
        }
        const thread = vm.runtime.threads[id - 1];
        if (thread) {
          thread.status = 4; // STATUS_DONE
          return `已成功强制终止线程 #${id} (角色: ${thread.target ? thread.target.getName() : '未知'})。`;
        }
        return `未找到线程 #${id}。`;
      }
    },
    get: {
      description: msg('command-get-desc') || '获取指定变量或列表的当前数值',
      usage: 'get <变量名称>',
      example: 'get 得分\nget 玩家列表',
      aliases: [],
      execute: (args) => {
        const name = args.join(' ').trim();
        if (!name) return '用法: get <变量名称>';
        const found = findVariable(name);
        if (!found) return `未找到名为 "${name}" 的变量或列表。`;
        const { variable, isLocal } = found;
        const scope = isLocal ? '私有' : '全局';
        if (variable.type === 'list') {
          return `[${scope}列表] ${variable.name} (共 ${variable.value.length} 项):\n[ ${variable.value.join(', ')} ]`;
        }
        return `[${scope}] ${variable.name} = ${JSON.stringify(variable.value)}`;
      }
    },
    set: {
      description: msg('command-set-desc') || '直接动态修改运行中项目的变量或列表值',
      usage: 'set <变量名称> <新数值>',
      example: 'set 生命值 100\nset 游戏结束 true\nset 道具 [苹果, 香蕉]',
      aliases: [],
      execute: (args) => {
        if (args.length < 2) return '用法: set <变量名称> <新数值>';
        const name = args[0];
        const rawVal = args.slice(1).join(' ').trim();
        const found = findVariable(name);
        if (!found) return `未找到名为 "${name}" 的变量或列表。`;
        const { variable, target, isLocal } = found;

        let parsedVal = rawVal;
        if (rawVal === 'true') parsedVal = true;
        else if (rawVal === 'false') parsedVal = false;
        else if (!isNaN(Number(rawVal)) && rawVal !== '') parsedVal = Number(rawVal);
        else if (variable.type === 'list') {
          try {
            parsedVal = JSON.parse(rawVal);
            if (!Array.isArray(parsedVal)) parsedVal = rawVal.split(',');
          } catch {
            parsedVal = rawVal.split(',');
          }
        }

        vm.setVariableValue(target.id, variable.id, parsedVal);
        const scope = isLocal ? '私有' : '全局';
        return `[${scope}] 已将 "${variable.name}" 的值修改为: ${JSON.stringify(parsedVal)}`;
      }
    },
    watch: {
      description: msg('command-watch-desc') || '监视指定变量数值变动（变动时在终端实时打日志）',
      usage: 'watch [变量名称 | clear]',
      example: 'watch 得分\nwatch  (查看监视列表)\nwatch clear  (清空所有监视)',
      aliases: [],
      execute: (args) => {
        const name = args.join(' ').trim();
        if (!name) {
          if (watchedVariables.size === 0) return '当前没有监视任何变量。用法: watch <变量名称>';
          let list = '当前监视的变量列表:\n';
          for (const [id, info] of watchedVariables) {
            list += `  - ${info.name} (当前数值: ${JSON.stringify(info.lastValue)})\n`;
          }
          return list;
        }
        if (name === 'clear') {
          const count = watchedVariables.size;
          watchedVariables.clear();
          return `已清空所有 ${count} 个被监视的变量。`;
        }
        const found = findVariable(name);
        if (!found) return `未找到名为 "${name}" 的变量。`;
        const { variable, target, isLocal } = found;
        const currentVal = Array.isArray(variable.value) ? JSON.stringify(variable.value) : variable.value;
        watchedVariables.set(variable.id, {
          name: variable.name,
          targetId: target.id,
          lastValue: currentVal,
          isLocal
        });
        return `已开始监视变量 "${variable.name}"。当该变量在项目运行中变动时，将在终端实时输出日志。`;
      }
    },
    unwatch: {
      description: msg('command-unwatch-desc') || '取消对指定变量的数值变动监视',
      usage: 'unwatch <变量名称>',
      example: 'unwatch 得分',
      aliases: [],
      execute: (args) => {
        const name = args.join(' ').trim();
        if (!name) return '用法: unwatch <变量名称>';
        for (const [id, info] of watchedVariables) {
          if (info.name === name) {
            watchedVariables.delete(id);
            return `已停止对变量 "${name}" 的变动监视。`;
          }
        }
        return `变量 "${name}" 当前并未被监视。`;
      }
    },
    heatmap: {
      description: msg('command-heatmap-desc') || '积木执行热力图（在 Blockly 编辑区直观染色展示执行热度）',
      usage: 'heatmap [on | off | reset | max <数值> | status]',
      example:
        'heatmap on  (开启热力图实时染色)\nheatmap off  (关闭热力图并恢复原本色彩)\nheatmap reset  (重置频次计数)\nheatmap max 1000  (手动指定热度峰值)\nheatmap status  (查看统计状态)',
      aliases: [],
      execute: (args) => {
        if (!args || args.length === 0 || args[0] === 'on' || args[0] === 'start') {
          heatmapManager.start();
          const status = heatmapManager.getStatus();
          return `${msg('heatmap-started') || '已开启积木执行热力图！'}\n  当前追踪积木数: ${status.trackedBlocks}\n  最高执行频次: ${status.maxExecutions}\n  输入 "heatmap off" 可关闭。`;
        }
        const sub = args[0].toLowerCase();
        if (sub === 'off' || sub === 'stop') {
          heatmapManager.stop();
          return msg('heatmap-stopped') || '已关闭热力图并恢复积木原本色彩。';
        }
        if (sub === 'reset' || sub === 'clear') {
          heatmapManager.reset();
          return msg('heatmap-reset') || '已重置积木热力图统计数据。';
        }
        if (sub === 'max') {
          if (args.length < 2) {
            return `当前热力图峰值上限: ${heatmapManager.customMax || '自动缩放 (自适应最大执行频次)'}\n用法: heatmap max <数值> (例如 heatmap max 500)`;
          }
          heatmapManager.setMax(args[1]);
          return `热力图峰值上限已设置为: ${heatmapManager.customMax || '自动缩放'}`;
        }
        if (sub === 'status') {
          const status = heatmapManager.getStatus();
          return `积木执行热力图状态:\n  运行状态: ${status.active ? '【开启中】' : '【已关闭】'}\n  已追踪积木数: ${status.trackedBlocks}\n  最高执行频次: ${status.maxExecutions}\n  自定义上限: ${status.customMax || '自动缩放'}`;
        }
        return '未知参数。用法: heatmap on | off | reset | max <数值> | status';
      }
    },
    compiler: {
      description: msg('command-compiler-desc') || 'TurboWarp 编译器开关控制（解释器模式下支持精准积木单步高亮）',
      usage: 'compiler [on | off]',
      example: 'compiler off  (关闭编译器，进入解释器模式)\ncompiler on  (开启编译器，进入全速运行模式)',
      aliases: [],
      execute: (args) => {
        const currentEnabled = !!(vm.runtime.compilerOptions && vm.runtime.compilerOptions.enabled);
        if (!args || args.length === 0) {
          return `当前编译器状态: ${currentEnabled ? '【已开启】(全速高性能模式)' : '【已关闭】(解释器模式，支持高保真单步调试与高亮)'}\n用法: compiler on (开启) 或 compiler off (关闭)`;
        }
        const opt = args[0].toLowerCase();
        if (opt === 'on' || opt === 'enable' || opt === '1' || opt === 'true') {
          vm.setCompilerOptions({ enabled: true });
          return msg('compiler-on') || 'TurboWarp 编译器已开启（全速高性能模式）。';
        } else if (opt === 'off' || opt === 'disable' || opt === '0' || opt === 'false') {
          vm.setCompilerOptions({ enabled: false });
          return (
            msg('compiler-off') ||
            'TurboWarp 编译器已关闭。项目现在处于解释器模式，支持最精准的积木单步调试与高亮！'
          );
        }
        return '未知参数。用法: compiler on 或 compiler off';
      }
    },
    'creeper?': {
      description: '',
      usage: 'creeper?',
      example: 'creeper?',
      aliases: [],
      execute: () => msg('command-creeper') || 'Awwww Man!'
    }
  };

  const executeCommand = async (command) => {
    const parts = command.trim().split(' ');
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    lastUserInput = command.trim();
    lastInputTimestamp = Date.now();

    if (command.trim()) {
      commandHistory.push(command.trim());
      historyIndex = commandHistory.length;
    }

    resetLogTracking();

    const commandLine = document.createElement('div');
    commandLine.className = 'sa-terminal-command-line';
    const commandText = document.createElement('span');
    commandText.className = 'sa-terminal-command-line-text';
    commandText.title = command;
    createTextWithLinks(commandText, `> ${command}`);
    commandLine.appendChild(commandText);
    virtualList.appendLog({ element: commandLine, contentHash: commandLine.textContent });

    if (!cmdName) {
      return;
    }

    const isHelpArg =
      args.length > 0 && ['help', '-h', '--help', '-?', '?'].includes(args[0].toLowerCase());

    if (cmdName === 'clear') {
      if (isHelpArg) {
        renderOutputLines(formatCommandHelp('clear', commands.clear));
        return;
      }
      virtualList.clear();
      resetLogTracking();
      return;
    }

    const cmd = commands[cmdName];
    if (cmd) {
      if (isHelpArg) {
        renderOutputLines(formatCommandHelp(cmdName, cmd));
        return;
      }
      try {
        const result = await cmd.execute(args);
        if (result) {
          renderOutputLines(result);
        }
      } catch (e) {
        const errorLine = document.createElement('div');
        errorLine.className = 'sa-terminal-error-line';
        errorLine.textContent = `Error: ${e.message}`;
        errorLine.title = `Error: ${e.message}`;
        virtualList.appendLog({ element: errorLine, contentHash: errorLine.textContent });
      }
    } else if (userCommands[cmdName]) {
      if (isHelpArg) {
        renderOutputLines(
          `【自定义指令】${cmdName}\n  说明：${userCommands[cmdName]}\n  用法：${cmdName} [参数...]`
        );
        return;
      }
    } else {
      const errorLine = document.createElement('div');
      errorLine.className = 'sa-terminal-error-line';
      errorLine.textContent = `未知指令: "${cmdName}"。输入 "help" 查看所有可用指令。`;
      errorLine.title = errorLine.textContent;
      virtualList.appendLog({ element: errorLine, contentHash: errorLine.textContent });
    }
  };

  // 输入处理
  terminalInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const command = terminalInput.value;
      terminalInput.value = '';
      await executeCommand(command);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        terminalInput.value = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        terminalInput.value = commandHistory[historyIndex];
      } else {
        historyIndex = commandHistory.length;
        terminalInput.value = '';
      }
    }
  });

  // 聚焦输入框
  terminalContainer.addEventListener('click', () => {
    terminalInput.focus();
  });

  // 等待 TabBar 元素（用于侧边栏模式）
  const tabBar = await addon.tab.waitForElement('[class*="react-tabs_react-tabs__tab-list"]', {
    markAsSeen: true
  });

  // 创建底部的Terminal开关按钮
  const toggleButton = document.createElement('button');
  toggleButton.className = 'sa-terminal-toggle-button';

  // 创建图标元素 - 使用 tw-recolor loader 加载图标（会自动替换为主题色）
  const toggleBtnIcon = document.createElement('img');
  toggleBtnIcon.draggable = false;
  toggleBtnIcon.src = icon();
  toggleBtnIcon.style.filter = 'grayscale(100%)';
  toggleBtnIcon.style.width = '25px';
  toggleBtnIcon.style.height = 'auto';

  // 创建文本元素
  const toggleBtnText = document.createElement('span');
  toggleBtnText.textContent = 'Terminal';

  // 添加图标和文本
  toggleButton.appendChild(toggleBtnIcon);
  toggleButton.appendChild(toggleBtnText);

  addon.tab.displayNoneWhileDisabled(toggleButton);

  // 创建舞台头部的 Terminal 按钮（用于独立窗口模式）
  const stageHeaderButton = document.createElement('div');
  stageHeaderButton.className = 'sa-terminal-stage-header-button';
  const stageHeaderBtnInner = document.createElement('div');
  stageHeaderBtnInner.className = addon.tab.scratchClass('button_outlined-button', 'stage-header_stage-button');
  const stageHeaderBtnContent = document.createElement('div');
  stageHeaderBtnContent.className = addon.tab.scratchClass('button_content');
  const stageHeaderBtnIcon = document.createElement('img');
  stageHeaderBtnIcon.className = addon.tab.scratchClass('stage-header_stage-button-icon');
  stageHeaderBtnIcon.draggable = false;
  stageHeaderBtnIcon.src = icon();
  stageHeaderBtnIcon.style.filter = 'grayscale(100%)';
  stageHeaderBtnContent.appendChild(stageHeaderBtnIcon);
  stageHeaderBtnInner.appendChild(stageHeaderBtnContent);
  stageHeaderButton.appendChild(stageHeaderBtnInner);

  // 注册面板插件
  SideBar.register('terminal', terminalContainer, {
    onActivate: () => {
      virtualList.show();
      terminalInput.focus();
      toggleButton.classList.add('sa-terminal-toggle-active', 'is-selected');
      // 移除图标的灰度滤镜，使其显示主题色
      if (toggleBtnIcon) {
        toggleBtnIcon.style.filter = 'grayscale(0%)';
      }
    },
    onDeactivate: () => {
      virtualList.hide();
      toggleButton.classList.remove('sa-terminal-toggle-active', 'is-selected');
      // 恢复图标的灰度滤镜
      if (toggleBtnIcon) {
        toggleBtnIcon.style.filter = 'grayscale(100%)';
      }
    }
  });

  BottomPanel.register('terminal', terminalContainer, {
    onActivate: () => {
      virtualList.show();
      terminalInput.focus();
      toggleButton.classList.add('sa-terminal-toggle-active');
      // 移除按钮栏的底部边框
      const buttonBar = BottomPanel.getButtonBar();
      if (buttonBar) {
        buttonBar.style.borderBottom = 'none';
      }
    },
    onDeactivate: () => {
      virtualList.hide();
      toggleButton.classList.remove('sa-terminal-toggle-active');
      // 恢复按钮栏的底部边框
      const buttonBar = BottomPanel.getButtonBar();
      if (buttonBar) {
        buttonBar.style.borderBottom = '1px solid var(--ui-black-transparent)';
      }
    }
  });

  // 按钮点击事件（通用）
  const handleToggleButtonClick = () => {
    if (isTerminalVisible()) {
      toggleTerminal(false);
    } else {
      toggleTerminal(true);
    }
  };

  toggleButton.addEventListener('click', handleToggleButtonClick);
  stageHeaderButton.addEventListener('click', handleToggleButtonClick);

  // 监听 Bottom Panel 打开事件，确保 Terminal 激活时移除边框
  window.addEventListener('bottomPanelOpened', () => {
    if (BottomPanel.getActivePlugin() === 'terminal') {
      const buttonBar = BottomPanel.getButtonBar();
      if (buttonBar) {
        buttonBar.style.borderBottom = 'none';
      }
    }
  });

  // 更新启用按钮位置
  /**
   * 更新 Terminal 启用按钮的位置和样式。
   */
  function updateToggleButtonPosition() {
    // 先移除所有位置的按钮
    if (toggleButton.parentNode) {
      toggleButton.parentNode.removeChild(toggleButton);
    }
    if (stageHeaderButton.parentNode) {
      stageHeaderButton.parentNode.removeChild(stageHeaderButton);
    }

    // 根据当前位置添加按钮
    switch (currentPosition) {
      case POSITION_TYPES.SIDEBAR:
        // Sidebar 模式：添加到 TabBar，只显示图标
        if (tabBar) {
          // 使用与 SPA、bookmark 相同的类名
          toggleButton.className = addon.tab.scratchClass('menu-bar_menu-bar-button', {
            others: 'sa-terminal-toggle-button vscode-tab'
          });
          // 只显示图标
          toggleBtnIcon.style.display = 'inline';
          toggleBtnText.style.display = 'none';
          tabBar.appendChild(toggleButton);
        }
        break;
      case POSITION_TYPES.BOTTOM_PANEL: {
        // Bottom Panel 模式：添加到 Bottom Panel 按钮栏
        const bottomBarButtonBar = BottomPanel.getButtonBar();
        if (bottomBarButtonBar) {
          toggleButton.className = 'sa-terminal-toggle-button';
          // 显示图标和文字
          toggleBtnIcon.style.display = 'inline';
          toggleBtnText.style.display = 'inline';
          bottomBarButtonBar.appendChild(toggleButton);
          BottomPanel.updateButtonBarVisibility();
        }
        break;
      }
      case POSITION_TYPES.WINDOW:
        // 独立窗口模式：添加到舞台头部
        addon.tab.appendToSharedSpace({
          space: 'stageHeader',
          element: stageHeaderButton,
          order: 0
        });
        toggleButton.style.marginRight = '2px';
        break;
    }

    // 无论切换到什么模式，都更新按钮栏显示状态
    BottomPanel.updateButtonBarVisibility();

    // 更新按钮激活状态
    if (isTerminalVisible()) {
      toggleButton.classList.add('sa-terminal-toggle-active');
      stageHeaderBtnInner.classList.add('sa-terminal-toggle-active');
    } else {
      toggleButton.classList.remove('sa-terminal-toggle-active');
      stageHeaderBtnInner.classList.remove('sa-terminal-toggle-active');
    }
  }

  // 将按钮添加到BottomPanel的按钮栏（初始位置）
  while (true) {
    const buttonBar = BottomPanel.getButtonBar();
    if (buttonBar) {
      console.log('Button bar found, adding terminal button');
      // 使用 updateToggleButtonPosition 来正确设置按钮样式
      updateToggleButtonPosition();
      console.log('Terminal button added to button bar');
      BottomPanel.updateButtonBarVisibility();
      window.dispatchEvent(new Event('resize'));
      break;
    }
    console.log('Button bar not found yet, waiting...');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Re-inject button when tab bar is recreated (project load, layout refresh, etc.)
  (async () => {
    while (true) {
      await addon.tab.waitForElement('[class*="react-tabs_react-tabs__tab-list"]', {
        markAsSeen: true,
        reduxEvents: [
          'scratch-gui/mode/SET_PLAYER',
          'fontsLoaded/SET_FONTS_LOADED',
          'scratch-gui/locales/SELECT_LOCALE'
        ],
        reduxCondition: (state) => !state.scratchGui.mode.isPlayerOnly
      });
      updateToggleButtonPosition();
    }
  })();

  // 根据主题更新按钮文字颜色
  const updateButtonTextColor = () => {
    try {
      const themeData = localStorage.getItem('tw:theme');
      let isLightMode = false;

      if (themeData) {
        const parsed = JSON.parse(themeData);
        isLightMode = parsed.gui === 'light';
      } else {
        // 如果没有存储主题数据，检查系统偏好
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        isLightMode = !prefersDark;
      }

      // 设置按钮文字颜色
      toggleBtnText.style.color = isLightMode ? '#575E75' : '#ffffff';
    } catch (e) {
      console.error('Failed to update button text color:', e);
    }
  };

  // 初始化按钮文字颜色
  updateButtonTextColor();

  // 监听主题变化
  window.addEventListener('tw:theme-changed', updateButtonTextColor);

  // 监听布局变化
  window.addEventListener('storage', (e) => {
    if (e.key === 'AESettings' && e.newValue && e.oldValue) {
      try {
        const newSettings = JSON.parse(e.newValue);
        const oldSettings = JSON.parse(e.oldValue);

        if (newSettings.EnableVSCodeLayout !== oldSettings.EnableVSCodeLayout) {
          // 更新侧边栏按钮的可用状态
          updatePositionSwitchButton();

          // 如果当前在侧边栏模式且布局被禁用，切换到底部面板
          if (currentPosition === POSITION_TYPES.SIDEBAR && !newSettings.EnableVSCodeLayout) {
            switchTerminalPosition(POSITION_TYPES.BOTTOM_PANEL);
          }
        }
      } catch (error) {
        console.error('Failed to parse AESettings:', error);
      }
    }
  });

  // 初始化位置切换按钮状态
  updatePositionSwitchButton();
}
