# Astra Copilot 模块与工具参考

> 面向维护者的实现说明。语言规范见 [`scrathon.md`](./scrathon.md)（运行时注入副本由 `docs/scrathon-doc.js` 提供，改 md 后执行 `pnpm --filter scratch-gui build:scrathon-doc` 重新生成）。路线图见 [`TODO.md`](./TODO.md)。

---

## 1. 入口与生命周期

| 文件 | 作用 |
| --- | --- |
| `_manifest_entry.js` | 插件清单：`editorOnly`、标签、`dynamicDisable` |
| `_runtime_entry.js` | 运行时挂载点 |
| `userscript.js`（约 3380 行） | UI 装配、会话状态、Agent 桥、写入执行 |
| `agent.css` | 全部样式，前缀 `sa-agent-` |

生命周期：

- `enabled` → `buildChatUI()`，通过 `listen()` 注册 window/document 监听。
- `disabled` → `detachUiListeners()`、断开 `ResizeObserver`、移除 DOM。
- `reenabled` → 重新挂载并渲染当前项目会话。
- `PROJECT_LOADED` → 切换会话库（按项目 id），并校验写入上下文。

`listen()` 是一个注册表，所有全局监听必须经它注册，否则禁用插件后会残留。

---

## 2. 模块地图

### 配置与状态

| 模块 | 职责 |
| --- | --- |
| `agent/config.js` | 默认值、`normalizeConfig`、`clampNumber`、端点拼装、旧键迁移后清除 |
| `agent/conversations.js` | 按项目分组的会话存储、v1/v0 迁移、跨项目汇总 |

### Agent 内核

| 模块 | 职责 |
| --- | --- |
| `agent/client.js` | OpenAI 兼容客户端：流式解析、重试、工具调用规范化、自定义 headers |
| `agent/loop.js` | 主循环：上下文裁剪、工具分发、审批拦截、步数上限 |
| `agent/prompt.js` | 系统提示词（Plan / Build 两套，按 `writeEnabled` 切换） |
| `agent/tools.js` | 17 个工具的定义与 handler |
| `agent/trace.js` | 工具结果摘要（用于对话流展示） |

### 读写桥

| 模块 | 职责 |
| --- | --- |
| `agent/block-xml.js` | Scrathon 编译产物 → Blockly XML，变量/列表/广播声明收集 |
| `agent/script-patcher.js` | **块级原位修补**：旧块树与新 XML 对齐，命中即复用 |
| `agent/writer.js` | `setApplier` / `applyXml` 桥接（把写入请求交给 userscript） |
| `agent/project-scrathon.js` | 整项目反编译为单个 Scrathon 文档（带 scriptId 分节、字符预算） |

### Scrathon DSL

| 模块 | 职责 |
| --- | --- |
| `agent/scrathon/lexer.js` | 词法（含 `#` 注释） |
| `agent/scrathon/parser.js` | 语法 → AST |
| `agent/scrathon/compiler.js` | AST → Blockly XML / 声明 |
| `agent/scrathon/decompiler.js` | 块 → Scrathon 源码 |
| `agent/scrathon/mappings.js` | Opcode ↔ 语法映射、catalog 生成 |
| `agent/scrathon/diff.js` | 逐脚本 LCS 行级 diff |
| `agent/scrathon/window.js` | 独立 Scrathon 转换窗口 |
| `agent/scrathon/error.js` / `catalog.js` / `example.js` | 诊断、积木目录、示例 |

### UI

| 模块 | 职责 |
| --- | --- |
| `ui/diff-card.js` | Diff 卡片、文本/积木视图切换、ScratchBlocks 预览（工厂函数，依赖注入） |
| `ui/tool-trace.js` | 工具行、折叠栈、EDIT 卡片、审批按钮 |
| `ui/context-dial.js` | 对话框下方的上下文圆盘、用量弹层、思考力度滑块 |

`agent/markdown.js` 是自研安全渲染器，全程不触碰 `innerHTML`。
`agent/block-preview.js` 负责把 XML 渲染成只读积木预览。

### 对话框下方：上下文圆盘

`ui/context-dial.js` 是纯 UI 组件（接收 `msg` / `formatTokens` / 回调），不读全局状态：

- 入口是工具栏右侧、**发送按钮左边的 24px 圆形按钮**，只有一个圆环，不显示任何文字；百分比与思考力度放在 tooltip 与 `aria-label` 里。
- 圆盘用 `pathLength="100"` 让 `stroke-dashoffset` 直接等于百分比，无需三角函数。
- 颜色阈值：<60% 绿、60–85% 琥珀、>85% 红。
- 弹层内容：总量百分比、`已使用 / 窗口`、按来源分段的条形图（系统提示词 / 工具定义 / 对话消息）、思考力度滑块。- 弹层用 `position: fixed` + 打开时按 `getBoundingClientRect()` 翻转定位，因为底部面板的内容盒设了 `overflow: hidden`，绝对定位会被裁掉。
- 思考力度滑块 4 档（Default/Low/High/Max），改完立即写回 `config.reasoningEffort` 并持久化；**设置面板不再提供该项**。
- 滑块视觉：外层 `.sa-agent-dial-slider-track` 自绘 20px 胶囊轨道与填充（原生 range 的滑块会顶到两端，且无法做左右内缩），原生 input 透明叠在上层只负责滑块与拖拽，`left: 4px; width: calc(100% - 8px)` 让滑块在两端也留 4px；填充宽度 = `calc(20px + (100% - 20px) * --sa-agent-slider-value)` 且自身 `border-radius: 999px`：右端覆盖滑块（4px 内缩 + 12px 滑块）后再多出 4px，滑块被包裹在色条内，不会露出灰色底或矩形直角。
- 拖动连续性：input 内部 `step=0.01`，填充随连续位置走，档位取 `Math.round(value)`，因此拖动是平滑的而不是 4 段跳；同一档位内滑动不会重复触发 `onEffortChange`。
- 填充色随档位递进（灰 `#adb5bd` → 蓝 `#4dabf7` → 青 `#12b886` → 紫 `#845ef7`），Max 档滑块带同色光晕，当前档位刻度同步高亮。颜色通过 `--sa-agent-slider-color` 变量从 `.sa-agent-dial-effort-block` 继承给轨道与刻度。
- 百分比分母来自 `config.contextWindow`（默认 128000，可在设置里改成模型真实窗口）。
- 用量估算按当前模式实际会发送的内容计算：`buildSystemPrompt({writeEnabled})` + `getActiveTools(writeEnabled)` + 裁剪后的消息。

---

## 3. 工具目录（17 个）

读工具（Plan/Build 均可用）：

| 工具 | 用途 |
| --- | --- |
| `get_project_summary` | 舞台/角色、变量、脚本数量概览 |
| `list_targets` | 角色列表 |
| `get_target` | 单角色详情（造型、音效、局部变量） |
| `list_scripts` | 脚本与帽子块列表 |
| `get_script` | 单脚本 Scrathon 源码 |
| `get_project_scrathon` | **整项目** Scrathon 文档，按 `### <scriptId> · <hat>` 分节 |
| `search_blocks` | 按名称/opcode 搜索积木 |
| `get_extension_source` | 扩展源码（用于理解第三方积木） |
| `get_runtime_state` | 运行状态（是否运行、当前编辑目标） |
| `block_catalog` | 积木目录 |
| `Scrathon_doc` | 语言规范全文 |
| `scrathon_example` | 示例工程 |

写工具（仅 Build 模式，默认逐个审批）：

| 工具 | 用途 |
| --- | --- |
| `apply_scripts` | 追加新脚本（不碰已有脚本） |
| `apply_scrathon_edits` | **按 scriptId 原位替换脚本内容**，块级 patch |
| `delete_scripts` | 删除顶层脚本 |
| `create_variable` | 新建变量/列表/广播（全局或局部） |
| `rename_target` | 重命名角色 |

`WRITE_TOOL_NAMES` 是唯一写入白名单来源，Plan 模式下这些定义根本不发给模型。

---

## 4. 写入流水线

1. 模型产出工具调用 → `loop.js` 判断是否写入工具 → 若 `writeEnabled` 为假直接拒绝。
2. 写入前挂载 diff（`diff.js`）到待审批 payload，UI 渲染 EDIT 卡片。
3. 用户批准后 handler 编译 Scrathon，构造 XML 与 `meta`：

   ```js
   {
     projectId,              // 准备时刻的项目 id
     targetId,               // 目标角色
     declarations,           // 变量/列表/广播
     replaceScripts,         // [{ scriptId, xml }]  ← 原位 patch
     deleteScriptIds,        // 仅 delete_scripts 使用
     renameTarget
   }
   ```

4. `applyWrite` 三道校验：项目 id 未变、`targetId` 仍在 runtime 中、删除数量与请求一致。
5. `Blockly.Events.setGroup(true)` 内依次执行：声明变量 → `renameTarget` → 删除 → **原位 patch** → 新增块 → `setGroup(false)`。
6. 任一步抛错都会中止并回滚事件组，整批只占一个 Ctrl+Z 步。

### 原位 patch 规则（`script-patcher.js`）

- 根块类型 + mutation 签名相同 → 保留原块（id、坐标、注释不变），只改字段。
- 沿 `<next>` 与 `<value>`/`<statement>` 递归对齐；命中即改字段并继续向下。
- 第一处结构差异处：丢弃旧尾巴、创建新尾巴、接到上一个未动连接点。
- 帽子块类型变了 / `procedures_definition` 变了 → 才替换根，并用 `moveBy` 保持坐标。
- 恢复 input 的 shadow（`setShadowDom`）后再挂新子块，保证报告类积木与变量字段正常。

---

## 5. 存储布局

| 键 | 内容 | 迁移说明 |
| --- | --- | --- |
| `astras-agent-config-v2` | 模型配置（含 API key 明文）、`maxSteps`、`contextWindow`、`reasoningEffort` | 从 `astras_apiUrl/apiKey/model` 迁移后**删除旧键** |
| `astras-agent-conversations-v2` | `{ activeByProject, projects }` | 从 v1 平铺列表、v0 单历史数组迁入当前项目 |
| `astras-agent-write-enabled-v1` | 每个会话的 Build 模式开关 | 不持久化审批决策 |
| `AEAstrasCopilotPosition` | 停靠位置（侧栏/底部） | — |
| `astras-agent-diff-view-v1` | Diff 视图偏好（文本/积木） | — |

项目 id 来自 `vm.runtime.getProjectId()`，保存在 sb3 顶层 `projectID`。没有该元数据的老项目首次加载会生成新 UUID，**保存一次后**会话归属才稳定。

---

## 6. 请求与重试

- 端点：设置面板填 base URL，`buildApiEndpoint()` 补 `/chat/completions`。
- 重试：`isRetryableError` 判定 —— 408/425/429/500/502/503/504/522/524 退避重试；其余 4xx 与 status 0 不重试；用户主动中止不重试。
- `retries`、`maxSteps`（默认 24，上限 200）、`temperature`、`maxTokens`、`contextWindow` 全部走 `clampNumber`，空输入回退原值而非变 0。
- 上下文：`MAX_CONTEXT_MESSAGES` 条消息裁剪；`get_project_scrathon` 单次结果放宽到 60k 字符，其余工具 12k。

---

## 7. 测试

```bash
cd packages/scratch-gui
./node_modules/.bin/jest test/unit/addons/astras-copilot
```

覆盖：`retry`、`config`、`conversations`、`project-scrathon`、`script-patcher`、`context-dial`、`scrathon`、`request`。

注意 `settings.test.js` 在 node 环境下会因缺少 `CustomEvent` 失败，属既有问题，与本插件无关。ESLint 在本仓库忽略 addon 目录，静态检查以 Babel 解析 + `webpack --bail` 为准。
