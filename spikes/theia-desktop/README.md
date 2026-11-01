# Horizon IDE — Theia Desktop spike

Experimental source-only Theia/Electron desktop foundation. The working Tauri 2 application remains unchanged in the repository root.

## Implemented in this branch

- A separate Electron-targeted Eclipse Theia application with stock workspace, editor, terminal, search, SCM, debug and supporting packages pinned to Theia 1.76.0.
- An original dockable Horizon Game widget, opened through the command palette with the command Horizon: Open Game View.
- Theia frontend/backend typed RPC for a user-initiated read-only Rust sidecar probe. The frontend cannot supply a binary path, arbitrary arguments or shell commands.
- A tiny Rust sidecar returning a fixed, explicitly non-gameplay JSON response. It does not execute builds or launch Horizon.

No Windows GUI, IPC runtime or GPU result has been verified at this stage. The sidecar is NOT the existing Tauri Rust application backend. No native game viewport is implemented here.

## Windows reproduction

Requires Node.js 24+, npm, stable Rust and Windows Node-native build prerequisites (Visual Studio Build Tools).

From repository root, in PowerShell:

    cd spikes/theia-desktop
    npm install
    npm run build
    cargo build --manifest-path rust-sidecar/Cargo.toml
    $env:HORIZON_IDE_SIDECAR_PATH = (Resolve-Path 'rust-sidecar/target/debug/horizon-ide-sidecar-spike.exe').Path
    npm run start

Use the command palette to open Horizon: Open Game View. Click Check Rust backend transport. With the built sidecar and environment variable it should show ready. Without the path it should show not_configured. A CI build does not prove this Windows UI workflow.

To run the unchanged Tauri baseline, go back to repo root and use npm ci followed by npm run tauri:dev.

## Security and production conditions

The backend invokes only a developer-selected absolute executable via execFile with shell false, a three-second timeout, a 4 KiB response bound and strict schema validation. There is no arbitrary user-controlled executable command in the frontend. No model or untrusted workspace is authorized to choose the binary.

Before migrating existing commands, extract backend logic into reusable Rust crates with workspace confinement, revision checks, exact process ownership, approval semantics, cancellation, audit logs and parity tests. No unattended executable replacement or release is allowed.

A real Horizon Winit/WGPU game needs separate Windows GPU hardware tests covering rendered frames, WASD, mouse-look, inventory, resize, DPI, focus switching, detach and teardown. Tauri PR #24 remains separate from this prototype.

Platform licensing and third-party extension notices must be reviewed before distributing. Theia IDE product is MIT but many Theia framework packages have EPL-2.0 or GPL-2.0-with-Classpath-Exception licensing. No proprietary Visual Studio branding or Minecraft assets are bundled.
