# Experimental Windows game hosting inside Horizon IDE

This is a **native Windows/Tauri proof of concept**, not a website and not a screenshot/canvas approximation. It attempts to attach the HWND belonging to the **exact Horizon child process launched by this IDE session** to the native Tauri window within an explicitly reserved panel region.

## What is implemented

- An experimental **Attach to IDE** button (disabled unless the IDE's native HWND inspection found a visible, usable, top-level window belonging to its owned Horizon process).
- Explicit warning/consent before calling Win32 User32 `SetParent`.
- Rust checks game PID again before attachment, verifies matching DPI awareness, validates region coordinates against the Tauri **physical client rect**, remembers original style/parent/screen placement, sets child-window style, and positions the resulting HWND. No caller-supplied foreign HWND or arbitrary process IDs.
- **Detach native window** attempts to restore the original parent, style and screen placement. Game Stop and runtime Drop attempt to detach before terminating the separately owned disposable game.
- ResizeObserver, window resize and scroll synchronize the native physical window region with the Tauri desktop viewport; the app attempts to detach if the view is clipped, hidden or invalid.
- Pure Rust tests for invalid/overflowing viewport bounds and React tests for explicit consent and detach. Windows Tauri compile and native portable ZIP build are required.

## Hard limits

**An HWND being reparented is not proof that Horizon's WGPU swapchain, keyboard/raw mouse, gameplay or rendering work.** The initial experimental API returns `attachedNativeWindow: true` after successful Win32 parenting, but **always** returns `playableVerified: false`.

Cross-process `SetParent` has real Windows DPI-awareness hazards and may cause the game process to reset DPI context; mismatch is explicitly rejected. Winit/WGPU might not support hosting or may need upstream cooperative window/surface integration. The Win32 child may also have unusual focus/z-order behavior around WebView2, especially when resizing or switching to other applications.

**This feature is a DRAFT experiment, not a production release.** It must not be merged as verified playable in-window Minecraft without owner-run testing and evidence. If the attachment fails, external Horizon launch remains supported.

## Real-hardware acceptance checklist

1. Use a trusted Horizon binary/resources installation on Windows and a real GPU. Run and verify the game can display a world in a normal external window.
2. In Horizon IDE launch the owned disposable Horizon process, click **Find native window**, then explicitly agree to **Attach to IDE**.
3. Confirm real game frames appear in the reserved region (not just a black box) and check WASD, inventory, mouse-look, cursor capture/release, keyboard shortcuts and focus.
4. Resize the IDE, drag the pane splitter, scroll, minimize and restore, and test 100%, 125% and 150% display scaling where available. Reject if the app steals focus, covers unrelated editor controls or loses visible frames.
5. Verify **Detach native window** restores the native game, and app close/Stop does not leave orphaned HWNDs/processes.
6. Measure frame-time and FPS both externally and after attachment with equal GPU/game settings. Do not claim performance improvements without measured evidence.
7. If Winit/WGPU child hosting fails, replace the experiment with a version-pinned upstream Horizon native render-surface/embedding API. No DLL injection or arbitrary inline hooks should be required merely to host gameplay.

Microsoft reference: [SetParent function and cross-process DPI notes](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent).

Related [#4 playable native viewport](https://github.com/pneqnp-iswr/horizon-ide/issues/4), [#22 native window discovery](https://github.com/pneqnp-iswr/horizon-ide/pull/22).
