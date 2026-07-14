<p align="center">
  <img src="assets/logo.svg" alt="AstraEditor" width="50%"/>
</p>

[![](https://img.shields.io/badge/Modified%20from-TurboWarp-FF4C4C.svg)](https://github.com/TurboWarp)
![Stars](https://img.shields.io/github/stars/AstraEditor/AstraEditor?style=social)
![Forks](https://img.shields.io/github/forks/AstraEditor/AstraEditor?style=social)
![Issues](https://img.shields.io/github/issues/AstraEditor/AstraEditor?color=0099ff)

# Welcome to AstraEditor !

### What is

**AstraEditor** is a mod of [TurboWarp](https://github.com/TurboWarp), it added more feature to make your coding speed _lightning fast_.

### How to Use

You can access [Website](editors.astras.top) to use **AstraEditor**, you can also download Desktop in there

## Features

### README

You can add a README to your project by right-clicking and selecting **Add README**.

```markdown
# Welcome to AstraEditor!

Thank you for using AstraEditor!
Give my a Star if you like it! :)
```

### Addons

- **Todo** - Keep track of tasks in your project
- **Bookmarks** - Bookmark blocks for quick navigation
- **Simple Project Analyzer** - Analyze your project's performance and complexity

## Develop

### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io) >= 11.12.0

### Setup

```bash
git clone --depth 1 https://github.com/AstraEditor/AstraEditor.git
cd AstraEditor
pnpm install
```

### Build

Packages must be built in dependency order:

```bash
pnpm build:l10n      # @turbowarp/scratch-l10n
pnpm build:audio     # scratch-audio
pnpm build:blocks    # scratch-blocks
pnpm build:render    # scratch-render
pnpm build:vm        # scratch-vm
pnpm build:paint     # scratch-paint
pnpm build:gui       # scratch-gui
```

Or build everything at once:

```bash
pnpm build
```

### Development

```bash
# Start the GUI dev server (with hot reload)
pnpm start
```

Visit `http://localhost:9001` in your browser.

When you modify a dependency package (e.g. `scratch-vm`), rebuild just that package and refresh:

```bash
pnpm build:vm
```

### Format

```bash
# Check formatting
pnpm format::check

# Auto-fix formatting
pnpm format::fix
```

### Fetch external assets

```bash
pnpm fetch
```

### Clean

```bash
pnpm clean
```

### Project Structure

```
AstraEditor/
├── packages/
│   ├── scratch-gui/       # The main editor application (React)
│   ├── scratch-vm/        # Virtual Machine - runs Scratch projects
│   ├── scratch-blocks/    # Block-based code editor (fork of Blockly)
│   ├── scratch-render/    # WebGL rendering engine
│   ├── scratch-paint/     # Paint/costume editor
│   ├── scratch-audio/     # Audio engine
│   └── scratch-l10n/      # Localization / translations
├── pnpm-workspace.yaml    # Workspace config
├── .eslintrc.js           # ESLint config (extends eslint-config-scratch)
└── .prettierrc            # Prettier config
```

All packages within `packages/` are linked via `workspace:*` — changes in one package are immediately available to dependents after rebuild.

### Lint

```bash
# Check all packages
pnpm -r run lint

# Or check a specific package
pnpm --filter scratch-vm run lint
pnpm --filter scratch-gui run test:lint

# Auto-fix
pnpm -r run lint -- --fix
```

## License

This project is a mod of [TurboWarp](https://github.com/TurboWarp). See individual package licenses for details.
