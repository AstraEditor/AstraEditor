/* eslint-disable import/no-unresolved -- chart.js 使用 package.json exports，旧版解析器无法识别 */
import {
  Chart,
  RadarController,
  DoughnutController,
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
  Legend,
  Tooltip
} from 'chart.js';
/* eslint-enable import/no-unresolved */

// 注册Chart.js组件
Chart.register(
  RadarController,
  DoughnutController,
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
  Legend,
  Tooltip
);
import icon from '!../../../lib/tw-recolor/build!./SPA.svg';
import AddToBar from '../../tools/AddToBar/index.js';
import ReduxStore from '../../redux.js';

// 积木统计直接读取 VM 运行时，避免 SB3 序列化时压缩 primitive 积木。

const VARIABLE_TYPE_LIST = 'list';
const VARIABLE_TYPE_BROADCAST = 'broadcast_msg';

const STRUCTURAL_CONTROL_OPCODES = new Set([
  'control_if',
  'control_if_else',
  'control_repeat',
  'control_forever',
  'control_repeat_until',
  'control_while',
  'control_for_each'
]);

// Dr.Scratch 的列表操作集合，不包含只读取整个列表内容的 data_listcontents。
const LIST_OPCODES = new Set([
  'data_addtolist',
  'data_deleteoflist',
  'data_deletealloflist',
  'data_insertatlist',
  'data_replaceitemoflist',
  'data_itemoflist',
  'data_itemnumoflist',
  'data_lengthoflist',
  'data_listcontainsitem',
  'data_showlist',
  'data_hidelist'
]);

// Dr.Scratch 用来判断“角色属性变化”的运动/外观积木。
const SPRITE_MODIFIER_OPCODES = new Set([
  'looks_switchbackdropto',
  'looks_switchbackdroptoandwait',
  'looks_nextbackdrop',
  'looks_switchcostumeto',
  'looks_nextcostume',
  'looks_changesizeby',
  'looks_setsizeto',
  'looks_hide',
  'looks_show',
  'looks_seteffectto',
  'looks_changeeffectby',
  'motion_turnright',
  'motion_turnleft',
  'motion_pointindirection',
  'motion_pointtowards',
  'motion_movesteps',
  'motion_gotoxy',
  'motion_goto',
  'motion_glidesecstoxy',
  'motion_glideto',
  'motion_changexby',
  'motion_setx',
  'motion_changeyby',
  'motion_sety'
]);

const ADVANCED_MATH_OPERATORS = new Set([
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
]);

/**
 * Simple Project Analyzer 插件入口。
 */
export default function ({ addon, msg, console }) {
  const vm = addon.tab.traps.vm;

  /**
   * 项目分析器。
   */
  class SimpleProjectAnalyzer {
    constructor() {
      this.analyzeModal = null;
      this.removeModal = null;
      this.chartInstance = null;
      this.codeTypesChartInstance = null;
      this.mathLogicChartInstance = null;
      this.drScratchChartInstance = null;
      this.sidebarContent = null;
      this.projectName = '';
      this.sidebarActive = false;
      this.refreshTimeout = null;

      // 订阅 Redux Store 获取作品名称
      this.onReduxStateChanged = (e) => {
        const state = e.detail.next;
        if (state && state.scratchGui && state.scratchGui.projectTitle) {
          this.projectName = state.scratchGui.projectTitle;
        }
      };
      ReduxStore.addEventListener('statechanged', this.onReduxStateChanged);
    }

    // 统一销毁所有 Chart.js 实例
    destroyCharts() {
      ['chartInstance', 'codeTypesChartInstance', 'mathLogicChartInstance', 'drScratchChartInstance'].forEach((key) => {
        if (this[key]) {
          this[key].destroy();
          this[key] = null;
        }
      });
    }

    // Sidebar 加载状态的 HTML
    getSidebarLoadingHTML() {
      return `
        <div class="sa-spa-sidebar-spinner" style="
          width: 40px;
          height: 40px;
          border: 4px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          border-top-color: var(--ui-primary);
          animation: sa-spa-spin 1s ease-in-out infinite;
        "></div>
        <p style="color: var(--text-primary);">${msg('analyzing')}</p>
      `;
    }

    getEffectiveBlocksHelp() {
      return msg('effective-blocks-help');
    }

    getExtensionCategoryInfo(extensionId) {
      const blockInfo = vm.runtime && vm.runtime._blockInfo;
      if (!Array.isArray(blockInfo)) return null;
      return blockInfo.find((info) => info && info.id === extensionId) || null;
    }

    // 扩展名称来自扩展元数据，插入 HTML 前需要转义
    escapeHTML(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // 扩展颜色来自扩展元数据，只允许常见的安全颜色格式
    getSafeColor(color) {
      if (typeof color !== 'string') return null;
      const value = color.trim();
      if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
      if (/^(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)$/i.test(value)) return value;
      return null;
    }

    /**
     * 直接从 VM 运行时收集项目数据。
     * 不使用 vm.toJSON()，因为序列化会把 data_variable / data_listcontents
     * 等 primitive 积木压缩成内联数组，导致积木数量少算。
     */
    getLiveProjectData() {
      const seenBlocks = new Set();
      const targets = [];

      for (const target of vm.runtime.targets) {
        // 克隆体与原始角色共享 blocks，只统计原始角色
        if (!target.isOriginal) continue;
        const blocks = target.blocks && target.blocks._blocks;
        if (!blocks) continue;
        if (seenBlocks.has(blocks)) continue;
        seenBlocks.add(blocks);

        targets.push({
          name: target.getName(),
          isStage: target.isStage,
          blocks,
          variables: target.variables || {},
          costumes: target.getCostumes(),
          sounds: target.getSounds()
        });
      }

      let extensionURLs = {};
      if (vm.extensionManager && typeof vm.extensionManager.getExtensionURLs === 'function') {
        extensionURLs = vm.extensionManager.getExtensionURLs();
      }

      return {
        targets,
        extensionURLs
      };
    }

    // 创建分析按钮
    // 显示分析结果模态框
    showAnalysisModal() {
      // 如果模态框已存在，先移除
      if (this.analyzeModal) {
        this.analyzeModal.remove();
      }

      // 使用 addon.tab.createModal 创建模态框
      const { backdrop, container, content, closeButton, remove } = addon.tab.createModal(msg('modal-title'), {
        isOpen: true
      });

      this.analyzeModal = backdrop;
      this.removeModal = remove;

      // 添加自定义 CSS 类
      container.classList.add('sa-analyze-modal-popup');
      content.classList.add('sa-analyze-modal-content');

      // 生成分析结果HTML（类似子目录中的界面）
      const analysisHTML = this.generateAnalysisHTML();

      // 设置模态框内容
      content.innerHTML = `
        <div class="sa-analyze-header">
          <button id="saExportButton" class="sa-export-button">
            ${msg('export-image')}
          </button>
        </div>
        <div class="sa-analyze-loading" id="saAnalyzeLoading">
          <div class="sa-analyze-spinner"></div>
          <p>${msg('analyzing')}</p>
        </div>
        <div class="sa-analyze-results" id="saAnalyzeResults" style="display: none;">
          ${analysisHTML}
        </div>
      `;

      // 添加关闭事件监听器
      backdrop.addEventListener('click', () => this.closeModal());
      closeButton.addEventListener('click', () => this.closeModal());

      // 添加导出按钮事件
      document.getElementById('saExportButton').addEventListener('click', () => {
        this.exportAnalysisAsImage();
      });

      // 异步分析项目
      this.analyzeProject();
    }

    closeModal() {
      if (this.removeModal) {
        this.removeModal();
        this.analyzeModal = null;
        this.removeModal = null;

        // 销毁图表实例
        this.destroyCharts();
      }
    }

    // 创建 Sidebar 内容容器
    createSidebarContent() {
      if (!this.sidebarContent) {
        this.sidebarContent = document.createElement('div');
        this.sidebarContent.className = 'sa-spa-sidebar-content';
        this.sidebarContent.style.cssText = `
          width: 100%;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          overflow-y: auto;
          box-sizing: border-box;
        `;

        // 添加标题栏（包含标题和导出按钮）
        const header = document.createElement('div');
        header.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.1);
          flex-shrink: 0;
        `;

        // 添加标题
        const title = document.createElement('div');
        title.className = 'sa-spa-sidebar-title';
        title.style.cssText = `
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        `;
        title.textContent = msg('modal-title');
        header.appendChild(title);

        // 添加导出按钮
        const exportButton = document.createElement('button');
        exportButton.id = 'saSPASidebarExportButton';
        exportButton.className = 'sa-spa-sidebar-export-button';
        exportButton.textContent = msg('export-image');
        exportButton.style.cssText = `
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          color: #ffffff;
          background-color: var(--motion-primary);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: none;
        `;
        exportButton.addEventListener('click', () => {
          this.exportAnalysisAsImage();
        });
        header.appendChild(exportButton);

        this.sidebarContent.appendChild(header);

        // 添加加载提示
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'sa-spa-sidebar-loading';
        loadingDiv.id = 'saSAPASidebarLoading';
        loadingDiv.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          gap: 16px;
        `;
        loadingDiv.innerHTML = this.getSidebarLoadingHTML();
        this.sidebarContent.appendChild(loadingDiv);

        // 添加结果容器
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'sa-spa-sidebar-results';
        resultsDiv.id = 'saSAPASidebarResults';
        resultsDiv.style.cssText = `
          display: none;
          gap: 16px;
          flex-direction: column;
        `;
        this.sidebarContent.appendChild(resultsDiv);

        // 添加 CSS 动画
        const style = document.createElement('style');
        style.textContent = `
          @keyframes sa-spa-spin {
            to { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }
    }

    // 在 Sidebar 中显示分析结果
    showAnalysisSidebar() {
      this.createSidebarContent();

      const loadingDiv = document.getElementById('saSAPASidebarLoading');
      const resultsDiv = document.getElementById('saSAPASidebarResults');

      if (loadingDiv) {
        loadingDiv.innerHTML = this.getSidebarLoadingHTML();
        loadingDiv.style.display = 'flex';
      }
      if (resultsDiv) resultsDiv.style.display = 'none';
    }

    // 为 Sidebar 分析项目
    async analyzeProjectForSidebar() {
      try {
        // 直接读取 VM 运行时中的积木，避免 toJSON 压缩变量/列表读取积木
        const projectData = this.getLiveProjectData();

        // 执行分析
        const analysis = this.performAnalysis(projectData);

        // 更新 Sidebar UI
        this.updateSidebarResults(analysis, projectData);
      } catch (error) {
        console.error(msg('analysis-error'), error);
        const loadingDiv = document.getElementById('saSAPASidebarLoading');
        const resultsDiv = document.getElementById('saSAPASidebarResults');
        if (loadingDiv) {
          // 自动刷新失败时 loading 可能已被隐藏，需要重新显示错误
          loadingDiv.innerHTML = `<p style="color: #d32f2f;">${msg('analysis-error')}</p>`;
          loadingDiv.style.display = 'flex';
        }
        if (resultsDiv) resultsDiv.style.display = 'none';
      }
    }

    // 更新 Sidebar 分析结果
    updateSidebarResults(analysis, projectData) {
      const resultsDiv = document.getElementById('saSAPASidebarResults');
      const loadingDiv = document.getElementById('saSAPASidebarLoading');

      if (!resultsDiv) return;

      // 生成简化版的 HTML（适合 Sidebar 显示）
      resultsDiv.innerHTML = this.generateSidebarAnalysisHTML();

      // 更新统计数据
      this.updateSidebarStats(analysis);

      // 显示代码类型分布饼图
      this.displaySidebarCodeTypesChart(analysis);

      // 计算并更新评分
      const { drScratchScores, mathLogicScores } = this.calculateScores(projectData);
      this.displaySidebarDrScratchScores(drScratchScores);
      this.displaySidebarMathLogicScores(mathLogicScores);

      // 更新扩展列表
      this.displaySidebarExtensions(analysis.extensions);

      // 显示结果，隐藏加载
      if (loadingDiv) loadingDiv.style.display = 'none';
      resultsDiv.style.display = 'flex';
    }

    // 生成 Sidebar 版本的分析结果 HTML
    generateSidebarAnalysisHTML() {
      return `
        <div class="sa-spa-stats-section" style="
          background: var(--ui-secondary);
          border-radius: 8px;
          padding: 12px;
        ">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary);">${msg('project-stats')}</h4>
          <div class="sa-spa-stats-grid" id="saSAPAStatsGrid" style="
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          "></div>
        </div>

        <div class="sa-spa-codetypes-section" style="
          background: var(--ui-secondary);
          border-radius: 8px;
          padding: 12px;
        ">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary);">${msg('block-distribution')}</h4>
          <div style="height: 200px; margin-top: 8px;">
            <canvas id="saSAPACodeTypesChart"></canvas>
          </div>
        </div>

        <div class="sa-spa-drscratch-section" style="
          background: var(--ui-secondary);
          border-radius: 8px;
          padding: 12px;
        ">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary);">${msg('dr-scratch-score')}</h4>
          <div class="sa-spa-drscratch-summary" id="saSAPADrScratchSummary" style="
            font-size: 14px;
            color: var(--text-primary);
          "></div>
          <div style="height: 180px; margin-top: 8px;">
            <canvas id="saSAPADrScratchChart"></canvas>
          </div>
        </div>

        <div class="sa-spa-math-section" style="
          background: var(--ui-secondary);
          border-radius: 8px;
          padding: 12px;
        ">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary);">${msg('math-logic-assessment')}</h4>
          <p style="margin: 0 0 8px 0; font-size: 12px; color: var(--text-primary); opacity: 0.65;">${msg('math-logic-help')}</p>
          <div class="sa-spa-math-summary" id="saSAPAMathSummary" style="
            font-size: 14px;
            color: var(--text-primary);
          "></div>
          <div style="height: 180px; margin-top: 8px;">
            <canvas id="saSAPAMathChart"></canvas>
          </div>
        </div>

        <div class="sa-spa-extensions-section" style="
          background: var(--ui-secondary);
          border-radius: 8px;
          padding: 12px;
        ">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary);">${msg('extensions-used')}</h4>
          <div class="sa-spa-extensions-list" id="saSAPAExtensionsList" style="
            display: flex;
            flex-direction: column;
            gap: 8px;
          "></div>
        </div>
      `;
    }

    // 更新 Sidebar 统计数据
    updateSidebarStats(analysis) {
      const statsGrid = document.getElementById('saSAPAStatsGrid');
      if (!statsGrid) return;

      const stats = [
        { label: msg('total-blocks'), value: analysis.totalBlocks },
        {
          label: msg('effective-blocks'),
          value: analysis.effectiveBlocks,
          title: this.getEffectiveBlocksHelp()
        },
        {
          label: msg('function-definitions'),
          value: analysis.functionDefinitions
        },
        { label: msg('stat-sprites'), value: analysis.sprites },
        { label: msg('stat-costumes'), value: analysis.costumeCount },
        { label: msg('stat-sounds'), value: analysis.soundCount },
        { label: msg('stat-variables'), value: analysis.variableCount },
        { label: msg('stat-lists'), value: analysis.listCount }
      ];

      statsGrid.innerHTML = stats
        .map(
          (stat) => `
        <div style="
          background: var(--ui-white);
          border-radius: 4px;
          padding: 8px;
          text-align: center;
        " title="${stat.title || ''}">
          <div style="font-size: 18px; font-weight: bold; color: var(--motion-primary);">${stat.value}</div>
          <div style="font-size: 11px; color: var(--text-primary); opacity: 0.8;">${stat.label}</div>
        </div>
      `
        )
        .join('');
    }

    // 显示 Sidebar 版本的代码类型分布饼图
    displaySidebarCodeTypesChart(analysis) {
      const canvas = document.getElementById('saSAPACodeTypesChart');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');

      const categoryColors = {
        [msg('motion')]: '#4C97FF',
        [msg('looks')]: '#9966FF',
        [msg('sound')]: '#CF63CF',
        [msg('events')]: '#FFBF00',
        [msg('control')]: '#FFAB19',
        [msg('sensing')]: '#5CB1D6',
        [msg('operators')]: '#59C059',
        [msg('data')]: '#FF8C1A',
        [msg('custom-functions')]: '#FF6680'
      };

      const extensionColors = [
        '#3498DB',
        '#E74C3C',
        '#F39C12',
        '#27AE60',
        '#16A085',
        '#2ECC71',
        '#E67E22',
        '#95A5A6',
        '#34495E',
        '#7F8C8D',
        '#9B59B6',
        '#1ABC9C',
        '#2C3E50',
        '#F1C40F',
        '#D35400'
      ];

      const standardOrder = [
        msg('motion'),
        msg('looks'),
        msg('sound'),
        msg('events'),
        msg('control'),
        msg('sensing'),
        msg('operators'),
        msg('data'),
        msg('custom-functions')
      ];

      const sortedCodeTypes = {};
      standardOrder.forEach((category) => {
        if (analysis.codeTypes[category]) {
          sortedCodeTypes[category] = analysis.codeTypes[category];
        }
      });

      Object.keys(analysis.codeTypes)
        .sort()
        .forEach((category) => {
          if (!standardOrder.includes(category)) {
            sortedCodeTypes[category] = analysis.codeTypes[category];
          }
        });

      const labels = Object.keys(sortedCodeTypes);
      const data = Object.values(sortedCodeTypes);
      const colors = labels.map((label, index) => {
        if (categoryColors[label]) return categoryColors[label];
        return extensionColors[index % extensionColors.length];
      });

      if (this.codeTypesChartInstance) {
        this.codeTypesChartInstance.destroy();
      }

      this.codeTypesChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: colors,
              borderWidth: 2,
              borderColor: '#ffffff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                padding: 8,
                font: {
                  size: 10
                }
              }
            }
          }
        }
      });
    }

    // 显示 Sidebar 版本的 Dr.Scratch 评分
    displaySidebarDrScratchScores(scores) {
      const canvas = document.getElementById('saSAPADrScratchChart');
      const summaryDiv = document.getElementById('saSAPADrScratchSummary');

      if (!canvas || !summaryDiv) return;

      const ctx = canvas.getContext('2d');
      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 更新总分摘要
      const level = this.getDrScratchLevel(totalScore);

      summaryDiv.innerHTML = `<strong>${msg('total-score')}：</strong>${totalScore} / 21<br><strong>${msg('evaluation-level')}：</strong>${level}`;

      // 创建雷达图
      if (this.drScratchChartInstance) {
        this.drScratchChartInstance.destroy();
      }

      this.drScratchChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: 'rgba(77, 151, 255, 0.2)',
              borderColor: '#4d97ff',
              borderWidth: 2,
              pointBackgroundColor: '#4d97ff',
              pointBorderColor: '#fff',
              pointRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              max: 3,
              ticks: {
                stepSize: 1,
                font: { size: 10 }
              },
              pointLabels: {
                font: { size: 9 }
              }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    // 显示 Sidebar 版本的数学逻辑评分
    displaySidebarMathLogicScores(scores) {
      const canvas = document.getElementById('saSAPAMathChart');
      const summaryDiv = document.getElementById('saSAPAMathSummary');

      if (!canvas || !summaryDiv) return;

      const ctx = canvas.getContext('2d');
      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 更新总分摘要
      const level = this.getMathLogicLevel(totalScore);

      summaryDiv.innerHTML = `<strong>${msg('math-total-score')}：</strong>${totalScore} / 9<br><strong>${msg('evaluation-level')}：</strong>${level}`;

      // 创建雷达图
      if (this.mathLogicChartInstance) {
        this.mathLogicChartInstance.destroy();
      }

      this.mathLogicChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: 'rgba(230, 81, 0, 0.2)',
              borderColor: '#E65100',
              borderWidth: 2,
              pointBackgroundColor: '#E65100',
              pointBorderColor: '#fff',
              pointRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              max: 3,
              ticks: {
                stepSize: 1,
                font: { size: 10 }
              },
              pointLabels: {
                font: { size: 9 }
              }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || '';
                  const rawValue = data[context.dataIndex];
                  return `${label}: ${rawValue}/3`;
                }
              }
            }
          }
        }
      });
    }

    // 显示 Sidebar 版本的扩展列表
    displaySidebarExtensions(extensions) {
      const extensionList = document.getElementById('saSAPAExtensionsList');
      if (!extensionList) return;

      if (extensions.length === 0) {
        extensionList.innerHTML = `<p style="font-size: 12px; color: var(--text-primary); opacity: 0.7;">${msg('no-extensions')}</p>`;
        return;
      }

      extensionList.innerHTML = extensions
        .map((extension) => {
          const color = this.getSafeColor(extension.color) || '#888888';
          return `
          <div style="
            background: var(--ui-white);
            border-radius: 4px;
            padding: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <div style="
              width: 12px;
              height: 12px;
              border-radius: 50%;
              flex-shrink: 0;
              background-color: ${color};
            "></div>
            <div style="flex: 1; font-size: 12px; color: var(--text-primary);">${this.escapeHTML(extension.name)}</div>
            <div style="font-size: 11px; color: var(--text-primary); opacity: 0.7;">${extension.blocks.length}</div>
          </div>
        `;
        })
        .join('');
    }

    // 分析项目
    async analyzeProject() {
      try {
        // 直接读取 VM 运行时中的积木，避免 toJSON 压缩变量/列表读取积木
        const projectData = this.getLiveProjectData();

        // 执行分析
        const analysis = this.performAnalysis(projectData);

        // 更新UI
        this.updateAnalysisResults(analysis, projectData);
      } catch (error) {
        console.error(msg('analysis-error'), error);
        document.getElementById('saAnalyzeLoading').innerHTML = `
          <p style="color: #d32f2f;">${msg('analysis-error')}</p>
        `;
      }
    }

    // 执行分析
    performAnalysis(projectData) {
      const analysis = {
        totalBlocks: 0,
        codeTypes: {},
        extensions: [],
        sprites: 0,
        stageInfo: {},
        editorPlatform: 'Scratch',
        effectiveBlocks: 0,
        functionDefinitions: 0,
        projectSize: 0,
        costumesSize: 0,
        soundsSize: 0,
        costumeCount: 0,
        soundCount: 0,
        variableCount: 0,
        listCount: 0
      };

      // 分析扩展
      this.analyzeExtensions(analysis, projectData);

      // 创建扩展名称映射
      const extensionNameMap = {};
      analysis.extensions.forEach((ext) => {
        extensionNameMap[ext.id] = ext.name;
      });

      // 分析代码块
      this.analyzeBlocks(analysis, projectData, extensionNameMap);

      // 分析精灵和舞台
      this.analyzeSprites(analysis, projectData);

      // 分析有效积木和函数定义
      this.analyzeEffectiveBlocks(analysis, projectData);

      return analysis;
    }

    // 分析代码块
    analyzeBlocks(analysis, projectData, extensionNameMap = {}) {
      const targets = projectData.targets || [];

      targets.forEach((target) => {
        const blocks = target.blocks || {};

        Object.values(blocks).forEach((block) => {
          if (block.opcode && !block.shadow) {
            analysis.totalBlocks++;

            const category = this.getBlockCategory(block.opcode, extensionNameMap);
            analysis.codeTypes[category] = (analysis.codeTypes[category] || 0) + 1;
          }
        });
      });
    }

    // 获取积木类型
    getBlockCategory(opcode, extensionNameMap = {}) {
      if (opcode.startsWith('motion_')) return msg('motion');
      if (opcode.startsWith('looks_')) return msg('looks');
      if (opcode.startsWith('sound_')) return msg('sound');
      if (opcode.startsWith('event_')) return msg('events');
      if (opcode.startsWith('control_')) return msg('control');
      if (opcode.startsWith('sensing_')) return msg('sensing');
      if (opcode.startsWith('operator_')) return msg('operators');
      if (opcode.startsWith('data_')) return msg('data');
      if (opcode.startsWith('video_')) return msg('video');

      // 自定义函数和参数
      if (opcode.startsWith('procedures_')) return msg('custom-functions');
      if (opcode.startsWith('argument_')) return msg('custom-functions');

      // 扩展积木处理
      if (!this.isStandardBlock(opcode)) {
        const extensionId = this.getExtensionIdFromOpcode(opcode);
        // 优先使用解析的中文名称
        if (extensionNameMap[extensionId]) {
          return extensionNameMap[extensionId];
        }
        // 回退到默认名称
        return this.getExtensionNameFromId(extensionId);
      }

      return msg('other');
    }

    // 检查是否为标准积木
    isStandardBlock(opcode) {
      const standardCategories = [
        'motion_',
        'looks_',
        'sound_',
        'event_',
        'control_',
        'sensing_',
        'operator_',
        'data_',
        'video_',
        'procedures_',
        'argument_'
      ];

      return standardCategories.some((category) => opcode.startsWith(category));
    }

    // 从积木操作码提取扩展ID
    getExtensionIdFromOpcode(opcode) {
      const underscoreIndex = opcode.indexOf('_');
      if (underscoreIndex > 0) {
        return opcode.substring(0, underscoreIndex);
      }
      return opcode;
    }

    // 从扩展ID获取扩展名称
    getExtensionNameFromId(extensionId) {
      const defaultExtensionNames = {
        music: 'Music',
        pen: 'Pen',
        videoSensing: 'Video Sensing',
        text2speech: 'Text to Speech',
        translate: 'Translate',
        makeymakey: 'Makey Makey',
        microbit: 'micro:bit',
        ev3: 'LEGO EV3',
        wedo2: 'LEGO WeDo 2.0',
        boost: 'LEGO BOOST'
      };

      return defaultExtensionNames[extensionId] || extensionId;
    }

    // 分析扩展
    analyzeExtensions(analysis, projectData) {
      const extensionURLs = projectData.extensionURLs || {};

      // 获取所有扩展积木操作码
      const extensionBlocks = this.getExtensionBlocks(projectData);
      const extensionIds = new Set();

      extensionBlocks.forEach((block) => {
        extensionIds.add(block.extensionId);
      });

      // 分析扩展信息
      extensionIds.forEach((ext) => {
        const categoryInfo = this.getExtensionCategoryInfo(ext);
        const categoryName = categoryInfo && typeof categoryInfo.name === 'string' ? categoryInfo.name : null;

        const extensionInfo = {
          id: ext,
          name: categoryName || this.getExtensionNameFromId(ext),
          color: this.getSafeColor(categoryInfo && categoryInfo.color1),
          url: extensionURLs[ext] || null,
          blocks: extensionBlocks.filter((block) => block.extensionId === ext)
        };

        analysis.extensions.push(extensionInfo);
      });
    }

    // 获取扩展积木
    getExtensionBlocks(projectData) {
      const extensionBlocks = [];
      const targets = projectData.targets || [];

      targets.forEach((target) => {
        const blocks = target.blocks || {};
        Object.values(blocks).forEach((block) => {
          if (block.opcode && !block.shadow && !this.isStandardBlock(block.opcode)) {
            const extensionId = this.getExtensionIdFromOpcode(block.opcode);
            extensionBlocks.push({
              opcode: block.opcode,
              extensionId: extensionId
            });
          }
        });
      });

      return extensionBlocks;
    }

    // 分析精灵和舞台
    analyzeSprites(analysis, projectData) {
      const targets = projectData.targets || [];
      const sprites = targets.filter((t) => !t.isStage);

      analysis.sprites = sprites.length;

      // 统计造型、声音、变量和列表
      targets.forEach((target) => {
        if (target.costumes) {
          analysis.costumeCount += target.costumes.length;
        }
        if (target.sounds) {
          analysis.soundCount += target.sounds.length;
        }

        // live VM 中变量和列表都存放在 target.variables，通过 type 区分
        Object.values(target.variables || {}).forEach((variable) => {
          if (variable.type === VARIABLE_TYPE_LIST) {
            analysis.listCount++;
          } else if (variable.type !== VARIABLE_TYPE_BROADCAST) {
            analysis.variableCount++;
          }
        });
      });
    }

    // 分析有效积木和函数定义
    analyzeEffectiveBlocks(analysis, projectData) {
      const targets = projectData.targets || [];
      // 获取 vm 对象
      const vm = addon.tab.traps.vm;

      targets.forEach((target) => {
        const blocks = target.blocks || {};
        const visited = new Set();

        // 统计函数定义
        Object.values(blocks).forEach((block) => {
          if (!block.opcode || block.shadow) return;
          if (block.opcode === 'procedures_definition') {
            analysis.functionDefinitions++;
          }
        });

        // 有效积木只统计挂在头代码下的脚本：
        // 帽子积木或自定义积木定义。独立积木堆和孤立积木不计入。
        const isScriptRoot = (block) => {
          if (!block || !block.opcode || block.shadow || !block.topLevel) return false;
          return vm.runtime.getIsHat(block.opcode) || block.opcode === 'procedures_definition';
        };

        // 统计每个头代码脚本下的有效积木
        Object.values(blocks).forEach((block) => {
          if (!isScriptRoot(block)) return;
          this.traverseBlockStack(blocks, block, analysis, visited);
        });
      });
    }

    // 遍历代码栈，包括子栈（迭代实现）
    traverseBlockStack(blocks, block, analysis, visited = new Set()) {
      if (!block) return;

      const stack = [block];

      while (stack.length > 0) {
        const currentBlock = stack.pop();
        if (!currentBlock || currentBlock.shadow) continue;
        if (currentBlock.id && visited.has(currentBlock.id)) continue;
        if (currentBlock.id) visited.add(currentBlock.id);

        // 计数当前积木（非阴影）
        analysis.effectiveBlocks++;

        // 处理下一个积木（先入栈，后处理）
        if (currentBlock.next && blocks[currentBlock.next]) {
          stack.push(blocks[currentBlock.next]);
        }

        // 处理子栈（如循环体、条件语句等）
        Object.values(currentBlock.inputs || {}).forEach((input) => {
          if (input && input.block && blocks[input.block]) {
            stack.push(blocks[input.block]);
          }
        });
      }
    }

    // 收集评分上下文：只从帽子积木或自定义积木定义开始，
    // 沿 next 和 inputs 遍历，独立积木堆不参与评分。
    getScoringContext(projectData) {
      const targets = projectData.targets || [];
      const scripts = [];
      const blocks = [];

      targets.forEach((target) => {
        const targetBlocks = target.blocks || {};

        Object.values(targetBlocks).forEach((root) => {
          if (!root || !root.opcode || root.shadow || !root.topLevel) return;

          const isDefinition = root.opcode === 'procedures_definition';
          if (!isDefinition && !vm.runtime.getIsHat(root.opcode)) return;

          const scriptBlocks = [];
          const visited = new Set();
          const stack = [{ block: root, controlDepth: 0 }];
          let maxControlDepth = 0;

          while (stack.length > 0) {
            const { block, controlDepth } = stack.pop();
            if (!block || block.shadow) continue;
            if (block.id && visited.has(block.id)) continue;
            if (block.id) visited.add(block.id);

            scriptBlocks.push(block);
            blocks.push(block);

            if (this.isStructuralControl(block.opcode)) {
              maxControlDepth = Math.max(maxControlDepth, controlDepth + 1);
            }

            if (block.next && targetBlocks[block.next]) {
              stack.push({ block: targetBlocks[block.next], controlDepth });
            }

            Object.entries(block.inputs || {}).forEach(([inputName, input]) => {
              if (!input || !input.block) return;
              const child = targetBlocks[input.block];
              if (!child) return;

              const isSubstack = inputName === 'SUBSTACK' || inputName === 'SUBSTACK2';
              const childDepth = isSubstack && this.isStructuralControl(block.opcode) ? controlDepth + 1 : controlDepth;
              stack.push({ block: child, controlDepth: childDepth });
            });
          }

          scripts.push({
            target,
            root,
            startOpcode: root.opcode,
            blocks: scriptBlocks,
            maxControlDepth
          });
        });
      });

      return { targets, scripts, blocks };
    }

    isStructuralControl(opcode) {
      return STRUCTURAL_CONTROL_OPCODES.has(opcode);
    }

    getBlockFieldValue(block, fieldName) {
      const field = block && block.fields && block.fields[fieldName];
      return field ? field.value : null;
    }

    // live VM 的变量/列表字段把 id 放在 field.id，旧格式可能把 [name, id] 放在 value。
    getFieldId(block, fieldName) {
      const field = block && block.fields && block.fields[fieldName];
      if (!field) return null;
      if (field.id) return field.id;
      if (Array.isArray(field.value)) return field.value[1] || null;
      return null;
    }

    getInputFieldValue(block, blocks, inputName, fieldName) {
      const input = block && block.inputs && block.inputs[inputName];
      if (!input || !input.block) return null;

      const inputBlock = blocks[input.block];
      if (!inputBlock) return null;

      return this.getBlockFieldValue(inputBlock, fieldName);
    }

    hasDuplicateScriptStart(scripts, startOpcode, getKey) {
      const seen = new Set();

      for (const script of scripts) {
        if (script.startOpcode !== startOpcode || script.blocks.length <= 1) continue;

        const key = getKey(script);
        if (key === null || key === undefined || key === '') continue;

        const normalizedKey = String(key).trim().toLowerCase();
        if (seen.has(normalizedKey)) return true;
        seen.add(normalizedKey);
      }

      return false;
    }

    // 一次构建评分上下文，供 Dr.Scratch 和数学逻辑评分共用。
    calculateScores(projectData) {
      const scoringContext = this.getScoringContext(projectData);
      return {
        drScratchScores: this.calculateDrScratchScores(projectData, scoringContext),
        mathLogicScores: this.calculateMathLogicScores(projectData, scoringContext)
      };
    }

    // 计算Dr.Scratch评分
    calculateDrScratchScores(projectData, scoringContext = null) {
      const scores = {
        [msg('abstraction')]: 0,
        [msg('parallelism')]: 0,
        [msg('logic')]: 0,
        [msg('synchronization')]: 0,
        [msg('flow-control')]: 0,
        [msg('user-interactivity')]: 0,
        [msg('data-representation')]: 0
      };

      const context = scoringContext || this.getScoringContext(projectData);
      const opcodeCounts = new Map();

      context.blocks.forEach((block) => {
        opcodeCounts.set(block.opcode, (opcodeCounts.get(block.opcode) || 0) + 1);
      });

      const hasOpcode = (opcode) => opcodeCounts.has(opcode);
      const hasAnyOpcode = (opcodes) => opcodes.some((opcode) => hasOpcode(opcode));

      // 1. 抽象和问题分解：克隆 > 自定义积木 > 多个脚本
      if (hasOpcode('control_start_as_clone')) {
        scores[msg('abstraction')] = 3;
      } else if (hasOpcode('procedures_definition')) {
        scores[msg('abstraction')] = 2;
      } else if (context.scripts.length > 1) {
        scores[msg('abstraction')] = 1;
      }

      // 2. 并行性：同一消息/背景/传感器事件的两个脚本 > 同一按键或同一角色两个点击脚本 > 两个绿旗脚本
      const hasDuplicateMessage = this.hasDuplicateScriptStart(
        context.scripts,
        'event_whenbroadcastreceived',
        (script) => this.getBlockFieldValue(script.root, 'BROADCAST_OPTION')
      );
      const hasDuplicateBackdrop = this.hasDuplicateScriptStart(
        context.scripts,
        'event_whenbackdropswitchesto',
        (script) => this.getBlockFieldValue(script.root, 'BACKDROP')
      );
      const hasDuplicateMultimedia = this.hasDuplicateScriptStart(
        context.scripts,
        'event_whengreaterthan',
        (script) => {
          const menu = this.getBlockFieldValue(script.root, 'WHENGREATERTHANMENU');
          if (menu === null || menu === undefined) return null;
          const value = this.getInputFieldValue(script.root, script.target.blocks, 'VALUE', 'NUM');
          return value === null || value === undefined ? null : `${menu}:${value}`;
        }
      );
      const hasDuplicateKey = this.hasDuplicateScriptStart(context.scripts, 'event_whenkeypressed', (script) =>
        this.getBlockFieldValue(script.root, 'KEY_OPTION')
      );

      const clickedCounts = new Map();
      context.scripts.forEach((script) => {
        if (script.startOpcode === 'event_whenthisspriteclicked' && script.blocks.length > 1) {
          clickedCounts.set(script.target, (clickedCounts.get(script.target) || 0) + 1);
        }
      });
      const hasTwoClickedScripts = Array.from(clickedCounts.values()).some((count) => count > 1);
      const greenFlagScripts = context.scripts.filter(
        (script) => script.startOpcode === 'event_whenflagclicked' && script.blocks.length > 1
      ).length;

      if (hasDuplicateMessage || hasDuplicateBackdrop || hasDuplicateMultimedia) {
        scores[msg('parallelism')] = 3;
      } else if (hasDuplicateKey || hasTwoClickedScripts) {
        scores[msg('parallelism')] = 2;
      } else if (greenFlagScripts > 1) {
        scores[msg('parallelism')] = 1;
      }

      // 3. 逻辑思维：逻辑运算 > if-else > if
      if (hasAnyOpcode(['operator_and', 'operator_or', 'operator_not'])) {
        scores[msg('logic')] = 3;
      } else if (hasOpcode('control_if_else')) {
        scores[msg('logic')] = 2;
      } else if (hasOpcode('control_if')) {
        scores[msg('logic')] = 1;
      }

      // 4. 同步：wait until / 背景切换事件 / broadcast and wait > broadcast / receive / stop > wait
      if (hasAnyOpcode(['control_wait_until', 'event_whenbackdropswitchesto', 'event_broadcastandwait'])) {
        scores[msg('synchronization')] = 3;
      } else if (hasAnyOpcode(['event_broadcast', 'event_whenbroadcastreceived', 'control_stop'])) {
        scores[msg('synchronization')] = 2;
      } else if (hasOpcode('control_wait')) {
        scores[msg('synchronization')] = 1;
      }

      // 5. 流程控制：repeat until > repeat / forever > 任意多积木脚本
      if (hasAnyOpcode(['control_repeat_until', 'control_while'])) {
        scores[msg('flow-control')] = 3;
      } else if (hasAnyOpcode(['control_repeat', 'control_forever', 'control_for_each'])) {
        scores[msg('flow-control')] = 2;
      } else if (context.scripts.some((script) => script.blocks.length > 1)) {
        scores[msg('flow-control')] = 1;
      }

      // 6. 用户交互：视频/响度/传感器 > 按键/点击/鼠标/询问 > 绿旗
      const hasVideo = context.blocks.some(
        (block) => block.opcode.startsWith('videoSensing_') || block.opcode.startsWith('video_')
      );
      const hasLoudness = hasOpcode('sensing_loudness');
      const hasMousePointer = context.scripts.some((script) =>
        script.blocks.some((block) => {
          if (block.opcode === 'motion_goto') {
            return this.getInputFieldValue(block, script.target.blocks, 'TO', 'TO') === '_mouse_';
          }
          if (block.opcode === 'sensing_touchingobject') {
            return (
              this.getInputFieldValue(block, script.target.blocks, 'TOUCHINGOBJECTMENU', 'TOUCHINGOBJECTMENU') ===
              '_mouse_'
            );
          }
          return false;
        })
      );

      if (hasOpcode('event_whengreaterthan') || hasVideo || hasLoudness) {
        scores[msg('user-interactivity')] = 3;
      } else if (
        hasAnyOpcode([
          'event_whenkeypressed',
          'event_whenthisspriteclicked',
          'sensing_mousedown',
          'sensing_keypressed',
          'sensing_askandwait',
          'sensing_answer'
        ]) ||
        hasMousePointer
      ) {
        scores[msg('user-interactivity')] = 2;
      } else if (hasOpcode('event_whenflagclicked')) {
        scores[msg('user-interactivity')] = 1;
      }

      // 7. 数据表示：列表操作 > 变量赋值/改变 > 角色属性变化
      if (context.blocks.some((block) => LIST_OPCODES.has(block.opcode))) {
        scores[msg('data-representation')] = 3;
      } else if (hasAnyOpcode(['data_setvariableto', 'data_changevariableby'])) {
        scores[msg('data-representation')] = 2;
      } else if (context.blocks.some((block) => SPRITE_MODIFIER_OPCODES.has(block.opcode))) {
        scores[msg('data-representation')] = 1;
      }

      return scores;
    }

    // 计算数学逻辑评分：三个维度各 0-3 分，总分 9 分。
    // 1. 运算复杂度：算术、比较、布尔、字符串、数学函数、随机数的数量与多样性。
    // 2. 逻辑深度：条件/循环的数量与嵌套深度。
    // 3. 数据量级：有效脚本中实际引用的变量、列表和数据操作的数量与多样性。
    calculateMathLogicScores(projectData, scoringContext = null) {
      const context = scoringContext || this.getScoringContext(projectData);
      const operatorBlocks = context.blocks.filter((block) => block.opcode.startsWith('operator_'));
      const operatorCount = operatorBlocks.length;
      const operatorTypes = new Set(operatorBlocks.map((block) => block.opcode));

      const hasArithmetic = ['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide'].some(
        (opcode) => operatorTypes.has(opcode)
      );
      const hasComparison = ['operator_lt', 'operator_gt', 'operator_equals'].some((opcode) =>
        operatorTypes.has(opcode)
      );
      const hasBoolean = ['operator_and', 'operator_or', 'operator_not'].some((opcode) => operatorTypes.has(opcode));
      const hasString = ['operator_join', 'operator_letter_of', 'operator_length', 'operator_contains'].some((opcode) =>
        operatorTypes.has(opcode)
      );
      const hasMathop = operatorTypes.has('operator_mathop');
      const hasRandom = operatorTypes.has('operator_random');
      const mathopOperators = new Set(
        operatorBlocks
          .filter((block) => block.opcode === 'operator_mathop')
          .map((block) => String(this.getBlockFieldValue(block, 'OPERATOR') || '').toLowerCase())
      );
      const hasAdvancedMath = Array.from(mathopOperators).some((operator) => ADVANCED_MATH_OPERATORS.has(operator));
      const categoryCount = [hasArithmetic, hasComparison, hasBoolean, hasString, hasMathop, hasRandom].filter(
        Boolean
      ).length;

      let operationScore = 0;
      if (operatorCount > 0) {
        operationScore = 1;
        if (hasAdvancedMath || (operatorCount >= 4 && categoryCount >= 2) || operatorCount >= 6) {
          operationScore = 2;
        }
        if (
          (hasAdvancedMath && operatorCount >= 5 && categoryCount >= 2) ||
          (hasBoolean && operatorCount >= 6 && categoryCount >= 3) ||
          operatorCount >= 10
        ) {
          operationScore = 3;
        }
      }

      const structuralBlocks = context.blocks.filter((block) => STRUCTURAL_CONTROL_OPCODES.has(block.opcode));
      const structuralCount = structuralBlocks.length;
      const maxControlDepth = context.scripts.reduce((max, script) => Math.max(max, script.maxControlDepth), 0);
      const hasConditional = structuralBlocks.some(
        (block) => block.opcode === 'control_if' || block.opcode === 'control_if_else'
      );
      const hasLoop = structuralBlocks.some((block) =>
        ['control_repeat', 'control_forever', 'control_repeat_until', 'control_while', 'control_for_each'].includes(
          block.opcode
        )
      );

      let logicScore = 0;
      if (structuralCount > 0) {
        logicScore = 1;
        if (structuralCount >= 2 || maxControlDepth >= 2 || (hasConditional && hasLoop)) {
          logicScore = 2;
        }
        if (
          maxControlDepth >= 3 ||
          (hasConditional && hasLoop && hasBoolean) ||
          (structuralCount >= 5 && maxControlDepth >= 2)
        ) {
          logicScore = 3;
        }
      }

      const dataBlocks = context.blocks.filter((block) => block.opcode.startsWith('data_'));
      // 只统计有效脚本中实际引用的变量/列表；空项目的默认变量不计入数据量级。
      const usedVariableIds = new Set();
      const usedListIds = new Set();
      dataBlocks.forEach((block) => {
        const variableId = this.getFieldId(block, 'VARIABLE');
        if (variableId) usedVariableIds.add(variableId);
        const listId = this.getFieldId(block, 'LIST');
        if (listId) usedListIds.add(listId);
      });
      const structureCount = usedVariableIds.size + usedListIds.size;
      const listOperations = dataBlocks.filter((block) => LIST_OPCODES.has(block.opcode));
      const distinctListOperations = new Set(listOperations.map((block) => block.opcode)).size;
      const variableMutations = dataBlocks.filter(
        (block) => block.opcode === 'data_setvariableto' || block.opcode === 'data_changevariableby'
      ).length;

      let dataScore = 0;
      if (dataBlocks.length > 0) {
        dataScore = 1;
      }
      if (structureCount >= 2 || variableMutations > 0 || listOperations.length > 0 || dataBlocks.length >= 3) {
        dataScore = 2;
      }
      if (
        (usedListIds.size > 0 && listOperations.length >= 2 && distinctListOperations >= 2) ||
        (structureCount >= 4 && (variableMutations > 0 || listOperations.length > 0)) ||
        (dataBlocks.length >= 8 && (variableMutations > 0 || listOperations.length > 0))
      ) {
        dataScore = 3;
      }

      return {
        [msg('operation-complexity')]: operationScore,
        [msg('logic-depth')]: logicScore,
        [msg('data-magnitude')]: dataScore
      };
    }

    // Dr.Scratch 官方等级：0-7 Basic，8-14 Developing，15-21 Proficiency。
    getDrScratchLevel(totalScore) {
      if (totalScore >= 15) return msg('proficient');
      if (totalScore >= 8) return msg('developing');
      return msg('basic');
    }

    // 数学逻辑总分 0-9，按三个维度的平均分划分等级。
    getMathLogicLevel(totalScore) {
      if (totalScore >= 7) return msg('proficient');
      if (totalScore >= 4) return msg('developing');
      return msg('basic');
    }

    // 格式化文件大小
    formatFileSize(bytes) {
      if (bytes === 0) return '0 B';

      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));

      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // 生成分析结果HTML
    generateAnalysisHTML() {
      return `
        <div class="sa-analyze-modal-body">
          <!-- 项目统计部分 -->
          <div class="sa-analyze-section">
            <h3 class="sa-analyze-section-title">${msg('project-stats')}</h3>
            <div class="sa-analyze-stats-grid" id="saStatsGrid">
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('total-blocks')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('effective-blocks')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('function-definitions')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('stat-sprites')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('stat-costumes')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('stat-sounds')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('stat-variables')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('stat-lists')}</div>
              </div>
              <div class="sa-analyze-stat">
                <div class="sa-analyze-stat-value">-</div>
                <div class="sa-analyze-stat-label">${msg('extensions')}</div>
              </div>
            </div>
          </div>

          <!-- 代码类型分布 -->
          <div class="sa-analyze-section">
            <h3 class="sa-analyze-section-title">${msg('block-distribution')}</h3>
            <div class="sa-analyze-chart-container">
              <canvas id="saCodeTypeChart" width="400" height="200"></canvas>
            </div>
          </div>

          <!-- Dr.Scratch评分系统 -->
          <div class="sa-analyze-section">
            <h3 class="sa-analyze-section-title">${msg('dr-scratch-score')}</h3>
            <div class="sa-analyze-row">
              <div class="sa-analyze-col-6">
                <div class="sa-analyze-chart-container">
                  <canvas id="saDrScratchChart" width="400" height="300"></canvas>
                </div>
              </div>
              <div class="sa-analyze-col-6">
                <div class="sa-analyze-score-details" id="saDrScratchDetails">
                  <div class="sa-analyze-score-summary">
                    <h4>${msg('total-score')}：<span id="saDrScratchTotalScore">0</span> / 21</h4>
                    <div class="sa-analyze-score-level" id="saDrScratchScoreLevel">${msg('evaluation-level')}：${msg('calculating')}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 核心数学能力评估 -->
          <div class="sa-analyze-section">
            <h3 class="sa-analyze-section-title">${msg('math-logic-assessment')}</h3>
            <p style="margin: 0 0 12px 0; font-size: 12px; color: var(--text-primary); opacity: 0.65;">${msg('math-logic-help')}</p>
            <div class="sa-analyze-row">
              <div class="sa-analyze-col-6">
                <div class="sa-analyze-chart-container">
                  <canvas id="saMathLogicChart" width="400" height="300"></canvas>
                </div>
              </div>
              <div class="sa-analyze-col-6">
                <div class="sa-analyze-score-details" id="saMathLogicDetails">
                  <div class="sa-analyze-score-summary">
                    <h4>${msg('math-total-score')}：<span id="saMathTotalScore">0</span> / 9</h4>
                    <div class="sa-analyze-score-level" id="saMathScoreLevel">${msg('evaluation-level')}：${msg('calculating')}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 使用的扩展 -->
          <div class="sa-analyze-section">
            <h3 class="sa-analyze-section-title">${msg('extensions-used')}</h3>
            <div class="sa-analyze-extension-list" id="saExtensionList">
              <p>${msg('loading')}</p>
            </div>
          </div>
        </div>
      `;
    }

    // 更新分析结果
    updateAnalysisResults(analysis, projectData) {
      // 更新统计数据
      this.updateStats(analysis);

      // 更新代码类型分布图
      this.displayCodeTypeChart(analysis);

      // 计算并更新评分
      const { drScratchScores, mathLogicScores } = this.calculateScores(projectData);
      this.displayDrScratchScores(drScratchScores);
      this.displayMathLogicScores(mathLogicScores);

      // 更新扩展列表
      this.displayExtensions(analysis.extensions);

      // 显示结果，隐藏加载
      document.getElementById('saAnalyzeLoading').style.display = 'none';
      document.getElementById('saAnalyzeResults').style.display = 'block';
    }

    // 更新统计数据
    updateStats(analysis) {
      const statsGrid = document.getElementById('saStatsGrid');

      statsGrid.innerHTML = `
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.totalBlocks}</div>
          <div class="sa-analyze-stat-label">${msg('total-blocks')}</div>
        </div>
        <div class="sa-analyze-stat" title="${this.getEffectiveBlocksHelp()}">
          <div class="sa-analyze-stat-value">${analysis.effectiveBlocks}</div>
          <div class="sa-analyze-stat-label">${msg('effective-blocks')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.functionDefinitions}</div>
          <div class="sa-analyze-stat-label">${msg('function-definitions')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.sprites}</div>
          <div class="sa-analyze-stat-label">${msg('stat-sprites')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.costumeCount}</div>
          <div class="sa-analyze-stat-label">${msg('stat-costumes')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.soundCount}</div>
          <div class="sa-analyze-stat-label">${msg('stat-sounds')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.variableCount}</div>
          <div class="sa-analyze-stat-label">${msg('stat-variables')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.listCount}</div>
          <div class="sa-analyze-stat-label">${msg('stat-lists')}</div>
        </div>
        <div class="sa-analyze-stat">
          <div class="sa-analyze-stat-value">${analysis.extensions.length}</div>
          <div class="sa-analyze-stat-label">${msg('extensions')}</div>
        </div>
      `;
    }

    // 显示代码类型分布图
    displayCodeTypeChart(analysis) {
      const canvas = document.getElementById('saCodeTypeChart');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');

      // 定义标准类别的固定顺序
      const standardOrder = [
        msg('motion'),
        msg('looks'),
        msg('sound'),
        msg('events'),
        msg('control'),
        msg('sensing'),
        msg('operators'),
        msg('data'),
        msg('custom-functions')
      ];

      // 分离标准和扩展类别
      const standardCategories = {};
      const extensionCategories = {};

      Object.keys(analysis.codeTypes).forEach((category) => {
        if (standardOrder.includes(category)) {
          standardCategories[category] = analysis.codeTypes[category];
        } else {
          extensionCategories[category] = analysis.codeTypes[category];
        }
      });

      // 按固定顺序排列标准类别
      const orderedStandard = {};
      standardOrder.forEach((category) => {
        if (standardCategories[category]) {
          orderedStandard[category] = standardCategories[category];
        }
      });

      // 按字母顺序排序扩展类别
      const sortedExtensions = {};
      Object.keys(extensionCategories)
        .sort()
        .forEach((category) => {
          sortedExtensions[category] = extensionCategories[category];
        });

      // 合并排序后的数据
      const sortedCodeTypes = { ...orderedStandard, ...sortedExtensions };
      const sortedLabels = Object.keys(sortedCodeTypes);
      const sortedData = Object.values(sortedCodeTypes);

      // 定义每个类别的颜色
      const categoryColors = {
        [msg('motion')]: '#4C97FF',
        [msg('looks')]: '#9966FF',
        [msg('sound')]: '#CF63CF',
        [msg('events')]: '#FFBF00',
        [msg('control')]: '#FFAB19',
        [msg('sensing')]: '#5CB1D6',
        [msg('operators')]: '#59C059',
        [msg('data')]: '#FF8C1A',
        [msg('custom-functions')]: '#FF6680'
      };

      // 为扩展生成默认颜色
      const extensionColors = [
        '#3498DB',
        '#E74C3C',
        '#F39C12',
        '#27AE60',
        '#16A085',
        '#2ECC71',
        '#E67E22',
        '#95A5A6',
        '#34495E',
        '#7F8C8D',
        '#9B59B6',
        '#1ABC9C',
        '#2C3E50',
        '#F1C40F',
        '#D35400',
        '#C0392B',
        '#BDC3C7',
        '#7F8C8D',
        '#95A5A6'
      ];

      // 为每个标签分配对应颜色
      const assignedColors = sortedLabels.map((label, index) => {
        if (categoryColors[label]) {
          return categoryColors[label];
        }
        // 检查是否是具有自定义颜色的扩展
        const extension = analysis.extensions.find((ext) => ext.name === label);
        if (extension && extension.color) {
          return extension.color;
        }
        // 使用预定义的扩展颜色
        return extensionColors[index % extensionColors.length];
      });

      // 销毁现有图表
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }

      // 创建新图表
      this.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: sortedLabels,
          datasets: [
            {
              data: sortedData,
              backgroundColor: assignedColors
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                padding: 10,
                font: {
                  size: 11
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || '';
                  const value = context.raw || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((value / total) * 100).toFixed(1);
                  return `${label}: ${value} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    }

    // 显示Dr.Scratch评分
    displayDrScratchScores(scores) {
      const canvas = document.getElementById('saDrScratchChart');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');

      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 更新总分
      document.getElementById('saDrScratchTotalScore').textContent = totalScore;

      // 计算等级
      const level = this.getDrScratchLevel(totalScore);
      document.getElementById('saDrScratchScoreLevel').textContent = `${msg('evaluation-level')}：${level}`;

      // 更新评分详情
      const detailsHTML = labels
        .map(
          (label) => `
        <div class="sa-analyze-score-item">
          <div class="sa-analyze-score-label">${label}</div>
          <div class="sa-analyze-score-bar">
            <div class="sa-analyze-score-fill" style="width: ${(scores[label] / 3) * 100}%"></div>
          </div>
          <div class="sa-analyze-score-value">${scores[label]}/3</div>
        </div>
      `
        )
        .join('');

      const detailsContainer = document.getElementById('saDrScratchDetails');
      const summaryHTML = detailsContainer.querySelector('.sa-analyze-score-summary').outerHTML;
      detailsContainer.innerHTML = summaryHTML + detailsHTML;

      // 销毁现有图表
      if (this.drScratchChartInstance) {
        this.drScratchChartInstance.destroy();
        this.drScratchChartInstance = null;
      }

      // 创建雷达图
      this.drScratchChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [
            {
              label: msg('computational-thinking-score'),
              data: data,
              backgroundColor: 'rgba(77, 151, 255, 0.2)',
              borderColor: '#4d97ff',
              borderWidth: 2,
              pointBackgroundColor: '#4d97ff',
              pointBorderColor: '#fff',
              pointHoverBackgroundColor: '#fff',
              pointHoverBorderColor: '#4d97ff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              max: 3,
              ticks: {
                stepSize: 1
              }
            }
          },
          plugins: {
            legend: {
              display: false
            }
          }
        }
      });
    }

    // 显示数学逻辑评分
    displayMathLogicScores(scores) {
      const canvas = document.getElementById('saMathLogicChart');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');

      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 更新总分
      document.getElementById('saMathTotalScore').textContent = totalScore;

      // 计算等级
      const level = this.getMathLogicLevel(totalScore);
      document.getElementById('saMathScoreLevel').textContent = `${msg('evaluation-level')}：${level}`;

      // 更新评分详情
      const detailsHTML = labels
        .map(
          (label) => `
        <div class="sa-analyze-score-item">
          <div class="sa-analyze-score-label">${label}</div>
          <div class="sa-analyze-score-bar">
            <div class="sa-analyze-score-fill" style="width: ${(scores[label] / 3) * 100}%"></div>
          </div>
          <div class="sa-analyze-score-value">${scores[label]}/3</div>
        </div>
      `
        )
        .join('');

      const detailsContainer = document.getElementById('saMathLogicDetails');
      const summaryHTML = detailsContainer.querySelector('.sa-analyze-score-summary').outerHTML;
      detailsContainer.innerHTML = summaryHTML + detailsHTML;

      // 销毁现有图表
      if (this.mathLogicChartInstance) {
        this.mathLogicChartInstance.destroy();
        this.mathLogicChartInstance = null;
      }

      // 创建雷达图
      this.mathLogicChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [
            {
              label: msg('math-logic-score'),
              data: data,
              backgroundColor: 'rgba(230, 81, 0, 0.2)',
              borderColor: '#E65100',
              borderWidth: 2,
              pointBackgroundColor: '#E65100',
              pointBorderColor: '#fff',
              pointHoverBackgroundColor: '#fff',
              pointHoverBorderColor: '#E65100'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              max: 3,
              ticks: {
                stepSize: 1
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || '';
                  const rawValue = data[context.dataIndex];
                  return `${label}: ${rawValue}/3`;
                }
              }
            }
          }
        }
      });
    }

    // 显示扩展列表
    displayExtensions(extensions) {
      const extensionList = document.getElementById('saExtensionList');

      if (extensions.length === 0) {
        extensionList.innerHTML = `<p>${msg('no-extensions')}</p>`;
        return;
      }

      let html = '<div class="sa-analyze-extensions-grid">';

      extensions.forEach((extension) => {
        const color = this.getSafeColor(extension.color) || '#888888';
        html += `
          <div class="sa-analyze-extension-item">
            <div class="sa-analyze-extension-color" style="background-color: ${color}"></div>
            <div class="sa-analyze-extension-name">${this.escapeHTML(extension.name)}</div>
            <div class="sa-analyze-extension-count">${extension.blocks.length} ${msg('blocks-count')}</div>
          </div>
        `;
      });

      html += '</div>';
      extensionList.innerHTML = html;
    }

    // 导出分析结果为图片
    async exportAnalysisAsImage() {
      // 获取项目数据并执行分析
      const projectData = this.getLiveProjectData();
      const analysis = this.performAnalysis(projectData);
      const { drScratchScores, mathLogicScores } = this.calculateScores(projectData);

      // 创建导出Canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 设置Canvas尺寸
      const padding = 40;
      const sectionPadding = 25;
      const topBarHeight = 60;
      const statsHeight = 200;
      const chartHeight = 280;
      const scoreSectionHeight = 320;
      const footerHeight = 40;

      const totalHeight =
        topBarHeight +
        statsHeight +
        chartHeight +
        scoreSectionHeight * 2 +
        footerHeight +
        padding * 2 +
        sectionPadding * 4;
      const width = 900;
      canvas.width = width;
      canvas.height = totalHeight;

      // 设置背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, totalHeight);

      // 绘制顶部栏
      ctx.fillStyle = '#66ccff';
      ctx.fillRect(0, 0, width, topBarHeight);

      // 绘制Logo（使用SVG路径直接绘制）
      const logoX = 20;
      const logoY = 12;
      const logoWidth = 36;
      // 将SVG坐标缩放并平移到我们需要的位置
      const scale = logoWidth / 103.42932;
      const offsetX = logoX - 188.28534 * scale;
      const offsetY = logoY - 128.35262 * scale;

      ctx.save();
      ctx.fillStyle = '#ffffff';

      // 绘制所有路径
      ctx.beginPath();
      ctx.moveTo(188.28534 * scale + offsetX, 196.60551 * scale + offsetY);
      ctx.lineTo(188.28534 * scale + offsetX, (196.60551 - 68.25289) * scale + offsetY);
      ctx.lineTo((188.28534 + 33.21101) * scale + offsetX, (196.60551 - 68.25289) * scale + offsetY);
      ctx.lineTo((188.28534 + 33.21101) * scale + offsetX, 196.60551 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(188.28534 * scale + offsetX, 196.60551 * scale + offsetY);
      ctx.lineTo(188.28534 * scale + offsetX, (196.60551 - 33.21101) * scale + offsetY);
      ctx.lineTo((188.28534 + 103.29475) * scale + offsetX, (196.60551 - 33.21101) * scale + offsetY);
      ctx.lineTo((188.28534 + 103.29475) * scale + offsetX, 196.60551 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(188.28534 * scale + offsetX, 231.64738 * scale + offsetY);
      ctx.lineTo(188.28534 * scale + offsetX, (231.64738 - 33.21101) * scale + offsetY);
      ctx.lineTo((188.28534 + 68.32016) * scale + offsetX, (231.64738 - 33.21101) * scale + offsetY);
      ctx.lineTo((188.28534 + 68.32016) * scale + offsetX, 231.64738 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(223.3945 * scale + offsetX, 161.56363 * scale + offsetY);
      ctx.lineTo(223.3945 * scale + offsetX, (161.56363 - 33.21101) * scale + offsetY);
      ctx.lineTo((223.3945 + 33.21101) * scale + offsetX, (161.56363 - 33.21101) * scale + offsetY);
      ctx.lineTo((223.3945 + 33.21101) * scale + offsetX, 161.56363 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(258.50366 * scale + offsetX, 161.56363 * scale + offsetY);
      ctx.lineTo(258.50366 * scale + offsetX, (161.56363 - 33.21101) * scale + offsetY);
      ctx.lineTo((258.50366 + 33.21101) * scale + offsetX, (161.56363 - 33.21101) * scale + offsetY);
      ctx.lineTo((258.50366 + 33.21101) * scale + offsetX, 161.56363 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(258.50366 * scale + offsetX, 231.64738 * scale + offsetY);
      ctx.lineTo(258.50366 * scale + offsetX, (231.64738 - 68.25289) * scale + offsetY);
      ctx.lineTo((258.50366 + 33.21101) * scale + offsetX, (231.64738 - 68.25289) * scale + offsetY);
      ctx.lineTo((258.50366 + 33.21101) * scale + offsetX, 231.64738 * scale + offsetY);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // 获取作品名称
      const projectName = this.projectName || '';

      // 绘制标题文本
      ctx.font = 'bold 20px Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      if (projectName) {
        ctx.fillText(msg('export-title', { name: projectName }), logoX + 50, logoY + 24);
      } else {
        ctx.fillText('Simple Project Analyser Result', logoX + 50, logoY + 24);
      }

      let y = topBarHeight + padding;

      // 绘制项目统计部分
      y = this.drawStatsSection(ctx, analysis, width, y, padding, sectionPadding);

      // 绘制代码类型分布饼图
      y = this.drawCodeTypeChart(ctx, analysis, width, y, padding, sectionPadding);

      // 绘制Dr.Scratch评分
      y = this.drawDrScratchSection(ctx, drScratchScores, width, y, padding, sectionPadding);

      // 绘制数学逻辑评分
      this.drawMathLogicSection(ctx, mathLogicScores, width, y, padding, sectionPadding);

      // 绘制底部版权信息
      ctx.font = '12px Arial, sans-serif';
      ctx.fillStyle = '#aaaaaa';
      ctx.textAlign = 'center';
      ctx.fillText('Generated by Simple Project Analyser', width / 2, totalHeight - 15);

      // 下载图片
      const link = document.createElement('a');
      link.download = `project-analysis-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    // 绘制统计部分
    drawStatsSection(ctx, analysis, width, y, padding, sectionPadding) {
      const sectionWidth = width - padding * 2;
      const sectionHeight = 200;

      // 绘制背景
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(padding, y, sectionWidth, sectionHeight, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 绘制标题
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.fillText(msg('project-stats'), padding + 20, y + 30);

      // 统计数据
      const stats = [
        {
          label: msg('total-blocks'),
          value: analysis.totalBlocks
        },
        {
          label: msg('effective-blocks'),
          value: analysis.effectiveBlocks
        },
        {
          label: msg('function-definitions'),
          value: analysis.functionDefinitions
        },
        {
          label: msg('stat-sprites'),
          value: analysis.sprites
        },
        {
          label: msg('stat-costumes'),
          value: analysis.costumeCount
        },
        {
          label: msg('stat-sounds'),
          value: analysis.soundCount
        },
        {
          label: msg('stat-variables'),
          value: analysis.variableCount
        },
        {
          label: msg('stat-lists'),
          value: analysis.listCount
        },
        {
          label: msg('extensions'),
          value: analysis.extensions.length
        }
      ];

      const cols = 3;
      const rows = 3;
      const itemWidth = (sectionWidth - 40) / cols;
      const itemHeight = (sectionHeight - 60) / rows;

      stats.forEach((stat, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const itemX = padding + 20 + col * itemWidth;
        const itemY = y + 50 + row * itemHeight;

        // 绘制数值
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.fillStyle = '#4C97FF';
        ctx.textAlign = 'center';
        ctx.fillText(stat.value.toString(), itemX + itemWidth / 2, itemY + 20);

        // 绘制标签
        ctx.font = '13px Arial, sans-serif';
        ctx.fillStyle = '#666666';
        ctx.fillText(stat.label, itemX + itemWidth / 2, itemY + 42);
      });

      return y + sectionHeight + sectionPadding;
    }

    // 绘制代码类型分布饼图
    drawCodeTypeChart(ctx, analysis, width, y, padding, sectionPadding) {
      const sectionWidth = width - padding * 2;

      // 绘制背景
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(padding, y, sectionWidth, 280, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 绘制标题
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.fillText(msg('block-distribution'), padding + 20, y + 30);

      // 饼图区域位置：左侧1/3位置
      const chartAreaWidth = sectionWidth / 3;
      const centerX = padding + chartAreaWidth / 2;
      const centerY = y + 140; // 背景高度280的垂直中心
      const radius = 80; // 减小半径以适应背景

      // 定义颜色
      const categoryColors = {
        [msg('motion')]: '#4C97FF',
        [msg('looks')]: '#9966FF',
        [msg('sound')]: '#CF63CF',
        [msg('events')]: '#FFBF00',
        [msg('control')]: '#FFAB19',
        [msg('sensing')]: '#5CB1D6',
        [msg('operators')]: '#59C059',
        [msg('data')]: '#FF8C1A',
        [msg('custom-functions')]: '#FF6680'
      };

      const extensionColors = [
        '#3498DB',
        '#E74C3C',
        '#F39C12',
        '#27AE60',
        '#16A085',
        '#2ECC71',
        '#E67E22',
        '#95A5A6',
        '#34495E',
        '#7F8C8D',
        '#9B59B6',
        '#1ABC9C',
        '#2C3E50',
        '#F1C40F',
        '#D35400'
      ];

      // 排序数据
      const standardOrder = [
        msg('motion'),
        msg('looks'),
        msg('sound'),
        msg('events'),
        msg('control'),
        msg('sensing'),
        msg('operators'),
        msg('data'),
        msg('custom-functions')
      ];

      const sortedCodeTypes = {};
      standardOrder.forEach((category) => {
        if (analysis.codeTypes[category]) {
          sortedCodeTypes[category] = analysis.codeTypes[category];
        }
      });

      Object.keys(analysis.codeTypes)
        .sort()
        .forEach((category) => {
          if (!standardOrder.includes(category)) {
            sortedCodeTypes[category] = analysis.codeTypes[category];
          }
        });

      const labels = Object.keys(sortedCodeTypes);
      const data = Object.values(sortedCodeTypes);
      const total = data.reduce((a, b) => a + b, 0);

      // 绘制饼图
      let startAngle = -Math.PI / 2;

      data.forEach((value, index) => {
        const sliceAngle = (value / total) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;
        const label = labels[index];

        // 获取颜色
        let color = categoryColors[label];
        if (!color) {
          color = extensionColors[index % extensionColors.length];
        }

        // 绘制扇形
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // 绘制边框
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        startAngle = endAngle;
      });

      // 绘制图例（3列布局，限制最大显示数量）
      const legendStartX = padding + 280;
      const legendItemWidth = 180;
      const maxItems = 21; // 最多显示21项
      const displayLabels = labels.slice(0, maxItems);
      const displayData = data.slice(0, maxItems);

      displayLabels.forEach((label, index) => {
        let color = categoryColors[label];
        if (!color) {
          color = extensionColors[index % extensionColors.length];
        }

        const row = Math.floor(index / 3);
        const col = index % 3;
        const legendX = legendStartX + col * legendItemWidth;
        const legendY = y + 50 + row * 26;

        // 绘制颜色方块
        ctx.fillStyle = color;
        ctx.fillRect(legendX, legendY, 10, 10);

        // 绘制标签和数值
        ctx.font = '11px Arial, sans-serif';
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'left';

        const displayLabel = label.length > 10 ? `${label.substring(0, 10)}...` : label;
        ctx.fillText(`${displayLabel}: ${displayData[index]}`, legendX + 14, legendY + 9);
      });

      // 如果有更多项目，显示提示
      if (labels.length > maxItems) {
        ctx.font = '11px Arial, sans-serif';
        ctx.fillStyle = '#999999';
        ctx.textAlign = 'left';
        ctx.fillText(`+${labels.length - maxItems} more...`, legendStartX, y + 50 + Math.ceil(maxItems / 3) * 26 + 10);
      }

      return y + 280 + sectionPadding;
    }

    // 绘制Dr.Scratch评分部分
    drawDrScratchSection(ctx, scores, width, y, padding, sectionPadding) {
      const sectionWidth = width - padding * 2;

      // 绘制背景
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(padding, y, sectionWidth, 320, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 绘制标题
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.fillText(msg('dr-scratch-score'), padding + 20, y + 30);

      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 计算等级
      const level = this.getDrScratchLevel(totalScore);

      // 绘制雷达图（在背景左侧1/3位置）
      this.drawRadarChart(ctx, padding + 136, y + 160, 80, labels, data, 3, '#4d97ff');

      // 绘制评分详情
      const detailsX = padding + 340;
      let detailsY = y + 60;

      // 总分
      ctx.font = 'bold 18px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.fillText(`${msg('total-score')}: ${totalScore} / 21`, detailsX, detailsY);
      detailsY += 25;

      // 等级
      ctx.font = '14px Arial, sans-serif';
      ctx.fillStyle = '#666666';
      ctx.fillText(`${msg('evaluation-level')}: ${level}`, detailsX, detailsY);
      detailsY += 35;

      // 各项评分
      labels.forEach((label, index) => {
        const score = data[index];

        // 标签
        ctx.font = '12px Arial, sans-serif';
        ctx.fillStyle = '#333333';
        const displayLabel = label.length > 14 ? `${label.substring(0, 14)}...` : label;
        ctx.fillText(displayLabel, detailsX, detailsY);

        // 进度条背景
        ctx.fillStyle = '#eeeeee';
        ctx.fillRect(detailsX + 150, detailsY - 10, 100, 12);

        // 进度条填充
        ctx.fillStyle = '#4d97ff';
        ctx.fillRect(detailsX + 150, detailsY - 10, (score / 3) * 100, 12);

        // 分数
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.fillStyle = '#333333';
        ctx.fillText(`${score}/3`, detailsX + 260, detailsY);

        detailsY += 28;
      });

      return y + 320 + sectionPadding;
    }

    // 绘制数学逻辑评分部分
    drawMathLogicSection(ctx, scores, width, y, padding, sectionPadding) {
      const sectionWidth = width - padding * 2;

      // 绘制背景
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(padding, y, sectionWidth, 320, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 绘制标题
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.fillText(msg('math-logic-assessment'), padding + 20, y + 30);

      const labels = Object.keys(scores);
      const data = Object.values(scores);
      const totalScore = data.reduce((sum, val) => sum + val, 0);

      // 计算等级
      const level = this.getMathLogicLevel(totalScore);

      // 绘制雷达图（在背景左侧1/3位置）
      this.drawRadarChart(ctx, padding + 136, y + 160, 100, labels, data, 3, '#E65100');

      // 绘制评分详情
      const detailsX = padding + 340;
      let detailsY = y + 60;

      // 总分
      ctx.font = 'bold 18px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.fillText(`${msg('math-total-score')}: ${totalScore} / 9`, detailsX, detailsY);
      detailsY += 25;

      // 等级
      ctx.font = '14px Arial, sans-serif';
      ctx.fillStyle = '#666666';
      ctx.fillText(`${msg('evaluation-level')}: ${level}`, detailsX, detailsY);
      detailsY += 35;

      // 各项评分
      labels.forEach((label, index) => {
        ctx.font = '12px Arial, sans-serif';
        ctx.fillStyle = '#333333';
        const displayLabel = label.length > 14 ? `${label.substring(0, 14)}...` : label;
        ctx.fillText(`${displayLabel}: ${data[index]}/3`, detailsX, detailsY);
        detailsY += 28;
      });

      return y + 320 + sectionPadding;
    }

    // 绘制雷达图
    drawRadarChart(ctx, centerX, centerY, radius, labels, data, maxValue, color) {
      const numSides = labels.length;
      const angleStep = (Math.PI * 2) / numSides;

      // 绘制网格
      const gridLevels = 5;
      for (let i = 1; i <= gridLevels; i++) {
        const gridRadius = (radius / gridLevels) * i;
        ctx.beginPath();
        for (let j = 0; j < numSides; j++) {
          const angle = j * angleStep - Math.PI / 2;
          const x = centerX + gridRadius * Math.cos(angle);
          const y = centerY + gridRadius * Math.sin(angle);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = '#eeeeee';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 绘制轴线
      for (let i = 0; i < numSides; i++) {
        const angle = i * angleStep - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
        ctx.strokeStyle = '#dddddd';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 绘制数据区域
      ctx.beginPath();
      data.forEach((value, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const pointRadius = (value / maxValue) * radius;
        const x = centerX + pointRadius * Math.cos(angle);
        const y = centerY + pointRadius * Math.sin(angle);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = `${color}33`; // 添加透明度
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 绘制数据点
      data.forEach((value, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const pointRadius = (value / maxValue) * radius;
        const x = centerX + pointRadius * Math.cos(angle);
        const y = centerY + pointRadius * Math.sin(angle);

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // 绘制标签
      ctx.font = '10px Arial, sans-serif';
      ctx.fillStyle = '#666666';
      ctx.textAlign = 'center';

      labels.forEach((label, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const labelRadius = radius + 15; // 减小标签半径
        const x = centerX + labelRadius * Math.cos(angle);
        const y = centerY + labelRadius * Math.sin(angle);

        const displayLabel = label.length > 8 ? `${label.substring(0, 8)}...` : label;
        ctx.fillText(displayLabel, x, y);
      });
    }

    // 绘制扩展列表部分
    drawExtensionsSection(ctx, extensions, width, y, padding) {
      const sectionWidth = width - padding * 2;
      const height = Math.max(150, extensions.length * 50 + 60);

      // 绘制背景
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(padding, y, sectionWidth, height, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 绘制标题
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.fillText(msg('extensions-used'), padding + 20, y + 30);

      if (extensions.length === 0) {
        ctx.font = '14px Arial, sans-serif';
        ctx.fillStyle = '#999999';
        ctx.fillText(msg('no-extensions'), padding + 20, y + 60);
        return;
      }

      const cols = 3;
      const itemWidth = (sectionWidth - 40) / cols;
      const itemHeight = 40;

      extensions.forEach((extension, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const itemX = padding + 20 + col * itemWidth;
        const itemY = y + 50 + row * itemHeight;

        // 绘制背景
        ctx.fillStyle = '#f8f9fa';
        ctx.beginPath();
        ctx.roundRect(itemX, itemY, itemWidth - 10, itemHeight - 8, 6);
        ctx.fill();

        // 绘制颜色圆点
        const color = this.getSafeColor(extension.color) || '#888888';
        ctx.beginPath();
        ctx.arc(itemX + 12, itemY + 16, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // 绘制名称
        ctx.font = '13px Arial, sans-serif';
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'left';
        const displayName = extension.name.length > 16 ? `${extension.name.substring(0, 16)}...` : extension.name;
        ctx.fillText(displayName, itemX + 26, itemY + 18);

        // 绘制积木数量
        ctx.font = '12px Arial, sans-serif';
        ctx.fillStyle = '#999999';
        ctx.textAlign = 'right';
        ctx.fillText(`${extension.blocks.length} ${msg('blocks-count')}`, itemX + itemWidth - 18, itemY + 18);
      });
    }
  }

  const analyzer = new SimpleProjectAnalyzer();

  // 项目变化时刷新 Sidebar（仅在分析面板打开时，1000ms 防抖）
  const scheduleSidebarRefresh = () => {
    if (!analyzer.sidebarActive) return;
    if (analyzer.refreshTimeout) clearTimeout(analyzer.refreshTimeout);
    analyzer.refreshTimeout = setTimeout(() => {
      analyzer.refreshTimeout = null;
      analyzer.analyzeProjectForSidebar();
    }, 1000);
  };

  vm.on('PROJECT_CHANGED', scheduleSidebarRefresh);
  vm.runtime.on('PROJECT_LOADED', scheduleSidebarRefresh);

  // Button injection via AddToBar (handles both VSCode and non-VSCode layouts)
  AddToBar(addon, {
    id: 'spa',
    icon: icon,
    text: msg('analyze-button'),
    getContent: () => {
      analyzer.showAnalysisSidebar();
      return analyzer.sidebarContent;
    },
    onActivate: () => {
      analyzer.sidebarActive = true;
      analyzer.analyzeProjectForSidebar();
    },
    onDeactivate: () => {
      analyzer.sidebarActive = false;
      if (analyzer.refreshTimeout) {
        clearTimeout(analyzer.refreshTimeout);
        analyzer.refreshTimeout = null;
      }
      analyzer.destroyCharts();
    },
    onClick: () => {
      analyzer.showAnalysisModal();
    }
  });

  // 禁用插件时移除监听和图表，避免重新启用后重复刷新或残留实例
  if (addon.self && typeof addon.self.addEventListener === 'function') {
    addon.self.addEventListener('disabled', () => {
      analyzer.sidebarActive = false;
      if (analyzer.refreshTimeout) {
        clearTimeout(analyzer.refreshTimeout);
        analyzer.refreshTimeout = null;
      }
      vm.off('PROJECT_CHANGED', scheduleSidebarRefresh);
      vm.runtime.off('PROJECT_LOADED', scheduleSidebarRefresh);
      ReduxStore.removeEventListener('statechanged', analyzer.onReduxStateChanged);
      analyzer.destroyCharts();
    });
  }
}
