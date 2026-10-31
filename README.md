# Horizon IDE

Horizon IDE is a desktop IDE foundation for Horizon (the Rust-based Minecraft reimplementation). It provides a focused game-dev workspace with:

- **Left pane:** Horizon game launch/status panel (external process mode).
- **Right pane:** Monaco code editor with file save support.
- **Bottom pane:** Build output, diagnostics, and xterm.js console.
- **Sidebar:** Workspace settings, file explorer, and AI assistant.

## What works now

- Tauri 2 desktop shell scaffolding with Rust command handlers.
- React + TypeScript frontend with resizable panels.
- Workspace-root constrained file listing, file read, and file write operations.
- Game states: `disconnected`, `launching`, `running`, `error`.
- Safe external process launch request handling (no hardcoded executable paths).
- Build panel triggering `cargo check` for the selected workspace.
- Mock AI provider with explicit mock labeling and extensible interface.
- Theme/workspace settings persistence with Zustand.
- Unit tests and GitHub Actions CI.

## What is intentionally simulated / pending integration

- Native embedded Horizon viewport is **not** implemented yet.
- Live runtime preview bridge and hot-reload capabilities are **planned only**.
- AI provider is currently a mock implementation; no production model integration yet.

## Local development

```bash
npm install
npm run dev
```

### Tests and checks

```bash
npm run lint
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Run as desktop app

```bash
npm run tauri:dev
```

## Security and permissions model

Filesystem and command execution are explicit:

- Workspace root must be configured before file access.
- File operations are blocked outside the configured workspace root.
- Game process launch requires a user-provided executable path.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [ROADMAP.md](./ROADMAP.md), [CONTRIBUTING.md](./CONTRIBUTING.md), and [SECURITY.md](./SECURITY.md).
