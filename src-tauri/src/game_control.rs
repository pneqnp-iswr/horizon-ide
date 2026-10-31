//! One-shot isolated Horizon item smoke test through the upstream horizon-ctl
//! command table. This observes exact real inventory slots but deliberately
//! does NOT claim that the item originated from the selected .hmod package.
//! Package membership + official static checks are separate acceptance gates.
use crate::game_bridge::{item_id_is_valid, parse_inventory, verify_one_added, Inventory};
use crate::package_attestation::{parse_official_check, ContentAttestation};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LIMIT: usize = 64 * 1024;
const MAX_PACKAGE: u64 = 64 * 1024 * 1024;
const WORLD: &str = "IDEPreview";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub struct SmokeError(pub String);
impl std::fmt::Display for SmokeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.0) }
}
impl std::error::Error for SmokeError {}
impl From<io::Error> for SmokeError {
    fn from(err: io::Error) -> Self { Self(format!("I/O: {err}")) }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSmokeReport {
    schema: &'static str,
    level: &'static str,
    item_id: String,
    package_sha256: String,
    static_attestation: ContentAttestation,
    package_item_origin_verified: bool,
    game_version: Option<String>,
    launch_accepted: bool,
    negative_control_refused: bool,
    exact_slot_delta: bool,
    before: u64,
    after: u64,
    changed_slots: Vec<u32>,
    session_cleaned: bool,
    notes: Vec<String>,
}

struct BoundedOutput {
    data: Vec<u8>,
    truncated: bool,
}
fn drain(mut stream: impl Read) -> io::Result<BoundedOutput> {
    let mut data = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 { break; }
        let room = LIMIT.saturating_sub(data.len());
        data.extend_from_slice(&chunk[..n.min(room)]);
        if n > room { truncated = true; }
    }
    Ok(BoundedOutput { data, truncated })
}

fn run_bounded(binary: &Path, args: &[String], timeout: Duration) -> Result<(ExitStatus, String), SmokeError> {
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| SmokeError("no stdout".into()))?;
    let stderr = child.stderr.take().ok_or_else(|| SmokeError("no stderr".into()))?;
    let out_thread = thread::spawn(move || drain(stdout));
    let err_thread = thread::spawn(move || drain(stderr));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? { break status; }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out_thread.join();
            let _ = err_thread.join();
            return Err(SmokeError("horizon-ctl command timed out".into()));
        }
        thread::sleep(Duration::from_millis(50));
    };
    let out = out_thread.join().map_err(|_| SmokeError("stdout reader panicked".into()))??;
    let err = err_thread.join().map_err(|_| SmokeError("stderr reader panicked".into()))??;
    if out.truncated || err.truncated {
        return Err(SmokeError("horizon-ctl output exceeded safety limit".into()));
    }
    let output = String::from_utf8(out.data).map_err(|_| SmokeError("invalid UTF-8 from horizon-ctl".into()))?;
    Ok((status, output))
}

fn parse_reply(success: bool, output: &str) -> Result<Value, SmokeError> {
    let last = output.lines().rev().find(|line| !line.trim().is_empty())
        .ok_or_else(|| SmokeError("horizon-ctl returned empty JSON".into()))?;
    let value: Value = serde_json::from_str(last)
        .map_err(|_| SmokeError("horizon-ctl returned invalid JSON".into()))?;
    if !value.is_object() { return Err(SmokeError("control reply must be an object".into())); }
    if !success || value.get("error").is_some() {
        // Do not interpolate untrusted game error text into a command or HTML.
        let detail = value.get("error").and_then(Value::as_str).unwrap_or("command rejected");
        return Err(SmokeError(format!("GAME_REJECTED: {}", detail.chars().take(200).collect::<String>())));
    }
    Ok(value)
}

fn call(ctl: &Path, socket: &Path, command: &[&str], timeout: Duration) -> Result<Value, SmokeError> {
    let mut args = vec!["--socket".to_string(), socket.display().to_string()];
    args.extend(command.iter().map(|a| (*a).to_owned()));
    let (status, stdout) = run_bounded(ctl, &args, timeout)?;
    parse_reply(status.success(), &stdout)
}

fn session_dir() -> Result<PathBuf, SmokeError> {
    for _ in 0..10 {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_nanos();
        let serial = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("horizon-ide-game-smoke-{}-{nanos}-{serial}", std::process::id()));
        match fs::create_dir(&dir) {
            Ok(()) => {
                if let Err(error) = fs::create_dir(dir.join("game")).and_then(|()| fs::create_dir(dir.join("home"))) {
                    let _ = fs::remove_dir_all(&dir);
                    return Err(error.into());
                }
                return Ok(dir);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(SmokeError("could not reserve a disposable game folder".into()))
}

fn file_digest(package: &Path) -> Result<String, SmokeError> {
    let metadata = fs::metadata(package)?;
    if !metadata.is_file() || metadata.len() < 4 || metadata.len() > MAX_PACKAGE {
        return Err(SmokeError("mod must be a non-empty .hmod under 64 MiB".into()));
    }
    let mut file = File::open(package)?;
    let mut header = [0u8; 4];
    file.read_exact(&mut header)?;
    if header != *b"PK\x03\x04" { return Err(SmokeError("package lacks ZIP header".into())); }
    let mut digest = Sha256::new();
    digest.update(header);
    let mut block = [0u8; 32 * 1024];
    loop {
        let count = file.read(&mut block)?;
        if count == 0 { break; }
        digest.update(&block[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_ctl(ctl: &Path, game: &Path) -> Result<(), SmokeError> {
    let ct = ctl.canonicalize()?;
    let gm = game.canonicalize()?;
    if !ct.is_file() || ct.parent() != gm.parent() {
        return Err(SmokeError("horizon-ctl and horizon-client must be installed together".into()));
    }
    let name = ct.file_name().and_then(|x| x.to_str()).unwrap_or("");
    if !["horizon-ctl", "horizon-ctl.exe"].iter().any(|n| name.eq_ignore_ascii_case(n)) {
        return Err(SmokeError("selected control executable is not horizon-ctl".into()));
    }
    Ok(())
}

/// Invoke only an explicitly approved, selected official checker. Filename is
/// not identity/authenticity: user still must trust the binary they selected.
fn official_check(checker: &Path, package: &Path, sha256: &str, item: &str) -> Result<ContentAttestation, SmokeError> {
    let path = checker.canonicalize()?;
    if !path.is_file() {
        return Err(SmokeError("checker is not a regular file".into()));
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !["cargo-horizon-mod", "cargo-horizon-mod.exe"].iter().any(|n| name.eq_ignore_ascii_case(n)) {
        return Err(SmokeError("expected official cargo-horizon-mod executable".into()));
    }
    let args = vec![
        "check".to_string(),
        package.display().to_string(),
        "--json".to_string(),
    ];
    let (status, stdout) = run_bounded(&path, &args, Duration::from_secs(45))?;
    if !status.success() {
        return Err(SmokeError("official Horizon package checker rejected this .hmod".into()));
    }
    parse_official_check(&stdout, sha256, item).map_err(SmokeError)
}

/// Standalone user-authorized official validation, with no game process.
pub fn check_package(checker: &Path, package: &Path, item: &str) -> Result<ContentAttestation, SmokeError> {
    if !item_id_is_valid(item) || package.extension().and_then(|ext| ext.to_str()) != Some("hmod") {
        return Err(SmokeError("expected a .hmod and valid namespaced item".into()));
    }
    let before = file_digest(package)?;
    let evidence = official_check(checker, package, &before, item)?;
    if file_digest(package)? != before {
        return Err(SmokeError("the .hmod changed during the official static check".into()));
    }
    Ok(evidence)
}

fn count(inventory: &Inventory, item: &str) -> u64 {
    inventory.counts.get(item).copied().unwrap_or(0)
}

/// Explicitly approved one-shot smoke against a disposable game world.
/// Never report actual package-origin verification until the archive manifest
/// and official content registry checks are connected.
pub fn smoke(ctl: &Path, game: &Path, checker: &Path, package: &Path, item: &str) -> Result<ItemSmokeReport, SmokeError> {
    if !item_id_is_valid(item) { return Err(SmokeError("invalid namespaced target item id".into())); }
    if package.extension().and_then(|e| e.to_str()) != Some("hmod") {
        return Err(SmokeError("select an existing .hmod package".into()));
    }
    validate_ctl(ctl, game)?;
    // Official static verification happens *before* creating any game world.
    let attestation = check_package(checker, package, item)?;
    let digest = attestation.sha256.clone();
    let dir = session_dir()?;
    let socket = dir.join(if cfg!(windows) { "control.json" } else { "control.sock" });
    let path_game = dir.join("game");
    let path_home = dir.join("home");
    let launch = vec![
        "launch".to_string(), "--world".into(), WORLD.into(),
        "--seed".into(), "0".into(), "--creative".into(), "--wait".into(),
        "--game".into(), game.display().to_string(),
        "--game-dir".into(), path_game.display().to_string(),
        "--home".into(), path_home.display().to_string(),
        "--offscreen".into(),
        "--dev-mod".into(), package.display().to_string(),
    ];

    // The launch command starts a separate game process. If it refuses, no
    // ownership is established and we remove only the newly created folder.
    let launched = run_bounded(ctl, &[vec!["--socket".into(), socket.display().to_string()], launch].concat(), Duration::from_secs(180))
        .and_then(|(status, stdout)| parse_reply(status.success(), &stdout));
    let launched = match launched {
        Ok(reply) => reply,
        Err(error) => {
            // The control process could have spawned the actual game before
            // itself failing or timing out. Never delete a potentially live
            // session without confirming a successful quit.
            let quit = call(ctl, &socket, &["quit"], Duration::from_secs(15));
            if quit.is_ok() {
                let _ = fs::remove_dir_all(&dir);
            }
            let message = if quit.is_ok() {
                format!("launch failed: {error}; temporary session closed")
            } else {
                format!("launch failed: {error}; session may remain active at {}", dir.display())
            };
            return Err(SmokeError(message));
        }
    };

    let result = (|| -> Result<ItemSmokeReport, SmokeError> {
        call(ctl, &socket, &["wait-for", "loaded", "--timeout", "120"], Duration::from_secs(150))?;
        let before = parse_inventory(&call(ctl, &socket, &["inventory"], Duration::from_secs(15))?)
            .map_err(|e| SmokeError(e.to_string()))?;
        let namespace = item.split(':').next().unwrap_or("ide");
        let absent = format!("{namespace}:ide_missing_{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
        let control_refused = matches!(
            call(ctl, &socket, &["give", &absent, "1"], Duration::from_secs(15)),
            Err(SmokeError(message)) if message.starts_with("GAME_REJECTED:")
        );
        if !control_refused {
            return Err(SmokeError("negative-control item was not explicitly rejected by the game".into()));
        }
        call(ctl, &socket, &["give", item, "1"], Duration::from_secs(15))?;
        let mut observed = None;
        for _ in 0..20 {
            let reply = call(ctl, &socket, &["inventory"], Duration::from_secs(15))?;
            let after = parse_inventory(&reply).map_err(|e| SmokeError(e.to_string()))?;
            if let Ok(slots) = verify_one_added(&before, &after, item) {
                observed = Some((after, slots));
                break;
            }
            thread::sleep(Duration::from_millis(250));
        }
        let (after, changed_slots) = observed.ok_or_else(||
            SmokeError("game did not confirm an exact item increase in a real inventory slot".into()))?;
        if file_digest(package)? != digest {
            return Err(SmokeError("the .hmod was modified during the test; evidence invalid".into()));
        }
        Ok(ItemSmokeReport {
            schema: "horizon-ide.item-smoke/1",
            level: "inventory-observed",
            item_id: item.to_owned(),
            package_sha256: digest,
            static_attestation: attestation,
            package_item_origin_verified: false,
            game_version: launched.get("version").and_then(Value::as_str).map(str::to_owned),
            launch_accepted: true,
            negative_control_refused: control_refused,
            exact_slot_delta: true,
            before: count(&before, item),
            after: count(&after, item),
            changed_slots,
            session_cleaned: false,
            notes: vec![
                "The real game returned consistent inventory slots and exact item delta.".into(),
                "Official static registry checks passed and mod ID matched the target namespace, but an exact item member and package origin are NOT yet verified.".into(),
                "External process; no interactive in-window viewport or gameplay events verified.".into(),
            ],
        })
    })();
    // Quit regardless of assertion success. Never kill an arbitrary PID
    // reported by the unversioned control protocol.
    let quit = call(ctl, &socket, &["quit"], Duration::from_secs(25));
    let cleaned = quit.is_ok() && fs::remove_dir_all(&dir).is_ok();
    match result {
        Ok(mut report) => {
            report.session_cleaned = cleaned;
            if !cleaned {
                report.notes.push(format!(
                    "Session cleanup was not confirmed. Manual inspection required at {}",
                    dir.display()
                ));
            }
            Ok(report)
        }
        Err(error) => Err(SmokeError(format!(
            "{}; game quit {}",
            error,
            if quit.is_ok() { "requested".to_string() } else { format!("NOT confirmed; inspect {}", dir.display()) }
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refuses_non_archive_and_invalid_target_before_any_session() {
        assert!(smoke(Path::new("missing"), Path::new("missing"),
            Path::new("missing_checker"), Path::new("mod.hmod"), "../fake").is_err());
    }

    #[test]
    fn reply_rejects_success_false_and_malformed_reply() {
        assert_eq!(parse_reply(true, "{\"ok\":true}\n").unwrap()["ok"], json!(true));
        assert!(parse_reply(true, "[]\n").is_err());
        assert!(parse_reply(true, "{\"error\":\"unknown item\"}\n").is_err());
        assert!(parse_reply(true, "not-json").is_err());
        assert!(parse_reply(false, "{\"ok\":true}\n").is_err());
    }
}
