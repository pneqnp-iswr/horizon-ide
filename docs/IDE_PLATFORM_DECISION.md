# Horizon IDE — platform investigation (2026-11-01)

## Source baseline

Repository: pneqnp-iswr/horizon-ide, master commit 959599b4f84afae369d0a54a1d2a95a57c4d7134.

Source files inspected: README.md, ARCHITECTURE.md, package.json, src-tauri/Cargo.toml, src-tauri/src/lib.rs, docs/WINDOWS_GAME_VIEWPORT.md and .github/workflows/windows-desktop.yml.

The Tauri app has Monaco, revisioned saves, a nested explorer, native Rust IPC, a gated build path, .hmod checks, process-owned Horizon launch, local AI and single-file reviewed diffs. It is not yet Visual Studio-class. Its Win32 HWND SetParent experiment is open PR #24, not a playable game claim and not part of master.

## Decision matrix (qualitative technical analysis; NOT a performance benchmark)

| Dimension | Eclipse Theia Desktop | Code - OSS | Existing Tauri 2 |
| --- | --- | --- | --- |
| Editor, terminal, search, Git, debug | Composable mature modules | Mature integrated workbench | Partial existing components |
| Original Horizon dockable views | Native widget/extension pattern | Extension and/or workbench changes | Requires custom docking code |
| Existing Rust services | Needs extraction and IPC adapter | Needs native IPC adapter | Already available |
| Native Electron HWND | Electron provides window handle; game integration unproven | Electron provides window handle; game integration unproven | Win32 parent experiment in PR #24 only |
| WASD, raw mouse, WGPU game frames | Not tested | Not tested | Not tested |
| Maintenance risk | Moderate-high migration | High fork/update divergence | Lowest short-term |
| Licensing review | Theia IDE MIT; platform components also EPL/GPL-with-exception | Code MIT; Microsoft product and marketplace rules differ | Horizon IDE MIT plus dependencies |
| Windows RAM, CPU, FPS | NO DATA | NO DATA | No controlled comparable A/B DATA |

Provisional technical-spike candidate: Eclipse Theia Desktop. FINAL migration decision: OPEN. Tauri remains production fallback. Do not promote Theia because of appearance, or reject Tauri without measuring.

## Evidence gates

| Gate | Present result | Missing proof |
| --- | --- | --- |
| Theia application source configuration | IMPLEMENTED / SOURCE ONLY | Windows clean build and actual launch |
| Horizon Game dockable widget | IMPLEMENTED / SOURCE ONLY | Real Electron UI opens, docks and persists |
| Typed Electron to Rust probe | IMPLEMENTED / SOURCE ONLY | Full GUI-to-Rust click path verified |
| Rust protocol unit test | SOURCE ONLY | Actual Cargo test result |
| Existing Tauri backend reuse | NOT IMPLEMENTED | Shared Rust library + parity |
| Game HWND / WGPU / input | NOT IMPLEMENTED | Real Windows GPU gameplay acceptance |
| Installer / portable desktop | NOT IMPLEMENTED | Installer artifact launch, integrity, uninstall |
| A/B startup, RAM, CPU and FPS | NOT MEASURED | Same hardware, cold/warm controls and repeated runs |

## Prioritized next steps

First make the isolated Theia branch compile and run on Windows; capture exact checks and logs. Then test editor, terminal and Rust probe through the actual UI. Extract only stable reusable Rust functionality, retaining optimistic file-save concurrency and explicit build trust. Finally test cooperative native Horizon game embedding on owner's Windows GPU, and measure perf against Tauri.

References:
- https://github.com/eclipse-theia/theia/blob/master/examples/electron/package.json
- https://github.com/eclipse-theia/theia-ide/blob/master/applications/electron/package.json
- https://theia-ide.org/docs/widgets/
- https://theia-ide.org/docs/authoring_extensions/
- https://theia-ide.org/docs/composing_applications/
- https://www.electronjs.org/docs/latest/api/browser-window
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent
- https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows
- https://code.visualstudio.com/license

Evidence vocabulary: SOURCE ONLY, COMPILED, GUI TESTED and GPU GAMEPLAY VERIFIED are distinct stages.
