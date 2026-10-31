# Windows game viewport — native discovery stage

Horizon IDE is a **Tauri 2 desktop app**, not a browser website. The editor uses Monaco inside WebView2. The Horizon game is a separate, real Winit/WGPU native process and must not be represented by a fake canvas or screenshots.

## Shipped in this stage

The **Find native window** button inside the desktop **Horizon Game** pane inspects the top-level Win32 HWNDs for **exactly the PID of the game process owned by the IDE**. It uses Windows `EnumWindows`, `GetWindowThreadProcessId`, visible/top-level checks, client rectangles, and a deterministic largest-usable-window selector. The PID comes from Rust's owned `Child` handle, **never from a user-provided handle, a title search or a random running Minecraft client**. No arbitrary window can be selected from WebView JavaScript.

The native probe reports a window title, dimensions and PID only if the selected installed Horizon client actually created a visible usable Win32 game window. The frontend reports `native-window-found`, `no-native-window`, `not-running` or `unsupported-platform` and does not pretend a viewport was embedded.

The bridge is conditional on the Windows build; other operating systems return a non-embedding status. The pure selection tests run on all CI platforms, and real Windows Tauri compilation/tests are required.

## What is NOT implemented

`embedded: false` and `playableVerified: false` are always returned. No frame was captured, no WGPU surface was transferred, no native window was reparented, and no mouse/keyboard gameplay was tested by this probe. A running process or valid HWND does **not** imply successful world loading.

## Next controlled experiment

1. Test with a real, owner-installed Horizon build on Windows and record its PID, top-level HWND and visible client dimensions.
2. Prototype a **separately opt-in** native child-window host or upstream cooperative render-surface handoff. An ordinary HTML canvas cannot render a foreign WGPU swapchain.
3. Require reversible attach/detach, lossless process ownership, resize and DPI handling, and keyboard/raw mouse focus. Win32 `SetParent` has DPI/UI-state and style pitfalls; a failed trial must leave the user's game detachable and recoverable. See [Microsoft SetParent documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent).
4. On real hardware verify interactive game frames, input focus, alt-tab, split-pane resizing, process exit, and frame-time/FPS relative to a native Horizon window. No performance claim before measurement.
5. Only then may the IDE display `embedded: true`, `playableVerified: true`.

The target is an actually playable **Horizon in the desktop IDE**, not a screenshot preview or a conventional website. See [issue #4](https://github.com/pneqnp-iswr/horizon-ide/issues/4).
