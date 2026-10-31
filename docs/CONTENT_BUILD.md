# Building a real Horizon content .hmod from the IDE

Horizon IDE offers **Build .hmod** for projects created using the upstream `cargo-horizon-mod new` tool, or any compatible content-mod project. It is separate from **Run Build**, which invokes `cargo check` on trusted Rust code projects.

## Developer workflow

1. Open a workspace containing `horizon-mod.toml` and **no** `Cargo.toml` or `mod.wasm`.
2. Select the trusted official `cargo-horizon-mod[.exe]` native tool in the New Content Mod panel. The path also serves the standalone **Verify .hmod** action.
3. Save pending changes in Monaco first, click **Build .hmod**, and explicitly approve execution of the trusted tool.
4. The native backend runs `cargo-horizon-mod build` with a fixed working directory and **no shell or model-controlled arguments**.
5. It requires the official tool to report exactly where the package was built, resolves its canonical location within `<workspace>/target/horizon-mod`, and calculates a SHA-256 of the actual artifact (64 MiB maximum).
6. It runs `cargo-horizon-mod check <artifact> --json` using the same trusted tool and rejects wrong package kind, non-content API, code capabilities, mismatched hash, invalid ID or mismatched output filename.
7. The IDE displays the resulting artifact path, static-check metadata and SHA, then automatically populates the in-game smoke panel's package selector with the **real output**.

The result's `inGameVerified` is always `false`. A passing static check does **not** prove actual game loading or correct mod behavior. The experimental Game Bridge is a separate, user-approved test that also requires a compatible Horizon installation and, if needed, owner-prepared resources.

## Security boundaries

- An official executable selected by the user still runs as native code with the user's privileges; do not point this field at an untrusted executable.
- A content mod should be data-only. The command refuses a project containing `Cargo.toml` or `mod.wasm` and refuses code capabilities in the checker reply.
- Builds are serialized with the existing build lock and can be cancelled through the normal **Cancel** button. Commands have a 120-second deadline and bounded stdout/stderr retention; process trees/descendants still require stronger OS-level ownership in a later security issue.
- Only a package under the canonical `target/horizon-mod` folder can be selected as a successful build. The official checker SHA must match the actual bytes, which are hashed again afterward.
- Opening/browsing source never builds a project. Unsaved Monaco edits block a package build so an older on-disk version is not mistakenly published.
- The workspace root must match the IDE's registered root. Model-generated arbitrary command flags, network downloads and game ownership bypasses are not part of this workflow.

## Verification

Rust unit tests check malicious checker reports, wrong artifact names and stdout overflow. A compiled stand-in command-line tool is exercised for real subprocess creation, build+check, returned SHA and a forged checksum. Frontend tests check user consent and automatic selection of the built artifact. CI additionally compiles the actual Windows Tauri desktop feature.

This does **not** mean that a real Horizon install has been run against this version of the IDE. Real-game evidence remains a separate acceptance gate.

Official source of truth: [Horizon mod build guide](https://github.com/horizon-rust/horizon/blob/main/docs/mods.md). Tracking: [#15](https://github.com/pneqnp-iswr/horizon-ide/issues/15).
