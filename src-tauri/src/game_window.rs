//! Native game-window discovery for Windows (no screenshot or fake canvas).
//! Only windows owned by the exact Child PID that Horizon IDE launched are
//! considered. This is a prerequisite for a later, separately opt-in,
 //! interactive native viewport; discovery is NOT embedding or game loading.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowCandidate {
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub visible: bool,
    pub top_level: bool,
    pub process_id: u32,
    // A string descriptor, never an executable handle accepted from the UI.
    pub native_handle: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameWindowProbe {
    pub status: &'static str,
    pub process_id: Option<u32>,
    pub selected: Option<WindowCandidate>,
    pub candidate_count: usize,
    pub embedded: bool,
    pub playable_verified: bool,
    pub warning: &'static str,
}

const WARNING: &str = "Window discovery does not prove rendering, game-world load, input support or native embedding.";

fn score(window: &WindowCandidate, expected_pid: u32) -> Option<(u64, bool)> {
    if expected_pid == 0 || window.process_id != expected_pid || !window.visible || !window.top_level
        || window.width < 320 || window.height < 180 {
        return None;
    }
    Some((u64::from(window.width) * u64::from(window.height), !window.title.is_empty()))
}

pub fn select_window(candidates: &[WindowCandidate], pid: u32) -> Option<WindowCandidate> {
    candidates.iter().filter_map(|candidate| {
        score(candidate, pid).map(|score| (candidate, score))
    }).max_by_key(|(_, (pixels, titled))| (*pixels, *titled))
      .map(|(candidate, _)| candidate.clone())
}

pub fn probe(process_id: Option<u32>) -> GameWindowProbe {
    let Some(pid) = process_id else {
        return GameWindowProbe {
            status: "not-running", process_id: None, selected: None,
            candidate_count: 0, embedded: false, playable_verified: false, warning: WARNING,
        };
    };
    let candidates = platform::enumerate(pid);
    let candidate_count = candidates.len();
    let chosen = select_window(&candidates, pid);
    #[cfg(target_os = "windows")]
    let status = if chosen.is_some() { "native-window-found" } else { "no-native-window" };
    #[cfg(not(target_os = "windows"))]
    let status = "unsupported-platform";
    GameWindowProbe {
        status,
        process_id: Some(pid),
        selected: chosen,
        candidate_count,
        embedded: false,
        playable_verified: false,
        warning: WARNING,
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::WindowCandidate;
    pub(super) fn enumerate(_pid: u32) -> Vec<WindowCandidate> { Vec::new() }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::WindowCandidate;

    #[repr(C)]
    struct Rect {
        left: i32, top: i32, right: i32, bottom: i32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(isize, isize) -> i32>, data: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindow(hwnd: isize, command: u32) -> isize;
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
    }

    struct Scan {
        pid: u32,
        candidates: Vec<WindowCandidate>,
    }

    // EnumWindows may visit application-owned browser/tool windows. Filter by
    // exact PID, top-level style and usable client rectangle, not by title.
    unsafe extern "system" fn callback(hwnd: isize, data: isize) -> i32 {
        if data == 0 { return 0; }
        let scan = unsafe { &mut *(data as *mut Scan) };
        if hwnd == 0 { return 1; }

        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid != scan.pid || unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        const GW_OWNER: u32 = 4;
        const GWL_STYLE: i32 = -16;
        const WS_CHILD: isize = 0x4000_0000;
        if unsafe { GetWindow(hwnd, GW_OWNER) } != 0
            || unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & WS_CHILD != 0 {
            return 1;
        }

        let mut rect = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        if unsafe { GetClientRect(hwnd, &mut rect) } == 0 {
            return 1;
        }
        let width = rect.right.saturating_sub(rect.left) as u32;
        let height = rect.bottom.saturating_sub(rect.top) as u32;
        if width == 0 || height == 0 { return 1; }

        let len = unsafe { GetWindowTextLengthW(hwnd) }.clamp(0, 512);
        let mut buffer = vec![0u16; (len + 1) as usize];
        let count = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), len + 1) };
        let title = String::from_utf16_lossy(&buffer[..count.max(0) as usize]);
        scan.candidates.push(WindowCandidate {
            title, width, height, visible: true, top_level: true,
            process_id: pid, native_handle: format!("0x{:X}", hwnd as usize),
        });
        1
    }

    pub(super) fn enumerate(pid: u32) -> Vec<WindowCandidate> {
        let mut scan = Scan { pid, candidates: Vec::new() };
        // SAFETY: synchronous callback receives a pointer to a live Scan
        // exclusively owned by this thread; it is never retained.
        unsafe { EnumWindows(Some(callback), &mut scan as *mut Scan as isize) };
        scan.candidates
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(pid: u32, title: &str, w: u32, h: u32) -> WindowCandidate {
        WindowCandidate {
            title: title.into(), width: w, height: h, visible: true,
            top_level: true, process_id: pid, native_handle: "0xF00".into(),
        }
    }

    #[test]
    fn chooses_only_usable_windows_from_exact_owned_process() {
        let mut hidden = window(22, "Hidden", 6000, 4000);
        hidden.visible = false;
        let mut child = window(22, "Popup child", 5000, 4000);
        child.top_level = false;
        let candidates = [window(44, "Wrong process", 9000, 9000),
            hidden, child, window(22, "Horizon", 1280, 720), window(22, "", 200, 100)];
        let chosen = select_window(&candidates, 22).unwrap();
        assert_eq!(chosen.title, "Horizon");
        assert_eq!(chosen.width, 1280);
        assert!(select_window(&candidates, 9999).is_none());
    }

    #[test]
    fn a_not_running_game_cannot_discover_or_claim_embedding() {
        let report = probe(None);
        assert_eq!(report.status, "not-running");
        assert!(report.selected.is_none());
        assert!(!report.embedded);
        assert!(!report.playable_verified);
    }

    #[test]
    fn an_invalid_pid_never_selects_a_window() {
        assert!(select_window(&[window(0, "Horizon", 1280, 720)], 0).is_none());
    }
}
