use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
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
    #[error("invalid launch request")]
    InvalidLaunchRequest,
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
    game_status: Mutex<GameStatus>,
    game_process: Mutex<Option<Child>>,
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

#[cfg(feature = "desktop")]
#[tauri::command]
fn read_text_file(path: String, state: State<AppState>) -> Result<String, AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned").clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let resolved = ensure_within_workspace(&root, Path::new(&path))?;
    Ok(fs::read_to_string(resolved)?)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn write_text_file(path: String, contents: String, state: State<AppState>) -> Result<(), AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned").clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let resolved = ensure_within_workspace(&root, Path::new(&path))?;
    fs::write(resolved, contents)?;
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn launch_game(request: LaunchRequest, state: State<AppState>) -> Result<GameStatus, AppError> {
    if request.executable_path.trim().is_empty() {
        *state.game_status.lock().expect("status lock poisoned") = GameStatus::Error;
        return Err(AppError::InvalidLaunchRequest);
    }

    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Launching;

    let mut command = Command::new(&request.executable_path);
    command.args(request.args.iter()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());

    match command.spawn() {
        Ok(child) => {
            *state.game_process.lock().expect("process lock poisoned") = Some(child);
            *state.game_status.lock().expect("status lock poisoned") = GameStatus::Running;
            Ok(GameStatus::Running)
        }
        Err(_) => {
            *state.game_status.lock().expect("status lock poisoned") = GameStatus::Error;
            Ok(GameStatus::Error)
        }
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn stop_game(state: State<AppState>) -> Result<(), AppError> {
    let mut process = state.game_process.lock().expect("process lock poisoned");
    if let Some(child) = process.as_mut() {
        let _ = child.kill();
    }
    *process = None;
    *state.game_status.lock().expect("status lock poisoned") = GameStatus::Disconnected;
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_game_status(state: State<AppState>) -> GameStatus {
    state.game_status.lock().expect("status lock poisoned").clone()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn run_build(workspace_path: String, state: State<AppState>) -> Result<BuildResult, AppError> {
    let root = state.workspace_root.lock().expect("workspace root lock poisoned").clone().ok_or(AppError::MissingWorkspaceRoot)?;
    let workspace = ensure_within_workspace(&root, Path::new(&workspace_path))?;

    let output = Command::new("cargo")
        .arg("check")
        .current_dir(workspace)
        .output()?;

    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    let diagnostics = if success {
        vec![BuildDiagnostic {
            level: "info".into(),
            message: "cargo check completed successfully".into(),
            file: None,
            line: None,
        }]
    } else {
        vec![BuildDiagnostic {
            level: "error".into(),
            message: "Build failed. See output for details.".into(),
            file: None,
            line: None,
        }]
    };

    Ok(BuildResult {
        success,
        output: combined,
        diagnostics,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace_root,
            list_directory,
            read_text_file,
            write_text_file,
            launch_game,
            stop_game,
            get_game_status,
            run_build
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
