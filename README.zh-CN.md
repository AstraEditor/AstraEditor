<p align="center">
  <img src="assets/logo.svg" alt="AstraEditor" width="50%"/>
</p>

[![](https://img.shields.io/badge/修改自-TurboWarp-FF4C4C.svg)](https://github.com/TurboWarp)
![Stars](https://img.shields.io/github/stars/AstraEditor/AstraEditor?style=social)
![Forks](https://img.shields.io/github/forks/AstraEditor/AstraEditor?style=social)
![Issues](https://img.shields.io/github/issues/AstraEditor/AstraEditor?color=0099ff)

# 欢迎使用 AstraEditor !

### 这是什么

**AstraEditor** 是 [TurboWarp](https://github.com/TurboWarp) 的一个修改版，增加了更多功能，让你的编程速度 _快如闪电_。

### 如何使用

你可以访问 [网站](editors.astras.top) 使用 **AstraEditor**，也可以在那里下载桌面版。

## 功能

### README

右键点击并选择 **添加 README**，即可为你的项目添加说明文档。

```markdown
# 欢迎使用 AstraEditor！

感谢你使用 AstraEditor！
如果喜欢的话，给我一个 Star 吧！:)
```

### 扩展功能

- **待办事项** — 在项目中跟踪任务
- **书签** — 为积木添加书签以便快速定位
- **SPA（Simple Project Analyzer）** — 分析您的项目

## 开发

### 前置要求

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io) >= 11.12.0

### 初始化

```bash
git clone --depth 1 https://github.com/AstraEditor/AstraEditor.git
cd AstraEditor
pnpm install
```

### 构建

包必须按依赖顺序构建：

```bash
pnpm build:l10n      # @turbowarp/scratch-l10n（本地化）
pnpm build:audio     # scratch-audio（音频引擎）
pnpm build:blocks    # scratch-blocks（积木编辑器）
pnpm build:render    # scratch-render（WebGL 渲染）
pnpm build:vm        # scratch-vm（虚拟机）
pnpm build:paint     # scratch-paint（绘图编辑器）
pnpm build:gui       # scratch-gui（主界面）
```

或一次性全部构建：

```bash
pnpm build
```

### 启动开发服务器

```bash
pnpm start
```

打开浏览器访问 `http://localhost:9001`。

当你修改了某个依赖包（如 `scratch-vm`），只需重新构建该包然后刷新页面：

```bash
pnpm build:vm
```

### 代码格式化

```bash
# 检查格式
pnpm format::check

# 自动修复格式
pnpm format::fix
```

### 获取外部资源

```bash
pnpm fetch
```

### 清理

```bash
pnpm clean
```

### 项目结构

```
AstraEditor/
├── packages/
│   ├── scratch-gui/       # 编辑器主界面（React）
│   ├── scratch-vm/        # 虚拟机 — 运行 Scratch 项目
│   ├── scratch-blocks/    # 积木编辑器（基于 Blockly）
│   ├── scratch-render/    # WebGL 渲染引擎
│   ├── scratch-paint/     # 造型编辑器
│   ├── scratch-audio/     # 音频引擎
│   └── scratch-l10n/      # 本地化 / 翻译
├── pnpm-workspace.yaml    # 工作区配置
├── .eslintrc.js           # ESLint 配置
└── .prettierrc            # Prettier 配置
```

`packages/` 内的所有包通过 `workspace:*` 相互链接 —— 修改一个包后，依赖它的包重新构建即可生效。

### 代码检查

```bash
# 检查所有包
pnpm -r run lint

# 检查特定包
pnpm --filter scratch-vm run lint
pnpm --filter scratch-gui run test:lint

# 自动修复
pnpm -r run lint -- --fix
```

## 许可证

本项目是 [TurboWarp](https://github.com/TurboWarp) 的修改版。各包的具体许可证请参见对应目录。
