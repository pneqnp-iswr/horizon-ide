//! Windows-only opt-in native child-window hosting experiment.
//! This operates on the HWND of the *exact Horizon Child PID owned by the IDE*.
//! A successful SetParent means only Win32 reparenting, NOT WGPU/gameplay proof.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReport {
    pub attached_native_window: bool,
    pub playable_verified: bool,
    pub game_pid: u32,
    pub message: String,
}

pub fn valid_rect(rect: ViewportRect, host_width: i32, host_height: i32) -> bool {
    rect.x >= 0 && rect.y >= 0 && rect.width >= 240 && rect.height >= 160
        && host_width >= 320 && host_height >= 200
        && rect.x.checked_add(rect.width).is_some_and(|x| x <= host_width)
        && rect.y.checked_add(rect.height).is_some_and(|y| y <= host_height)
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{valid_rect, HostReport, ViewportRect};
    use crate::game_window;
    use std::io;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn IsWindow(hwnd: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
        fn GetClientRect(hwnd: isize, rectangle: *mut Rect) -> i32;
        fn GetWindowRect(hwnd: isize, rectangle: *mut Rect) -> i32;
        fn GetParent(hwnd: isize) -> isize;
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn SetParent(child: isize, parent: isize) -> isize;
        fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
        fn GetWindowDpiAwarenessContext(hwnd: isize) -> isize;
        fn AreDpiAwarenessContextsEqual(a: isize, b: isize) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetLastError(code: u32);
        fn GetLastError() -> u32;
    }

    const GWL_STYLE: i32 = -16;
    const WS_CHILD: isize = 0x4000_0000;
    const WS_POPUP: isize = 0x8000_0000_u32 as isize;
    const WS_CAPTION: isize = 0x00C0_0000;
    const WS_THICKFRAME: isize = 0x0004_0000;
    const WS_SYSMENU: isize = 0x0008_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOZORDER: u32 = 0x0004;

    #[derive(Debug)]
    pub struct HostedWindow {
        pub(super) pid: u32,
        hwnd: isize,
        host: isize,
        previous_parent: isize,
        previous_style: isize,
        previous_position: Rect,
    }

    fn error(prefix: &str) -> String { format!("{prefix}: {}", io::Error::last_os_error()) }

    fn belongs_to(hwnd: isize, expected_pid: u32) -> bool {
        if hwnd == 0 || expected_pid == 0 || unsafe { IsWindow(hwnd) } == 0 { return false; }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        pid == expected_pid
    }

    fn validate_bounds(host: isize, region: ViewportRect) -> Result<(), String> {
        if host == 0 || unsafe { IsWindow(host) } == 0 {
            return Err("the Horizon IDE native host window is unavailable".into());
        }
        let mut bounds = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        if unsafe { GetClientRect(host, &mut bounds) } == 0 {
            return Err(error("could not measure the native IDE host"));
        }
        if !valid_rect(region, bounds.right.saturating_sub(bounds.left), bounds.bottom.saturating_sub(bounds.top)) {
            return Err("requested game region is outside the IDE native client area or too small".into());
        }
        Ok(())
    }

    fn position(hwnd: isize, region: ViewportRect, zorder: bool) -> Result<(), String> {
        let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
            | if zorder { 0 } else { SWP_NOZORDER };
        if unsafe { SetWindowPos(hwnd, 0, region.x, region.y, region.width, region.height, flags) } == 0 {
            return Err(error("could not position native Horizon window"));
        }
        Ok(())
    }

    impl HostedWindow {
        pub fn pid(&self) -> u32 { self.pid }
        pub fn resize(&self, region: ViewportRect) -> Result<HostReport, String> {
            if !belongs_to(self.hwnd, self.pid) {
                return Err("the owned Horizon window no longer exists or changed process".into());
            }
            if unsafe { GetParent(self.hwnd) } != self.host {
                return Err("Horizon HWND is no longer a child of this IDE window; refusing to move it".into());
            }
            validate_bounds(self.host, region)?;
            position(self.hwnd, region, true)?;
            Ok(HostReport { attached_native_window: true, playable_verified: false, game_pid: self.pid,
                message: "Native Win32 child resized; real WGPU rendering and game controls remain unverified".into() })
        }
        pub fn detach(&self) -> Result<(), String> {
            if !belongs_to(self.hwnd, self.pid) { return Ok(()); }
            if unsafe { GetParent(self.hwnd) } != self.host {
                return Err("game HWND parent changed outside Horizon IDE; refusing to mutate foreign state".into());
            }
            // Restore the original style/parent and original screen coordinates;
            // never close or kill the user's game simply to detach a viewport.
            unsafe { SetLastError(0) };
            unsafe { SetParent(self.hwnd, self.previous_parent) };
            if unsafe { GetLastError() } != 0 {
                return Err(error("could not detach the game window"));
            }
            unsafe { SetWindowLongPtrW(self.hwnd, GWL_STYLE, self.previous_style) };
            let old = self.previous_position;
            if unsafe { SetWindowPos(self.hwnd, 0, old.left, old.top,
                old.right.saturating_sub(old.left), old.bottom.saturating_sub(old.top),
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED) } == 0 {
                return Err(error("restored parent but could not restore window placement"));
            }
            Ok(())
        }
    }

    pub fn attach(host: isize, game_pid: u32, region: ViewportRect) -> Result<HostedWindow, String> {
        validate_bounds(host, region)?;
        let candidate = game_window::probe(Some(game_pid)).selected
            .ok_or("no usable visible top-level HWND for the exact game process")?;
        let handle = candidate.native_handle.strip_prefix("0x")
            .ok_or("unexpected native window handle format")?;
        let hwnd = usize::from_str_radix(handle, 16)
            .map_err(|_| "invalid platform window handle")? as isize;
        if !belongs_to(hwnd, game_pid) {
            return Err("Horizon window PID changed before native attach".into());
        }
        // Windows cross-process SetParent can FORCE a process DPI reset.
        // Reject differently aware windows instead of gambling on an unsafe
        // forced reset of the game/client rendering process.
        let child_dpi = unsafe { GetWindowDpiAwarenessContext(hwnd) };
        let host_dpi = unsafe { GetWindowDpiAwarenessContext(host) };
        if child_dpi == 0 || host_dpi == 0
            || unsafe { AreDpiAwarenessContextsEqual(child_dpi, host_dpi) } == 0 {
            return Err("Horizon and IDE use different/unknown DPI awareness; native embedding refused".into());
        }

        let mut old = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        if unsafe { GetWindowRect(hwnd, &mut old) } == 0 {
            return Err(error("could not capture original game window placement"));
        }
        let previous_style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
        let previous_parent = unsafe { GetParent(hwnd) };
        unsafe { SetLastError(0) };
        // The genuine game needs client-area pixels, not an extra desktop
        // caption/titlebar nested inside the IDE. Restore every bit on detach.
        let decorations = WS_POPUP | WS_CAPTION | WS_THICKFRAME
            | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
        unsafe { SetWindowLongPtrW(hwnd, GWL_STYLE, (previous_style & !decorations) | WS_CHILD) };
        if unsafe { GetLastError() } != 0 {
            return Err(error("could not set child-window style"));
        }
        unsafe { SetLastError(0) };
        unsafe { SetParent(hwnd, host) };
        if unsafe { GetLastError() } != 0 {
            unsafe { SetWindowLongPtrW(hwnd, GWL_STYLE, previous_style) };
            return Err(error("native SetParent refused game surface"));
        }
        let attached = HostedWindow { pid: game_pid, hwnd, host,
            previous_parent, previous_style, previous_position: old };
        if let Err(e) = attached.resize(region) {
            let _ = attached.detach();
            return Err(e);
        }
        Ok(attached)
    }

    pub use HostedWindow as PlatformHostedWindow;
}

#[cfg(target_os = "windows")]
pub use windows::PlatformHostedWindow as HostedWindow;

#[cfg(target_os = "windows")]
pub fn attach_game(host: isize, game_pid: u32, region: ViewportRect) -> Result<HostedWindow, String> {
    windows::attach(host, game_pid, region)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_invalid_or_overflowing_native_viewport_coordinates() {
        assert!(valid_rect(ViewportRect { x: 0, y: 0, width: 640, height: 480 }, 1200, 800));
        for rect in [
            ViewportRect { x: -1, y: 0, width: 640, height: 480 },
            ViewportRect { x: 0, y: 0, width: 100, height: 480 },
            ViewportRect { x: 900, y: 0, width: 640, height: 480 },
            ViewportRect { x: i32::MAX, y: 0, width: 640, height: 480 },
        ] {
            assert!(!valid_rect(rect, 1200, 800));
        }
    }
}
