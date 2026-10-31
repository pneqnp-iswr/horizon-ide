# Horizon IDE desktop — build an official content .hmod

Horizon IDE is a **Tauri 2 native desktop application**. Monaco is embedded within the desktop WebView, and all workspace/file/build commands are Tauri IPC to Rust; this feature is not a hosted website or remote build service.

## End-to-end authoring cycle

1. Launch the native app using `npm run tauri:dev` on a machine with Rust/Cargo, Node.js and Windows WebView2. `npm run dev` alone is a frontend-development server, **not** the application.
2. Choose a workspace directory. In **New Horizon Content Mod**, select the trusted official `cargo-horizon-mod[.exe]` executable, enter a safe project slug and confirm **Create official starter**. The app opens the real generated `horizon-mod.toml` in Monaco.
3. Expand folders in the **Project Explorer**, edit the `data/` / `assets/` files and save them. Do not start a build while unsaved Monaco edits remain.
4. Select the same official generator executable and press **Build .hmod** in **Build, Diagnostics, Console**. Explicit approval is required. Rust invokes `cargo-horizon-mod build` in the selected content workspace with no shell, no AI-selected flags and bounded execution.
5. The backend locates the actual reported `target/horizon-mod/<id>.hmod`, checks that it remains under the expected workspace and is limited to 64 MiB, computes SHA-256, executes official `cargo-horizon-mod check PACKAGE --json`, verifies the package hash and the `registries`-only content API.
6. Only after the check succeeds does the app populate **Built .hmod path** in its game pane. Developers can then run an independently approved static **Verify .hmod** or isolated `horizon-ctl` test on their own installed Horizon.

The returned `staticCheckPassed: true` **does not** mean `inGameVerified`. No fake screenshots, placeholders or engine-load claims are used as test evidence.

## Security and lifecycle

- Trust the selected official native tool before execution. The tool runs with your OS user privileges. The IDE never routes this command to an external website.
- `Build .hmod` is only for content projects with `horizon-mod.toml`, without Rust `Cargo.toml` or `mod.wasm`. Native Rust mixin `.hnmod` builds are a different, version-pinned workflow.
- The Rust process is owned and uses the existing **Cancel** button, shared exclusive Cargo/build lock, 120-second command timeout, and 64 KiB per stream capture. It calls the tool directly, not a shell. The emitted package path must resolve within `target/horizon-mod`.
- Any tool failure, mismatched SHA-256, malformed checker reply, non-data capability or unexpected output path is a failure, not a fallback success.
- This version does not cryptographically verify the selected executable's publisher. It also cannot guarantee that concurrent external filesystem actors did not modify a file before a later independent game test; the smoke re-checks the package hash.

## Verification gates

CI tests cover success and forged SHA using a compiled fixture executable, cancellation/error boundaries, plus frontend approval and artifact-path handoff. Windows desktop compilation and desktop-feature Rust unit tests must pass before merge. A real Horizon installation remains necessary for gameplay validation.

See [Official content starter](OFFICIAL_STARTER.md) and [Game item smoke](GAME_ITEM_SMOKE.md).
