# Horizon IDE

**An AI-native desktop development environment for the Rust-based [Horizon Minecraft client](https://github.com/horizon-rust/horizon).**

The product goal is one seamless application with a **directly playable Horizon viewport** beside a full code editor, AI coding assistant, project explorer and diagnostics console. Build, verify and observe changes in a disposable test world without repeatedly switching apps.

> **Engineering preview — not a finished integrated game IDE.** This repository has a working initial Tauri/React desktop shell and a developer workflow. The current game panel starts an **external** Horizon process, not embedded gameplay. The AI pane can use user-run LM Studio or Ollama on localhost; **demo mode remains clearly marked as a mock**. Real mod-load/gameplay tests, native embedding and live reload are still gated.

## Current foundation

| Capability | What exists | What it does **not** prove |
| --- | --- | --- |
| Desktop workspace | Tauri 2, React + TypeScript, Monaco, xterm.js, adjustable panels and theme | A game is playable inside a WebView |
| Source editor | Workspace-root path confinement; UTF-8 source snapshots with SHA-256 revisions, conflict-aware atomic saves and an unsaved-edits indicator | Race-free multi-editor collaboration |
| Game client | User-selected `horizon-client[.exe]`, checked with `--launch-api`; owned OS process status, Stop, restart | A mod has loaded in a real game |
| Session isolation | Per-launch disposable `--game-dir` and `--home`, cleaned on normal exit | Native mods are sandboxed (they are not) |
| Item smoke (experimental) | Explicitly approved `horizon-ctl` launch with isolated game world, strict `inventory`/`give` checks and evidence panel | An inventory observation proves the selected `.hmod` defines that item; package origin is **not** verified |
| Build runner | Explicit per-run consent, async `cargo check --locked`, JSON compiler diagnostics, bounded output/time and cancellation | Cargo build scripts cannot run code (they can) |
| Official content mod workflow | `cargo-horizon-mod new`, real `.hmod` build, official checksum check, and package auto-selection for isolated smoke | That the running game actually accepted the archive or its content |
| AI | Real native loopback-only LM Studio/Ollama chat adapter, local model discovery, opt-in document context and read-only suggestions; optional mock demo | Automatic patch application, remote services or autonomous coding agent |

**Integration status:** Desktop foundation (#1), runtime hardening (#2), revisioned saves (#7), bounded Cargo builds (#8), isolated sessions (#9), Game Bridge (#10), official `.hmod` verification (#11), nested Project Explorer (#12), genuine official project creation (#13), and selected prepared resources (#14) are merged to `master`. [#16: Build .hmod](https://github.com/pneqnp-iswr/horizon-ide/pull/16) is under review and remains unavailable in releases until merged and tested. These changes do not prove real game loading or an embedded playable viewport.

## Development

Requires Node.js 24, an appropriate Rust toolchain, Tauri desktop prerequisites (WebView2 on Windows), and a **trusted, user-installed** Horizon client for actual game launch. The IDE does not bundle Microsoft/Mojang assets or game binaries.

```sh
git clone https://github.com/pneqnp-iswr/horizon-ide.git
cd horizon-ide
npm ci
npm run tauri:dev

# Frontend checks
npm run check
# Rust core tests
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features
# Actual Tauri Windows desktop compile/test is in .github/workflows/windows-desktop.yml
```

`npm run dev` opens the Vite frontend, but **native file/game/build IPC only works in the desktop app**. Opening or browsing an untrusted source tree does not authorize Cargo builds. The **Run Build** confirmation warns that project build scripts and procedural macros can execute with your OS user's privileges. Do not build untrusted projects.

## Local AI in the Windows desktop app

Use **Local AI Coding Assistant** in the sidebar, select LM Studio or Ollama, and choose **Discover local models**. The IDE connects only to the specified local model server and sends the editor document only when you explicitly opt in. Responses are proposed text, not automatically applied changes. See [Local AI desktop guide](docs/LOCAL_AI_DESKTOP.md).

## Planned live-edit loop

1. Create/import a version-pinned content or native Rust template.
2. Modify source in Monaco or review an AI-proposed patch.
3. Validate or build with explicit project trust consent.
4. Stage a mod into an **isolated** Horizon preview world.
5. Use upstream `horizon-ctl` to verify a real content change (inventory/scene assertions, logs); retain engine commit and artifact SHA-256.
6. Display errors and let a developer undo and repeat.

Native source-mixin Rust mods normally **compile into a custom game executable and require restart**; do not promise runtime hot replacement. Studio-only 3D/VFX previews and screenshots are not real in-game proof.

Our priorities are tracked in [#3 real game tests](https://github.com/pneqnp-iswr/horizon-ide/issues/3), [#4 native playable viewport](https://github.com/pneqnp-iswr/horizon-ide/issues/4), [#5 build/security](https://github.com/pneqnp-iswr/horizon-ide/issues/5) and [#6 selective Studio migration](https://github.com/pneqnp-iswr/horizon-ide/issues/6).

## Design principles

- A working game-development IDE, not a dashboard of nonfunctional controls.
- Reuse proven components from [Horizon Studio](https://github.com/pneqnp-iswr/horizon-studio), but retain a clean product boundary and avoid copying the entire old UI.
- Conservative trust boundaries for native code and LLM-generated patches; human-reviewable diffs, source provenance, no model-controlled shell.
- Accessibility, configurable layouts, English-first UI with planned Russian translation, keyboard-driven workflow.
- Explain evidence honestly: **schema-valid → builds → game-loaded → gameplay-tested** are different levels.

See [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), [SECURITY.md](SECURITY.md), [Runtime Contract](docs/HORIZON_RUNTIME_CONTRACT.md), [Official Starter](docs/OFFICIAL_STARTER.md), [Content Build](docs/CONTENT_BUILD.md), [Build Security](docs/BUILD_SECURITY.md), and [Experimental Game Item Smoke](docs/GAME_ITEM_SMOKE.md).

License: MIT. Horizon IDE is an independent project and is not endorsed by Mojang, Microsoft or Horizon maintainers.
