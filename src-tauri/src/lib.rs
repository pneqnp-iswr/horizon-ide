mod build_runner;
mod content_build;
mod game_bridge;
mod game_control;
mod local_ai;
mod package_attestation;
mod project_starter;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
#[cfg(feature = "desktop")]
use tauri::State;

#[derive(Debug, Error)]
enum AppError {
    #[error("workspace root is not configured")]
    MissingWorkspaceRoot,
    #[error("path is outside configured workspace")]
    PathOutsideWorkspace,
    #[error("path not found: {0}")]
    MissingPath(String),
    #[error("the file changed since it was opened; reload or compare before saving")]
    RevisionConflict,
    #[error("only existing UTF-8 files of at most 2 MiB may be edited")]
    UnsupportedDocument,
    #[error("invalid document revision")]
    InvalidRevision,
    #[error("building project code requires explicit approval")]
    BuildApprovalRequired,
    #[error("a Cargo build is already in progress")]
    BuildAlreadyRunning,
    #[error("creating a starter requires explicit user approval")]
    StarterApprovalRequired,
    #[error("local AI request requires explicit approval")]
    LocalAiApprovalRequired,
    #[error("local AI request failed: {0}")]
    LocalAiFailed(String),
    #[error("the starter generator is already running")]
    StarterAlreadyRunning,
    #[error("starter creation failed: {0}")]
    StarterFailed(String),
    #[error("workspace has no Cargo.toml")]
    NotCargoWorkspace,
    #[error("isolated game smoke is already running")]
    SmokeAlreadyRunning,
    #[error("game smoke is refused while an external Horizon process is owned")]
    GameProcessActive,
    #[error("game smoke failed: {0}")]
    SmokeFailed(String),
    #[error("invalid launch request")]
    InvalidLaunchRequest,
    #[error("Horizon is already running in this IDE session")]
    GameAlreadyRunning,
    #[error("the selected Horizon Launch API is unsupported: {0}")]
    UnsupportedLaunchApi(String),
    #[error("Horizon Launch API probe timed out")]
    LaunchProbeTimeout,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[derive(Default)]
struct AppState {
    workspace_root: Mutex<Option<PathBuf>>,
    document_write_lock: Mutex<()>,
    build_running: AtomicBool,
    smoke_running: AtomicBool,
    starter_running: AtomicBool,
    build_cancel: Arc<AtomicBool>,
    build_process: Arc<Mutex<Option<Child>>>,
    game_status: Mutex<GameStatus>,
    game_process: Mutex<Option<Child>>,
    game_session_dir: Mutex<Option<PathBuf>>,
}

// The IDE owns at most one external game process. Dropping its runtime
// must not silently abandon that process, even when the UI closes without
// pressing Stop. This is best-effort on ordinary process shutdown.
impl Drop for AppState {
    fn drop(&mut self) {
        self.build_cancel.store(true, Ordering::Release);
        if let Ok(mut process) = self.build_process.lock() {
            if let Some(child) = process.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *process = None;
        }
        if let Ok(process) = self.game_process.get_mut() {
            if let Some(child) = process.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(session) = self.game_session_dir.get_mut() {
            if let Some(dir) = session.take() {
                let _ = fs::remove_dir_all(dir);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameStatus {
    Disconnected,
    Launching,
    Running,
    Error,
}

impl Default for GameStatus {
    fn default() -> Self {
        Self::Disconnected
    }
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    executable_path: String,
    args: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDiagnostic {
    level: String,
    message: String,
    file: Option<String>,
    line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    success: bool,
    cancelled: bool,
    timed_out: bool,
    output_truncated: bool,
    output: String,
    diagnostics: Vec<BuildDiagnostic>,
}

fn ensure_within_workspace(root: &Path, target: &Path) -> Result<PathBuf, AppError> {
    let canonical_root = root.canonicalize()?;
    let canonical_target = target.canonicalize().map_err(|_| AppError::MissingPath(target.display().to_string()))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::PathOutsideWorkspace);
    }
    Ok(canonical_target)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_workspace_root(path: String, state: State<AppState>) -> Result<(), AppError> {
    let target = PathBuf::from(path);
    if !target.is_dir() {
        return Err(AppError::MissingPath(target.display().to_string()));
    }
    let canonical = target.canonicalize()?;
    let mut root = state.workspace_root.lock().expect("workspace root lock poisoned");
    *root = Some(canonical);
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn list_directory(path: String, state: State<AppState>) -> Result<Vec<FileEntry>, AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned").clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let resolved = ensure_within_workspace(&root, Path::new(&path))?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(resolved)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        entries.push(FileEntry {
            path: entry.path().display().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    contents: String,
    revision: String,
}

fn content_revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_workspace_document(root: &Path, target: &Path) -> Result<DocumentSnapshot, AppError> {
    let resolved = ensure_within_workspace(root, target)?;
    let metadata = fs::metadata(&resolved)?;
    if !metadata.is_file() || metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err(AppError::UnsupportedDocument);
    }
    let bytes = fs::read(&resolved)?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::UnsupportedDocument);
    }
    let contents = String::from_utf8(bytes.clone()).map_err(|_| AppError::UnsupportedDocument)?;
    Ok(DocumentSnapshot { contents, revision: content_revision(&bytes) })
}

struct PendingTempFile(PathBuf);

impl Drop for PendingTempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Writes only existing UTF-8 files. The revision check is content-addressed:
/// concurrent IDE commands are serialized by AppState, while external editors
/// are detected if their changes occur before the final pre-rename recheck.
/// (Handle-relative filesystem operations would be needed for a complete
/// cross-process symlink race guarantee; this method does not claim one.)
fn save_workspace_document(
    root: &Path,
    target: &Path,
    expected_revision: &str,
    contents: &str,
) -> Result<DocumentSnapshot, AppError> {
    if expected_revision.len() != 64 || !expected_revision.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::InvalidRevision);
    }
    if contents.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::UnsupportedDocument);
    }
    let resolved = ensure_within_workspace(root, target)?;
    if fs::symlink_metadata(&resolved)?.file_type().is_symlink() {
        return Err(AppError::PathOutsideWorkspace);
    }
    let previous = read_workspace_document(root, &resolved)?;
    if previous.revision != expected_revision {
        return Err(AppError::RevisionConflict);
    }
    let next_revision = content_revision(contents.as_bytes());
    if next_revision == previous.revision {
        return Ok(previous);
    }
    let parent = resolved.parent().ok_or(AppError::PathOutsideWorkspace)?;
    let permissions = fs::metadata(&resolved)?.permissions();

    let (temp_guard, mut file) = {
        let mut candidate = None;
        for _ in 0..8 {
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH)
                .unwrap_or_default().as_nanos();
            let seq = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let name = format!(".horizon-ide-{}-{nanos}-{seq}.tmp", std::process::id());
            let path = parent.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => { candidate = Some((PendingTempFile(path), file)); break; }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(AppError::Io(error)),
            }
        }
        candidate.ok_or(AppError::UnsupportedDocument)?
    };

    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::set_permissions(&temp_guard.0, permissions)?;

    // Detect external changes made during temporary-file writing whenever
    // possible; never overwrite a newer version we have already observed.
    if read_workspace_document(root, &resolved)?.revision != expected_revision {
        return Err(AppError::RevisionConflict);
    }
    fs::rename(&temp_guard.0, &resolved)?;
    Ok(DocumentSnapshot { contents: contents.to_owned(), revision: next_revision })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn read_document(path: String, state: State<AppState>) -> Result<DocumentSnapshot, AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    read_workspace_document(&root, Path::new(&path))
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn write_document(
    path: String,
    contents: String,
    expected_revision: String,
    state: State<AppState>,
) -> Result<DocumentSnapshot, AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let _guard = state.document_write_lock.lock().expect("document lock poisoned");
    save_workspace_document(&root, Path::new(&path), &expected_revision, &contents)
}

/// Only an explicitly selected local Horizon client can be started. The first
/// vertical slice deliberately has no arbitrary command flags or generic
/// executable launcher; later flags must be negotiated against Launch API.
fn validated_horizon_executable(request: &LaunchRequest) -> Result<PathBuf, AppError> {
    if !request.args.is_empty() {
        return Err(AppError::InvalidLaunchRequest);
    }
    let selected = Path::new(request.executable_path.trim());
    if !selected.is_absolute() {
        return Err(AppError::InvalidLaunchRequest);
    }
    let resolved = selected
        .canonicalize()
        .map_err(|_| AppError::MissingPath(selected.display().to_string()))?;
    if !resolved.is_file() {
        return Err(AppError::InvalidLaunchRequest);
    }
    let name = resolved.file_name().and_then(|name| name.to_str());
    if !name.is_some_and(|name| {
        name.eq_ignore_ascii_case("horizon-client") || name.eq_ignore_ascii_case("horizon-client.exe")
    }) {
        return Err(AppError::InvalidLaunchRequest);
    }
    Ok(resolved)
}

/// Version-negotiated launch protocol, not proof that the renderer or a mod runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HorizonInstallationReport {
    launch_api: String,
    horizon: Option<String>,
    minecraft: Option<String>,
    compatible_for_preview: bool,
    game_load_verified: bool,
    embedded_viewport_verified: bool,
}

fn parse_horizon_launch_api(bytes: &[u8]) -> Result<HorizonInstallationReport, AppError> {
    if bytes.len() > 65_536 {
        return Err(AppError::UnsupportedLaunchApi("response too large".into()));
    }
    let parsed: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError::UnsupportedLaunchApi("invalid JSON".into()))?;
    let object = parsed.as_object()
        .ok_or_else(|| AppError::UnsupportedLaunchApi("expected object".into()))?;
    let version = object.get("launch_api").and_then(|value| value.as_str())
        .ok_or_else(|| AppError::UnsupportedLaunchApi("missing launch_api".into()))?;
    let parts = version.split('.').map(str::parse::<u16>).collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::UnsupportedLaunchApi("malformed version".into()))?;
    if parts.len() != 3 || parts[0] != 0 || (parts[1], parts[2]) < (1, 0) {
        return Err(AppError::UnsupportedLaunchApi(version.into()));
    }
    let options = object.get("options").and_then(|value| value.as_array())
        .ok_or_else(|| AppError::UnsupportedLaunchApi("options missing".into()))?;
    for required in ["--game-dir", "--home"] {
        if !options.iter().any(|value| value.get("name").and_then(|name| name.as_str()) == Some(required)) {
            return Err(AppError::UnsupportedLaunchApi(format!("missing {required}")));
        }
    }
    Ok(HorizonInstallationReport {
        launch_api: version.to_string(),
        horizon: object.get("horizon").and_then(|value| value.as_str()).map(str::to_string),
        minecraft: object.get("minecraft").and_then(|value| value.as_str()).map(str::to_string),
        compatible_for_preview: true,
        game_load_verified: false,
        embedded_viewport_verified: false,
    })
}

/// Only a selected local horizon-client is executed with --launch-api.
/// Bounded stdout and a deadline keep a malformed executable from blocking
/// the IDE indefinitely. Do not confuse this with in-game verification.
fn probe_horizon_installation(executable: &Path) -> Result<HorizonInstallationReport, AppError> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let mut child = Command::new(executable)
        .arg("--launch-api")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::UnsupportedLaunchApi("stdout unavailable".into())
    })?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut limited = stdout.take(65_537);
        let mut bytes = Vec::new();
        let read = limited.read_to_end(&mut bytes).map(|_| bytes);
        let _ = sender.send(read);
    });

    let start = Instant::now();
    let exit = loop {
        if let Some(code) = child.try_wait()? {
            break code;
        }
        if start.elapsed() >= Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::LaunchProbeTimeout);
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    if !exit.success() {
        return Err(AppError::UnsupportedLaunchApi(format!("exited with {exit}")));
    }
    let bytes = receiver.recv_timeout(Duration::from_secs(1))
        .map_err(|_| AppError::UnsupportedLaunchApi("response was not closed".into()))??;
    parse_horizon_launch_api(&bytes)
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn inspect_horizon_client(executable_path: String) -> Result<HorizonInstallationReport, AppError> {
    let executable = validated_horizon_executable(&LaunchRequest {
        executable_path,
        args: vec![],
    })?;
    // Never run a potentially slow native probe on the desktop event loop.
    tauri::async_runtime::spawn_blocking(move || probe_horizon_installation(&executable))
        .await
        .map_err(|error| AppError::UnsupportedLaunchApi(format!("probe task failed: {error}")))?
}

/// A fresh, collision-resistant directory is owned by one IDE session.
/// Never share a personal .minecraft or Horizon game directory with tests.
fn disposable_game_dir() -> Result<PathBuf, AppError> {
    for _ in 0..8 {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_nanos();
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "horizon-ide-disposable-{}-{nonce}-{sequence}", std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => {
                let setup = fs::create_dir(path.join("game"))
                    .and_then(|_| fs::create_dir(path.join("home")));
                if let Err(error) = setup {
                    let _ = fs::remove_dir_all(&path);
                    return Err(AppError::Io(error));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AppError::Io(error)),
        }
    }
    Err(AppError::InvalidLaunchRequest)
}

/// Reaps a completed child before returning the public process status.
/// Running means only that the OS process exists, not that a game world loaded.
fn refresh_game_process(state: &AppState) -> GameStatus {
    let mut process = state.game_process.lock().expect("process lock poisoned");
    let mut status = state.game_status.lock().expect("status lock poisoned");
    if let Some(child) = process.as_mut() {
        match child.try_wait() {
            Ok(Some(exit)) => {
                *process = None;
                if let Some(dir) = state.game_session_dir.lock()
                    .expect("session lock poisoned").take()
                {
                    let _ = fs::remove_dir_all(dir);
                }
                *status = if exit.success() { GameStatus::Disconnected } else { GameStatus::Error };
            }
            Ok(None) => *status = GameStatus::Running,
            Err(_) => *status = GameStatus::Error,
        }
    }
    status.clone()
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn launch_game(request: LaunchRequest, state: State<'_, AppState>) -> Result<GameStatus, AppError> {
    if state.smoke_running.load(Ordering::Acquire) {
        return Err(AppError::SmokeAlreadyRunning);
    }
    let executable = validated_horizon_executable(&request)?;
    let probe_path = executable.clone();
    tauri::async_runtime::spawn_blocking(move || probe_horizon_installation(&probe_path))
        .await
        .map_err(|error| AppError::UnsupportedLaunchApi(format!("probe task failed: {error}")))??;
    let mut process = state.game_process.lock().expect("process lock poisoned");

    if let Some(previous) = process.as_mut() {
        if previous.try_wait()?.is_none() {
            return Err(AppError::GameAlreadyRunning);
        }
        // A prior game exited: reap it before replacing the handle.
        *process = None;
    }
    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Launching;

    let session = disposable_game_dir()?;
    // Strictly isolate experimental gameplay from personal saves and account
    // state. Launch API capabilities were checked before this point.
    let spawn = Command::new(executable)
        .arg("--game-dir").arg(session.join("game"))
        .arg("--home").arg(session.join("home"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawn {
        Ok(mut child) => {
            match child.try_wait() {
                Ok(Some(_)) => {
                    let _ = child.wait();
                    let _ = fs::remove_dir_all(session);
                    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Error;
                    Ok(GameStatus::Error)
                }
                Ok(None) => {
                    *process = Some(child);
                    *state.game_session_dir.lock().expect("session lock poisoned") = Some(session);
                    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Running;
                    Ok(GameStatus::Running)
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_dir_all(session);
                    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Error;
                    Err(AppError::Io(error))
                }
            }
        }
        Err(error) => {
            let _ = fs::remove_dir_all(session);
            *state.game_status.lock().expect("status lock poisoned") = GameStatus::Error;
            Err(AppError::Io(error))
        }
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn stop_game(state: State<AppState>) -> Result<(), AppError> {
    let mut process = state.game_process.lock().expect("process lock poisoned");
    if let Some(child) = process.as_mut() {
        if child.try_wait()?.is_none() {
            child.kill()?;
        }
        // Reap before dropping the Child to avoid zombies on Unix.
        child.wait()?;
    }
    *process = None;
    if let Some(dir) = state.game_session_dir.lock().expect("session lock poisoned").take() {
        let _ = fs::remove_dir_all(dir);
    }
    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Disconnected;
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_game_status(state: State<AppState>) -> GameStatus {
    refresh_game_process(&state)
}

fn compiler_diagnostics(stdout: &str) -> Vec<BuildDiagnostic> {
    stdout.lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event.get("reason").and_then(|v| v.as_str()) == Some("compiler-message"))
        .filter_map(|event| {
            let message = event.get("message")?;
            let level = message.get("level")?.as_str()?;
            if !["error", "warning", "note", "help"].contains(&level) { return None; }
            let text = message.get("message")?.as_str()?;
            let span = message.get("spans")?.as_array()
                .and_then(|spans| spans.iter().find(|s| s.get("is_primary").and_then(|v| v.as_bool()) == Some(true)));
            Some(BuildDiagnostic {
                level: if level == "error" { "error" } else if level == "warning" { "warning" } else { "info" }.into(),
                message: text.chars().take(1000).collect(),
                file: span.and_then(|s| s.get("file_name")).and_then(|v| v.as_str()).map(str::to_string),
                line: span.and_then(|s| s.get("line_start")).and_then(|v| v.as_u64())
                    .and_then(|n| u32::try_from(n).ok()),
            })
        })
        .take(128)
        .collect()
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn run_build(
    workspace_path: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<BuildResult, AppError> {
    if !approved { return Err(AppError::BuildApprovalRequired); }
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let workspace = ensure_within_workspace(&root, Path::new(&workspace_path))?;
    if !workspace.is_dir() || !workspace.join("Cargo.toml").is_file() {
        return Err(AppError::NotCargoWorkspace);
    }
    if state.build_running.swap(true, Ordering::AcqRel) {
        return Err(AppError::BuildAlreadyRunning);
    }
    state.build_cancel.store(false, Ordering::Release);
    let cancel = state.build_cancel.clone();
    let process = state.build_process.clone();
    let task = tauri::async_runtime::spawn_blocking(move || {
        build_runner::cargo_check(&workspace, cancel, process, build_runner::DEFAULT_TIMEOUT)
    }).await;
    state.build_running.store(false, Ordering::Release);
    let captured = task.map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;

    let mut diagnostics = compiler_diagnostics(&captured.stdout);
    if diagnostics.is_empty() {
        diagnostics.push(BuildDiagnostic {
            level: if captured.success { "info" } else { "error" }.into(),
            message: if captured.cancelled {
                "Cargo build was cancelled"
            } else if captured.timed_out {
                "Cargo build exceeded the 180-second limit"
            } else if captured.success {
                "cargo check completed successfully"
            } else {
                "Cargo check failed; see build output"
            }.into(),
            file: None, line: None,
        });
    }
    let details = diagnostics.iter()
        .map(|d| format!("{}: {}{}",
            d.level,
            d.message,
            d.file.as_ref().map(|p| format!(" ({p}:{})", d.line.unwrap_or_default())).unwrap_or_default()
        ))
        .collect::<Vec<_>>().join("\n");
    let mut output = format!("{details}\n\n{}", captured.stderr);
    if captured.output_truncated {
        output.push_str("\n[Output truncated to 512 KiB per stream.]");
    }
    Ok(BuildResult {
        success: captured.success,
        cancelled: captured.cancelled,
        timed_out: captured.timed_out,
        output_truncated: captured.output_truncated,
        output,
        diagnostics,
    })
}

/// Build real data-only Horizon content with the official tool, never via
/// Cargo check. Uses the same build lock and cancellation UI as Rust builds.
#[cfg(feature = "desktop")]
#[tauri::command]
async fn build_content_mod(
    tool_path: String,
    workspace_path: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<content_build::ContentBuildResult, AppError> {
    if !approved { return Err(AppError::BuildApprovalRequired); }
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let workspace = ensure_within_workspace(&root, Path::new(&workspace_path))?;
    if workspace != root { return Err(AppError::PathOutsideWorkspace); }
    if state.build_running.swap(true, Ordering::AcqRel) {
        return Err(AppError::BuildAlreadyRunning);
    }
    state.build_cancel.store(false, Ordering::Release);
    let cancel = state.build_cancel.clone();
    let process = state.build_process.clone();
    let task = tauri::async_runtime::spawn_blocking(move || {
        content_build::build(Path::new(&tool_path), &workspace, cancel, process)
            .map_err(AppError::SmokeFailed)
    }).await;
    state.build_running.store(false, Ordering::Release);
    task.map_err(|e| AppError::SmokeFailed(e.to_string()))?
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn cancel_build(state: State<AppState>) -> bool {
    if !state.build_running.load(Ordering::Acquire) { return false; }
    state.build_cancel.store(true, Ordering::Release);
    true
}

/// Generate a new, data-only content mod from the *official tool* without
/// invoking a shell or building/running untrusted project code.
#[cfg(feature = "desktop")]
#[tauri::command]
async fn create_content_starter(
    tool_path: String,
    parent_workspace: String,
    name: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<project_starter::CreatedProject, AppError> {
    if !approved { return Err(AppError::StarterApprovalRequired); }
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    // The chosen parent is exactly the registered workspace, not arbitrary
    // filesystem space selected by untrusted webview JavaScript.
    if Path::new(&parent_workspace).canonicalize()? != root {
        return Err(AppError::PathOutsideWorkspace);
    }
    if state.starter_running.swap(true, Ordering::AcqRel) {
        return Err(AppError::StarterAlreadyRunning);
    }
    let task = tauri::async_runtime::spawn_blocking(move || {
        project_starter::generate(Path::new(&tool_path), &root, &name)
            .map_err(AppError::StarterFailed)
    }).await;
    state.starter_running.store(false, Ordering::Release);
    task.map_err(|e| AppError::StarterFailed(e.to_string()))?
}

/// Official package static check without launching Horizon. The selected
/// checker itself is trusted native code; explicit user approval is required.
#[cfg(feature = "desktop")]
#[tauri::command]
async fn check_hmod_package(
    checker_path: String,
    package_path: String,
    item_id: String,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<package_attestation::ContentAttestation, AppError> {
    if !approved { return Err(AppError::BuildApprovalRequired); }
    let checker = PathBuf::from(checker_path).canonicalize()?;
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let package = ensure_within_workspace(&root, Path::new(&package_path))?;
    tauri::async_runtime::spawn_blocking(move || {
        game_control::check_package(&checker, &package, &item_id)
            .map_err(|error| AppError::SmokeFailed(error.to_string()))
    }).await.map_err(|error| AppError::SmokeFailed(error.to_string()))?
}

/// Runs against a fresh disposable world only. No player account or
/// personal saves are intentionally used. The result is inventory-observed
/// evidence, NOT a verified package-to-item attribution.
#[cfg(feature = "desktop")]
#[tauri::command]
async fn run_game_item_smoke(
    ctl_path: String,
    game_path: String,
    checker_path: String,
    package_path: String,
    item_id: String,
    resources_path: Option<String>,
    approved: bool,
    state: State<'_, AppState>,
) -> Result<game_control::ItemSmokeReport, AppError> {
    if !approved { return Err(AppError::BuildApprovalRequired); }
    let game = validated_horizon_executable(&LaunchRequest {
        executable_path: game_path, args: vec![],
    })?;
    let ctl = PathBuf::from(ctl_path).canonicalize()?;
    let checker = PathBuf::from(checker_path).canonicalize()?;
    let selected_resources = resources_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from);
    let root = state.workspace_root.lock().expect("workspace root lock poisoned")
        .clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let package = ensure_within_workspace(&root, Path::new(&package_path))?;
    {
        let mut process = state.game_process.lock().expect("game lock poisoned");
        if let Some(child) = process.as_mut() {
            if child.try_wait()?.is_none() { return Err(AppError::GameProcessActive); }
            *process = None;
        }
    }
    if state.smoke_running.swap(true, Ordering::AcqRel) {
        return Err(AppError::SmokeAlreadyRunning);
    }
    let task = tauri::async_runtime::spawn_blocking(move || {
        // The native executable can read user files with their OS privileges;
        // caller explicitly approved this disposable session.
        probe_horizon_installation(&game)
            .map_err(|e| format!("Launch API: {e}"))?;
        game_control::smoke(&ctl, &game, &checker, &package, &item_id, selected_resources.as_deref())
            .map_err(|e| e.to_string())
    }).await;
    state.smoke_running.store(false, Ordering::Release);
    task.map_err(|error| AppError::SmokeFailed(error.to_string()))?
        .map_err(AppError::SmokeFailed)
}

/// Ask only the fixed 127.0.0.1 LM Studio / Ollama HTTP endpoints.
/// This command can never edit files, invoke build tools or reach remote hosts.
#[cfg(feature = "desktop")]
#[tauri::command]
async fn ask_local_ai(
    provider: String,
    model: String,
    prompt: String,
    document: Option<String>,
    approved: bool,
) -> Result<local_ai::LocalAiAnswer, AppError> {
    if !approved { return Err(AppError::LocalAiApprovalRequired); }
    tauri::async_runtime::spawn_blocking(move || {
        local_ai::ask(&provider, &model, &prompt, document.as_deref())
            .map_err(AppError::LocalAiFailed)
    }).await.map_err(|e| AppError::LocalAiFailed(e.to_string()))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace_root,
            list_directory,
            read_document,
            write_document,
            inspect_horizon_client,
            launch_game,
            stop_game,
            get_game_status,
            run_build,
            build_content_mod,
            cancel_build,
            ask_local_ai,
            create_content_starter,
            check_hmod_package,
            run_game_item_smoke
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("desktop feature is required to run Horizon IDE");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disposable_game_session_has_isolated_game_and_home_folders() {
        let session = disposable_game_dir().expect("create disposable session");
        assert!(session.starts_with(std::env::temp_dir()));
        assert!(session.join("game").is_dir());
        assert!(session.join("home").is_dir());
        assert!(!session.join("game").join("saves").exists());
        fs::remove_dir_all(session).expect("clean test session");
    }

    #[test]
    fn compiler_messages_have_real_file_lines_and_ignore_unrelated_json() {
        let source = concat!(
            "{\"reason\":\"compiler-message\",\"message\":{\"level\":\"error\",",
            "\"message\":\"unexpected token\",\"spans\":[{\"is_primary\":true,",
            "\"file_name\":\"src/main.rs\",\"line_start\":21}]}}\n",
            "{\"reason\":\"build-script-executed\",\"message\":{\"level\":\"error\",",
            "\"message\":\"fake\",\"spans\":[]}}\n"
        );
        let result = compiler_diagnostics(source);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].level, "error");
        assert_eq!(result[0].message, "unexpected token");
        assert_eq!(result[0].file.as_deref(), Some("src/main.rs"));
        assert_eq!(result[0].line, Some(21));
    }

    #[test]
    fn documents_save_atomically_and_refuse_stale_revision() {
        let root = std::env::temp_dir().join(format!(
            "horizon-ide-document-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("mod.rs");
        fs::write(&path, "before").unwrap();
        let first = read_workspace_document(&root, &path).unwrap();
        assert_eq!(first.contents, "before");
        assert_eq!(first.revision.len(), 64);
        let next = save_workspace_document(&root, &path, &first.revision, "after").unwrap();
        assert_eq!(next.contents, "after");
        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        assert!(matches!(
            save_workspace_document(&root, &path, &first.revision, "stale"),
            Err(AppError::RevisionConflict)
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        let entries = fs::read_dir(&root).unwrap().count();
        assert_eq!(entries, 1, "temporary artifacts must be removed");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn documents_reject_outside_paths_binary_files_and_oversized_changes() {
        let root = std::env::temp_dir().join(format!(
            "horizon-ide-security-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let binary = root.join("asset.bin");
        fs::write(&binary, [0, 159, 146, 150]).unwrap();
        assert!(matches!(read_workspace_document(&root, &binary), Err(AppError::UnsupportedDocument)));
        let outside = root.parent().unwrap();
        assert!(matches!(read_workspace_document(&root, outside), Err(AppError::PathOutsideWorkspace)));
        let source = root.join("main.rs");
        fs::write(&source, "ok").unwrap();
        let revision = read_workspace_document(&root, &source).unwrap().revision;
        assert!(matches!(
            save_workspace_document(&root, &source, &revision, &"x".repeat(MAX_DOCUMENT_BYTES + 1)),
            Err(AppError::UnsupportedDocument)
        ));
        assert!(matches!(
            save_workspace_document(&root, &source, "bad", "changed"),
            Err(AppError::InvalidRevision)
        ));
        assert_eq!(fs::read_to_string(source).unwrap(), "ok");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn launch_api_probe_checks_required_options_without_claiming_gameplay() {
        let good = br#"{"launch_api":"0.1.0","horizon":"Horizon test","minecraft":"26.3",
            "options":[{"name":"--game-dir"},{"name":"--home"}]}"#;
        let report = parse_horizon_launch_api(good).expect("valid response");
        assert_eq!(report.launch_api, "0.1.0");
        assert!(report.compatible_for_preview);
        assert!(!report.game_load_verified);
        assert!(!report.embedded_viewport_verified);
    }

    #[test]
    fn launch_api_probe_rejects_wrong_version_missing_options_and_malformed_replies() {
        for json in [
            r#"{"launch_api":"1.0.0","options":[{"name":"--game-dir"},{"name":"--home"}]}"#,
            r#"{"launch_api":"0.0.9","options":[{"name":"--game-dir"},{"name":"--home"}]}"#,
            r#"{"launch_api":"0.1.0","options":[{"name":"--game-dir"}]}"#,
            r#"{"launch_api":"0.1.0","options":null}"#,
            r#"[]"#,
            r#"not a JSON reply"#,
        ] {
            assert!(parse_horizon_launch_api(json.as_bytes()).is_err(), "{json}");
        }
    }

    #[test]
    fn game_launch_refuses_arbitrary_executables_and_flags() {
        let request = LaunchRequest {
            executable_path: "/not/horizon-client".to_string(),
            args: vec!["--help".to_string()],
        };
        assert!(matches!(validated_horizon_executable(&request), Err(AppError::InvalidLaunchRequest)));
        let request = LaunchRequest {
            executable_path: "horizon-client".to_string(),
            args: vec![],
        };
        assert!(matches!(validated_horizon_executable(&request), Err(AppError::InvalidLaunchRequest)));
    }

    #[test]
    fn status_refresh_reaps_a_child_that_exits() {
        let child = Command::new(std::env::current_exe().expect("test runner"))
            .arg("--list")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn local test runner");
        let state = AppState::default();
        *state.game_process.lock().unwrap() = Some(child);
        let mut result = GameStatus::Running;
        for _ in 0..100 {
            result = refresh_game_process(&state);
            if !matches!(result, GameStatus::Running) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(matches!(result, GameStatus::Disconnected));
        assert!(state.game_process.lock().unwrap().is_none());
    }

    #[test]
    fn game_status_refresh_has_no_game_load_claim() {
        let state = AppState::default();
        assert!(matches!(refresh_game_process(&state), GameStatus::Disconnected));
    }

    #[test]
    fn ensure_within_workspace_rejects_escape() {
        let root = std::env::temp_dir().join("horizon-ide-test-root");
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).expect("create nested");
        let outside = std::env::temp_dir();

        let result = ensure_within_workspace(&root, &outside);
        assert!(matches!(result, Err(AppError::PathOutsideWorkspace)));

        let _ = std::fs::remove_dir_all(root);
    }
}
