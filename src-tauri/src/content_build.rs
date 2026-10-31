//! Official content-mod build, deliberately separate from Cargo's executable
//! Rust build path. Build scripts are not invoked for data-only .hmod projects.
//! The selected native cargo-horizon-mod executable still requires user trust.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}},
    thread,
    time::{Duration, Instant},
};

const MAX_OUTPUT: usize = 64 * 1024;
const MAX_PACKAGE: u64 = 64 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentBuildResult {
    pub succeeded: bool,
    pub artifact_path: String,
    pub sha256: String,
    pub mod_id: String,
    pub version: String,
    pub content_api: String,
    pub static_check_passed: bool,
    pub in_game_verified: bool,
}

struct Capture(Vec<u8>, bool);

fn drain(mut stream: impl Read) -> io::Result<Capture> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let count = stream.read(&mut chunk)?;
        if count == 0 { return Ok(Capture(bytes, truncated)); }
        let room = MAX_OUTPUT.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..count.min(room)]);
        if count > room { truncated = true; }
    }
}

/// Bounded, cancellable, direct native executable, with no shell and no
/// model-controlled flags. Owned child participates in the existing Stop Build.
fn run(
    executable: &Path,
    workspace: &Path,
    arguments: &[&str],
    cancel: &Arc<AtomicBool>,
    owned: &Arc<Mutex<Option<Child>>>,
) -> Result<String, String> {
    let mut child = Command::new(executable)
        .args(arguments)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("official mod tool could not start: {e}"))?;
    let output = child.stdout.take().ok_or("missing stdout")?;
    let errors = child.stderr.take().ok_or("missing stderr")?;
    let out = thread::spawn(move || drain(output));
    let err = thread::spawn(move || drain(errors));
    {
        let mut lock = owned.lock().map_err(|_| "process lock poisoned")?;
        *lock = Some(child);
    }
    let started = Instant::now();
    let status = loop {
        let mut lock = owned.lock().map_err(|_| "process lock poisoned")?;
        let Some(child) = lock.as_mut() else {
            return Err("build process was externally terminated".into());
        };
        match child.try_wait() {
            Ok(Some(exit)) => { *lock = None; break Ok(exit); }
            Err(error) => break Err(format!("build status: {error}")),
            Ok(None) => {}
        }
        if cancel.load(Ordering::Acquire) || started.elapsed() >= TIMEOUT {
            let reason = if cancel.load(Ordering::Acquire) { "cancelled" } else { "timed out after 120 seconds" };
            let _ = child.kill();
            let _ = child.wait();
            *lock = None;
            break Err(format!("content build {reason}"));
        }
        drop(lock);
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = out.join().map_err(|_| "stdout reader panicked")?
        .map_err(|e| format!("stdout: {e}"))?;
    let stderr = err.join().map_err(|_| "stderr reader panicked")?
        .map_err(|e| format!("stderr: {e}"))?;
    if stdout.1 || stderr.1 { return Err("official tool output exceeded 64 KiB limit".into()); }
    let stdout = String::from_utf8(stdout.0).map_err(|_| "invalid output encoding")?;
    let stderr = String::from_utf8_lossy(&stderr.0);
    if !status?.success() {
        return Err(format!("official Horizon tool rejected project: {}", stderr.chars().take(500).collect::<String>()));
    }
    Ok(stdout)
}

fn digest(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() < 4 || metadata.len() > MAX_PACKAGE {
        return Err("invalid .hmod artifact size".into());
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 32768];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

fn check_report(output: &str, actual_hash: &str, artifact: &Path) -> Result<(String, String, String), String> {
    if output.len() > MAX_OUTPUT { return Err("checker reply too large".into()); }
    let response: Value = serde_json::from_str(output.trim()).map_err(|_| "invalid official checker JSON")?;
    if response["ok"].as_bool() != Some(true) { return Err("official checker rejected the .hmod".into()); }
    let data = response["report"].as_object().ok_or("missing official checker report")?;
    let field = |key| -> Result<&str, String> {
        data.get(key).and_then(Value::as_str).ok_or_else(|| format!("checker omitted {key}"))
    };
    if field("kind")? != "mod" || field("api")? != "0.2" {
        return Err("only data-only content .hmod API 0.2 can be built".into());
    }
    if response["report"]["capabilities"].as_array().is_none_or(|c|
        c.len() != 1 || c[0].as_str() != Some("registries")
    ) || !response["report"]["api_level"].is_null() {
        return Err("extra code capabilities are not allowed for this content build".into());
    }
    if !field("sha256")?.eq_ignore_ascii_case(actual_hash) {
        return Err("checker package hash differs from artifact".into());
    }
    let id = field("id")?;
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        return Err("invalid mod id reported by checker".into());
    }
    let expected_name = format!("{id}.hmod");
    if artifact.file_name().and_then(|n| n.to_str()) != Some(expected_name.as_str()) {
        return Err("artifact file name does not match the checked mod ID".into());
    }
    Ok((id.to_owned(), field("version")?.to_owned(), field("api")?.to_owned()))
}

pub fn build(
    tool_path: &Path,
    workspace: &Path,
    cancel: Arc<AtomicBool>,
    owned: Arc<Mutex<Option<Child>>>,
) -> Result<ContentBuildResult, String> {
    let tool = tool_path.canonicalize().map_err(|e| e.to_string())?;
    let binary_name = tool.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !["cargo-horizon-mod", "cargo-horizon-mod.exe"].iter().any(|s| binary_name.eq_ignore_ascii_case(s)) {
        return Err("select a trusted installed cargo-horizon-mod executable".into());
    }
    let root = workspace.canonicalize().map_err(|e| e.to_string())?;
    if !root.join("horizon-mod.toml").is_file() || root.join("Cargo.toml").exists()
        || root.join("mod.wasm").exists()
    {
        return Err("a data-only Horizon content project (horizon-mod.toml, without Cargo.toml/wasm) is required".into());
    }
    // Build the genuine upstream package, with no Rust code execution here.
    let output = run(&tool, &root, &["build"], &cancel, &owned)?;
    let built = output.lines().filter_map(|line| line.strip_prefix("Built ")).last()
        .ok_or("official tool did not report a built artifact")?;
    let reported = Path::new(built.trim());
    let file = if reported.is_absolute() { reported.to_path_buf() } else { root.join(reported) };
    let artifact = file.canonicalize().map_err(|e| format!("built .hmod not found: {e}"))?;
    let output_dir = root.join("target/horizon-mod").canonicalize()
        .map_err(|_| "official output directory not found")?;
    if artifact.parent() != Some(output_dir.as_path()) || artifact.extension().and_then(|e| e.to_str()) != Some("hmod") {
        return Err("built artifact escaped the expected target/horizon-mod directory".into());
    }
    let before = digest(&artifact)?;
    let checked = run(&tool, &root, &["check", artifact.to_str().ok_or("non-UTF8 package path")?, "--json"], &cancel, &owned)?;
    let (id, version, api) = check_report(&checked, &before, &artifact)?;
    if digest(&artifact)? != before {
        return Err("built package changed during official static validation".into());
    }
    Ok(ContentBuildResult {
        succeeded: true,
        artifact_path: artifact.display().to_string(),
        sha256: before,
        mod_id: id,
        version,
        content_api: api,
        static_check_passed: true,
        in_game_verified: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn reply(sha: &str) -> String {
        json!({"ok":true, "report":{"kind":"mod","api":"0.2","id":"ruby",
            "version":"0.1.0","sha256":sha,"capabilities":["registries"],"api_level":null}}).to_string()
    }
    #[test]
    fn check_report_requires_exact_sha_and_data_only_content() {
        let h = "a".repeat(64);
        let path = Path::new("ruby.hmod");
        assert_eq!(check_report(&reply(&h), &h, path).unwrap().0, "ruby");
        assert!(check_report(&reply(&h), &"b".repeat(64), path).is_err());
        assert!(check_report(&reply(&h), &h, Path::new("fake.hmod")).is_err());
        let bad = json!({"ok":true,"report":{"kind":"native-mod","id":"ruby",
            "api":"0.2","version":"0.1.0","sha256":h,"capabilities":["registries"]}});
        assert!(check_report(&bad.to_string(), &"a".repeat(64), path).is_err());
    }
    #[test]
    fn rejects_nonexistent_or_non_content_workspaces_before_any_tool_launch() {
        let cancel = Arc::new(AtomicBool::new(false));
        let owned = Arc::new(Mutex::new(None));
        assert!(build(Path::new("/missing/tool"), Path::new("/missing/dir"), cancel, owned).is_err());
    }
}
