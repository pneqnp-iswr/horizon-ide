//! Bounded Cargo runner. A Cargo build is *execution of untrusted project code*
//! (build.rs and procedural macros), never a safe static-only operation.
//! The caller must explicitly ask the person and supply approval.
use std::{
    io::{self, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub const MAX_STREAM_BYTES: usize = 512 * 1024;
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);

pub struct Captured {
    pub data: Vec<u8>,
    pub truncated: bool,
}

fn capture_bounded(mut reader: impl Read) -> io::Result<Captured> {
    let mut data = Vec::new();
    let mut truncated = false;
    let mut buffer = [0u8; 8 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 { break; }
        let take = count.min(MAX_STREAM_BYTES.saturating_sub(data.len()));
        data.extend_from_slice(&buffer[..take]);
        if take < count { truncated = true; }
    }
    Ok(Captured { data, truncated })
}

pub struct CargoOutcome {
    pub success: bool,
    pub cancelled: bool,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
}

fn outcome_capture(handle: thread::JoinHandle<io::Result<Captured>>) -> io::Result<Captured> {
    handle.join().map_err(|_| io::Error::other("Cargo output worker panicked"))?
}

/// Run Cargo without a shell, bounded in time and captured bytes.
/// The shared Child slot allows AppState::drop to terminate the direct child
/// on an ordinary IDE shutdown. Child descendants/process-tree cleanup needs
/// platform-specific work, tracked separately.
pub fn cargo_check(
    workspace: &Path,
    cancel: Arc<AtomicBool>,
    owned_child: Arc<Mutex<Option<Child>>>,
    timeout: Duration,
) -> io::Result<CargoOutcome> {
    let mut child = Command::new("cargo")
        .args(["check", "--locked", "--message-format=json"])
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| io::Error::other("Cargo stdout unavailable"))?;
    let stderr = child.stderr.take().ok_or_else(|| io::Error::other("Cargo stderr unavailable"))?;
    let out = thread::spawn(move || capture_bounded(stdout));
    let err = thread::spawn(move || capture_bounded(stderr));

    {
        let mut guard = owned_child.lock().expect("Cargo child lock poisoned");
        *guard = Some(child);
    }
    let started = Instant::now();
    let mut cancelled = false;
    let mut timed_out = false;

    let exit = loop {
        let mut guard = owned_child.lock().expect("Cargo child lock poisoned");
        let Some(child) = guard.as_mut() else {
            // App is shutting down and has already reaped the child.
            return Err(io::Error::other("Cargo process stopped outside the build runner"));
        };
        if let Some(status) = child.try_wait()? {
            *guard = None;
            break status;
        }
        if cancel.load(Ordering::Acquire) || started.elapsed() > timeout {
            cancelled = cancel.load(Ordering::Acquire);
            timed_out = !cancelled;
            let _ = child.kill();
            let status = child.wait()?;
            *guard = None;
            break status;
        }
        drop(guard);
        thread::sleep(Duration::from_millis(75));
    };

    let stdout = outcome_capture(out)?;
    let stderr = outcome_capture(err)?;
    Ok(CargoOutcome {
        success: exit.success() && !cancelled && !timed_out,
        cancelled,
        timed_out,
        stdout: String::from_utf8_lossy(&stdout.data).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.data).into_owned(),
        output_truncated: stdout.truncated || stderr.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn capture_limits_bytes_even_when_producer_writes_more() {
        let bytes = vec![b'x'; MAX_STREAM_BYTES + 150_000];
        let captured = capture_bounded(Cursor::new(bytes)).unwrap();
        assert!(captured.truncated);
        assert_eq!(captured.data.len(), MAX_STREAM_BYTES);
    }

    #[test]
    fn capture_exact_limit_is_not_truncated() {
        let captured = capture_bounded(Cursor::new(vec![7; MAX_STREAM_BYTES])).unwrap();
        assert!(!captured.truncated);
    }
}
