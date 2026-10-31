# Scrathon 进阶演进与工程落地任务清单 (TODO)

> **当前状态**：v1.0 MVP 已完成（支持双向完整编译/反编译、强类型 `${t:v}`、独立转换窗口、基础单元测试）。  
> **演进方向**：工业级体验（文本 Diff 审查、稳定 ID 原位修补、动态扩展 Schema、双向源码映射）。

---

## 阶段一：Diff 对比与审查界面 (Agent Diff Review UI) [已完成]
> 用户在 Agent 执行积木修改前，可以在对话流中直观审查红绿文本对比，确认无误后再执行。

- [x] **1.1 轻量行级 Diff 核心 (`agent/scrathon/diff.js`)**
  - [x] 实现零依赖的 LCS（最长公共子序列）行级差异对比算法。
  - [x] 产出统一结构：`{ type: 'add'|'del'|'same', line, oldLineNo, newLineNo }`。
  - [x] 编写 Diff 引擎的专用单元测试（验证新增、删除、替换、多段混杂）。

- [x] **1.2 局部智能切片对比 (Scope-Aware Diff)**
  - [x] 避免整角色刷屏：根据修改的脚本（通过 `@id` 或帽子块匹配），只提取受影响的脚本做精准对比。
  - [x] 支持上下文裁剪与折叠（默认展示变动行及前后 3 行上下文）。

- [x] **1.3 拦截 Agent 写入与挂载 Diff 数据**
  - [x] 在 `apply_scripts` 执行前，获取目标角色当前被修改脚本的 Scrathon 文本。
  - [x] 预先计算 Diff 数据，挂载到审批 Payload（`toolCall.pendingApproval`）中。

- [x] **1.4 对话流 Diff 审查卡片 UI (`userscript.js` + `agent.css`)**
  - [x] 独立无边框对话元素渲染：针对代码写入调用（`apply_scripts` / `delete_scripts`），直接在对话流中展示，不折叠入卡片，无气泡边框。
  - [x] 左右双栏对比布局 (Side-by-Side Split Diff)：`EDIT -> Target` 头部，左栏显示原始行号与代码，中间竖线 `|` 分隔，右栏显示标记（` `、`+`、`~`）、新行号与变更代码。
  - [x] 集成审批控制（允许、拒绝、始终允许）与状态徽章展示。

- [x] **1.5 作品更改双模式视图切换 (Scrathon 代码 vs ScratchBlocks 积木)**
  - [x] 在对话流作品更改 / Diff 审查区域顶部提供视图切换按钮（支持「Scrathon 文本」与「ScratchBlocks 图形积木」双模切换）。
  - [x] **Scrathon 模式**：展示双栏文本 Split Diff，适合快速审查语法、行级增减与代码细节。
  - [x] **ScratchBlocks 模式**：调用 scratch-blocks 原生 SVG 渲染管线，将修改前/修改后的脚本直接渲染为原生彩色积木形态，并提供直观的图形化变更对比。
  - [x] 视图状态持久化与用户偏好记忆（`astras-agent-diff-view-v1`，默认积木模式；按钮使用图标）。

---

## 阶段二：稳定节点 ID 与原位修补 (Stable Node IDs & In-Place Patching)
> 避免“全量推倒重建”导致运行时线程被掐死、Ctrl+Z 撤销栈破坏以及工作区严重闪烁。

- [ ] **2.1 反编译元数据导出**
  - [ ] 根积木导出位置与 ID 装饰器：`@pos(x, y)`、`@id("block_id")`。
  - [ ] 普通积木行尾导出稳定 ID 注释：`move(${n:10})  # id:b_xxx`。

- [ ] **2.2 词法/语法解析器支持元数据 AST 节点**
  - [ ] 词法分析器 `lexer.js` 支持保留行尾注释元数据 `# id:...`。
  - [ ] 语法分析器 `parser.js` 将 ID 挂载到 AST 节点的 `id` 属性中。

- [ ] **2.3 积木级 In-Place Patch（增量就地修补）**
  - [ ] ID 匹配且 Opcode 相同时：就地调用 `block.setFieldValue()` 或更新 shadow input，不重建 block。
  - [ ] 仅新增节点插入链条（`connect`），仅删除节点平滑断开缝合（`block.dispose(false)`）。
  - [ ] 全程统一包裹在单次 `Blockly.Events.setGroup` 事务中，保持单步 Ctrl+Z 体验。

- [ ] **2.4 智能碰撞避让布局 (Smart Packing)**
  - [ ] 针对没有 `@pos` 的新脚本：自动扫描当前角色已有积木的最大包围盒。
  - [ ] 按安全边距（右侧 +80px，向下 +60px）落位在空白区域，绝不重叠覆盖已有堆叠。

---

## 阶段三：动态 Schema 驱动与扩展兼容 (Schema-Driven Registry)
> 摆脱硬编码映射表，任何官方或第三方扩展一加载即可无缝支持。

- [ ] **3.1 动态 `SchemaRegistry` 架构**
  - [ ] 监听 Scratch VM 的扩展注册事件（`runtime._blockInfo`）。
  - [ ] 运行时自动将扩展的 `arguments`、`menus`、`opcode` 转换为 Scrathon 规范的 `BlockSchema`。

- [ ] **3.2 逃逸通用调用语法 (`ext(...)`)**
  - [ ] 支持语法：`ext("ext_opcode", arg1=${t:v}, field2=${m:opt})`。
  - [ ] 保证无论遇到何种未注册的奇异积木，语法都不会崩溃，双向无损。

---

## 阶段四：源码映射与工作区双向联动 (Sourcemap & Bidirectional Highlight)
> 实现文本代码与图形积木的交互式焦点同步。

- [ ] **4.1 AST 源码映射表 (Sourcemap)**
  - [ ] 生成 `Map<blockId, { line, col, endLine, endCol }>` 映射表。

- [ ] **4.2 双向交互联动**
  - [ ] 点击 Scrathon 窗口中的某一行代码 ➔ Scratch 工作区平滑居中并发光高亮该积木。
  - [ ] 在 Scratch 工作区选中某块积木 ➔ Scrathon 窗口光标跳转并高亮对应源码行。
