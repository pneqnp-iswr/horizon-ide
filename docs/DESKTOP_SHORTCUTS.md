# Horizon IDE — desktop keyboard workflows

Horizon IDE uses one Tauri desktop window for Monaco, game control, console and workspace navigation. Its keyboard actions operate on local Rust IPC and do not require a web service.

| Shortcut | In-app action | Safety |
| --- | --- | --- |
| **Ctrl+S** / **Cmd+S** | Save the active source file with its optimistic SHA-256 revision check | Refuses stale disk revisions; no browser Save Page dialog |
| **Ctrl+Shift+B** / **Cmd+Shift+B** | Build the current data-only content `.hmod` via the user-selected official `cargo-horizon-mod` | Explicit per-run confirmation, limited duration/output and shared Cancel Build |
| **F5** | Launch the selected external Horizon game in a disposable session | Explicit per-run confirmation; does not reload the app WebView |
| **Shift+F5** | Stop the Horizon process owned by the IDE | Does not terminate unrelated user game instances |

The file explorer is keyboard-accessible through ordinary buttons and ARIA roles. These shortcuts are installed in a capture-phase window listener so Monaco receives ordinary editor keystrokes unchanged.

**Known boundary:** F5 starts the actual external game process; an interactive 3D Horizon window embedded inside the IDE remains a separate issue (#4). The in-game `.hmod` smoke test remains explicitly approved via the Game panel and must not be conflated with basic F5 launch.
