# New official Horizon content-mod project

Horizon IDE can create a genuine **data-only content mod** through the upstream `cargo-horizon-mod new` command. It does **not** generate imaginary Rust mixins, copy a stale static template or run a downloaded script.

## How it works

1. Select an existing writable parent folder as **Workspace Root** in Horizon IDE.
2. Expand **New Horizon Content Mod** and select your trusted installed `cargo-horizon-mod[.exe]` executable.
3. Enter a new folder name, e.g. `ruby_mod` or `ruby-world`. The name must start with a lowercase letter and contain only lowercase letters, digits, `_` or `-` (at most 40 characters).
4. Click **Create official starter** and approve running the selected native tool.
5. The IDE creates a unique staging folder inside the workspace, runs the real `cargo-horizon-mod new` on a child directory with the requested name, then verifies that the generator produced `horizon-mod.toml` with the expected mod ID and only the `registries` capability.
6. The new project is published with a same-filesystem directory rename only after the generator succeeds. The IDE switches its workspace to the created project and opens the generated manifest directly in Monaco, preserving the read revision for conflict-safe saving.

This is an official content template with `data/`, `assets/` and `horizon-mod.toml`, **not** a native Rust `.hnmod` mod. Native mods require a different version-pinned mixin build workflow.

## Safety and limits

- No generic shell, arbitrary command or AI-approved build is executed. The selected native generator still runs as your OS user: only execute tools from trusted channels.
- An existing destination is never intentionally overwritten. The tool operates inside a new private stage directory rather than directly in the final destination.
- An external filesystem actor racing the final destination between checking and rename could require handle-relative platform primitives for complete safety; the app does not currently claim transactional protection against another process with write access to the same workspace.
- On a generator failure or timeout, the stage is **retained** for inspection and the error shows its path. This may leave temporary files; the app does not discard them automatically.
- No project code is built or game started by this command. `gameLoadVerified: false` is always returned.
- A generated template does not automatically pass the static registry check or a real-world gameplay test. The existing **Verify .hmod** action can check an actual built archive through the official tool, then the experimental Game Bridge may observe inventory.

Source of truth: [Horizon content-mod guide](https://github.com/horizon-rust/horizon/blob/main/docs/mods.md) and [upstream official template](https://github.com/horizon-rust/horizon/tree/main/crates/cargo-horizon-mod/template/content).

## Validation

Rust tests cover safe project slugs, forbidden traversal and invalid inputs. Frontend tests cover approval and opening a generated manifest. Full template generation and a real mod build require an installed official generator and are not claimed as executed in CI.
