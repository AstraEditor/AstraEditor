# Scrathon 进阶演进与工程落地任务清单 (TODO)

> **当前状态**：v1.1 已完成（双向编译/反编译、强类型 `${t:v}`、Diff 审查 UI、**块级原位修补**、按项目分组的会话、整项目 Scrathon 读取与增量编辑、17 个工具、单元测试）。  
> **演进方向**：工业级体验（稳定 ID 精确匹配、智能布局、动态扩展 Schema、双向源码映射）。  
> **实现说明**：模块划分、工具目录、写入流水线见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 已完成（v1.1 工程整理）

- [x] 重试策略修正：408/425/429/5xx 退避重试，其余 4xx 与 status 0 不重试。
- [x] 删除死代码：`agent/web.js`、`search_web`/`fetch_url` 标签与 l10n、`get_write_status`。
- [x] 配置抽离 `agent/config.js`：`clampNumber` 修复空输入变 0，旧 API key 迁移后清除。
- [x] 会话按项目分组 `agent/conversations.js`：v1/v0 迁移，侧栏只列当前项目，设置面板可看全部。
- [x] 写入前校验 `projectId` 与 `targetId` 仍存在，防止切项目后误写。
- [x] 整项目 Scrathon 读取 `get_project_scrathon` + 增量编辑 `apply_scrathon_edits`。
- [x] 块级原位修补 `agent/script-patcher.js`（见阶段二 2.3）。
- [x] `maxSteps` 可配置（默认 24，上限 200），token 估算按实际模式与工具集计算。
- [x] UI 拆分 `ui/diff-card.js`、`ui/tool-trace.js`；全局监听走 `listen()` 注册表，禁用时解绑。
- [x] 新增 retry / config / conversations / project-scrathon / script-patcher 测试套件。

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
  - [x] 在 `apply_scripts` / `apply_scrathon_edits` / `delete_scripts` 执行前，获取目标角色当前被修改脚本的 Scrathon 文本。
  - [x] 预先计算 Diff 数据，挂载到审批 Payload（`toolCall.pendingApproval`）中。

- [x] **1.4 对话流 Diff 审查卡片 UI (`userscript.js` + `agent.css`)**（渲染实现已拆至 `ui/diff-card.js` / `ui/tool-trace.js`）
  - [x] 独立无边框对话元素渲染：针对代码写入调用（`apply_scripts` / `apply_scrathon_edits` / `delete_scripts`），直接在对话流中展示，不折叠入卡片，无气泡边框。
  - [x] 左右双栏对比布局 (Side-by-Side Split Diff)：`EDIT -> Target` 头部，左栏显示原始行号与代码，中间竖线 `|` 分隔，右栏显示标记（` `、`+`、`~`）、新行号与变更代码。
  - [x] 集成审批控制（允许、拒绝、始终允许）与状态徽章展示。

- [x] **1.5 作品更改双模式视图切换 (Scrathon 代码 vs ScratchBlocks 积木)**
  - [x] 在对话流作品更改 / Diff 审查区域顶部提供视图切换按钮（支持「Scrathon 文本」与「ScratchBlocks 图形积木」双模切换）。
  - [x] **Scrathon 模式**：展示双栏文本 Split Diff，适合快速审查语法、行级增减与代码细节。
  - [x] **ScratchBlocks 模式**：调用 scratch-blocks 原生 SVG 渲染管线，将修改前/修改后的脚本直接渲染为原生彩色积木形态，并提供直观的图形化变更对比。
  - [x] 视图状态持久化与用户偏好记忆（`astras-agent-diff-view-v1`，默认积木模式；按钮使用图标）。

---

## 阶段二：原位修补 (In-Place Patching) [结构对齐版已完成]

> 目标：避免“全量推倒重建”导致运行时线程被掐死、Ctrl+Z 撤销栈破坏以及工作区严重闪烁。  
> **v1.1 状态**：结构对齐版已上线（`agent/script-patcher.js`），不依赖导出 ID；帽子块保持原 id、坐标与注释。剩余工作是把匹配从「结构签名」升级为「稳定 ID」。

- [x] **2.3 积木级 In-Place Patch（增量就地修补）**
  - [x] 根块类型与 mutation 签名一致时：只调用 `setFieldValue` 更新字段，不重建 block。
  - [x] 沿 `<next>` 与 `<value>`/`<statement>` 递归对齐新旧结构，命中即复用。
  - [x] 仅在第一处结构差异处重建尾巴并重新 `connect`，其余节点不动。
  - [x] 恢复 input 的 shadow（`setShadowDom`）后再挂新子块，保证报告类积木正常。
  - [x] 全程包裹在单次 `Blockly.Events.setGroup` 事务中，保持单步 Ctrl+Z 体验。
  - [ ] **升级**：改用导出 ID 精确匹配（依赖 2.1/2.2），消除「中间插入导致后续块整体错位」时的重建。
  - [ ] **限制**：帽子块类型变化或 `procedures_definition` mutation 变化时仍需替换根块（用 `moveBy` 保留坐标）。

- [ ] **2.1 反编译元数据导出**
  - [ ] 根积木导出位置与 ID 装饰器：`@pos(x, y)`、`@id("block_id")`。
  - [ ] 普通积木行尾导出稳定 ID 注释：`move(${n:10})  # id:b_xxx`。

- [ ] **2.2 词法/语法解析器支持元数据 AST 节点**
  - [ ] 词法分析器 `lexer.js` 支持保留行尾注释元数据 `# id:...`。
  - [ ] 语法分析器 `parser.js` 将 ID 挂载到 AST 节点的 `id` 属性中。

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
