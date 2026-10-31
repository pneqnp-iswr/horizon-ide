# Horizon IDE — live item observation (experimental)

This feature is a **real horizon-ctl protocol adapter**, not a mock UI result and not a screenshot check. Its first evidence level is intentionally called `inventory-observed`, not `game-load`, because archive-to-item provenance is not established yet.

## How to exercise

1. Install or build a trusted local Horizon and `horizon-ctl` side by side, prepare the game resources through the official owner-verified Horizon launcher, and confirm the client answers `--launch-api`.
2. Set the Horizon IDE workspace to the mod source directory. Produce an actual content `.hmod` with the official `cargo horizon-mod build` tool. The IDE does not generate a fake package or download game files.
3. In **Horizon Game**, expand **In-game content smoke test (experimental)** and provide `horizon-ctl`, the `.hmod` file inside the workspace, and a specific namespaced item ID such as `ruby:ruby`.
4. Read the approval prompt: this runs a trusted native game binary and an actual isolated world. The IDE uses unique temporary `game` / `home` folders, not the user's personal saved worlds.
5. The adapter launches `horizon-ctl --socket ... launch --world IDEPreview --creative --wait --game ... --game-dir ... --home ... --offscreen --dev-mod ...`, then `wait-for loaded`, reads a **strictly validated inventory**, requires the game to **reject an absent control item**, gives the requested target, and polls for **exactly one additional matching item in a real slot**.
6. It sends `quit` on completion or failure. If quitting cannot be confirmed it preserves the temporary session path for manual inspection rather than killing an unverified PID. The frontend shows the structured observation in the diagnostics/output panel.

## Strict evidence boundary

- `inventory-observed`: exact item slot and totals agree, negative control rejected, and the game reported an isolated session. This is a useful *runtime observation*, not content provenance.
- `packageItemOriginVerified: false` **always** at this stage. The provided item ID is supplied by the developer, not proven to exist in the selected archive. A vanilla item would otherwise produce a false positive.
- `game-load`: **not yet implemented**. Requires independently checking the `.hmod` manifest and content entries plus the Horizon static registry checker and game version, then retaining a bound evidence artifact.
- `gameplay`: **not tested**. Inventory change is not evidence of an entity's AI, mob behavior, rendering, controls or events.
- `embedded-viewport`: **not implemented**. The game is headless/offscreen in this smoke test, and a screenshot is never substituted for live rendering.

The unversioned `horizon-ctl` control API may change. This adapter pins its assumed command names to the upstream generated [command table](https://github.com/horizon-rust/horizon/blob/main/docs/horizon-ctl-commands.md) and uses hard failures for invalid responses rather than silently accepting a new schema.

## Security and limitations

- Only a selected executable named `horizon-client` and a sibling `horizon-ctl` may be used; these executable names are **not** proof of binary authenticity. Run binaries you trust.
- The `.hmod` is constrained to the configured IDE workspace, must be a ZIP-header file with `.hmod` extension and at most 64 MiB, and is SHA-256 hashed. ZIP header checking **is not** a full package validation.
- Explicit per-test consent is mandatory; the backend refuses `approved=false` regardless of frontend behavior. The adapter does not copy session credentials into files or access the user's personal game directory.
- No arbitrary host command or user-provided CLI flags are forwarded. CLI subprocess stdout/stderr is drained but retained output is limited to 64 KiB per stream and command timeouts are enforced.
- The launched game is a separate process. Stopping `horizon-ctl` on timeout does **not** guarantee killing game descendants. If `quit` fails, operators must manually inspect the isolated session. A future adapter needs explicit cross-process ownership, process-tree termination, cancellation, and durable evidence journals.
- No source-code auto-editing or AI-agent build approvals are granted by these commands.
- CI uses parser/malformed-message tests, never a synthetic claim that a licensed GPU game was run.

## Acceptance milestones

The next real Horizon run needs a recorded client commit/version, selected mod SHA, precise inventory JSON, negative control, exact slot delta, OS, successful session cleanup and known prepared resources. Until then this feature is implemented but **not verified on a real local game installation**.

Related: [#3](https://github.com/pneqnp-iswr/horizon-ide/issues/3) live game test; [#4](https://github.com/pneqnp-iswr/horizon-ide/issues/4) interactive native viewport.
