//! Generate an authentic Horizon content starter using the upstream
//! cargo-horizon-mod executable, never a copied/invented template.
//! A unique staging root ensures the official generator sees the exact final
//! directory basename while the workspace project remains unpublished until
//! its manifest is checked.
use serde::Serialize;
use std::{
    fs,
    io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    pub path: String,
    pub mod_id: String,
    pub manifest_path: String,
    pub template: &'static str,
    pub game_load_verified: bool,
}

fn valid_slug(name: &str) -> bool {
    !name.is_empty() && name.len() <= 40 &&
    name.as_bytes()[0].is_ascii_lowercase() &&
    name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

pub fn generate(executable: &Path, workspace: &Path, name: &str) -> Result<CreatedProject, String> {
    if !valid_slug(name) {
        return Err("project name must start with a-z, then use a-z, 0-9, underscore or hyphen (max 40)".into());
    }
    let tool = executable.canonicalize().map_err(|e| format!("checker: {e}"))?;
    let file_name = tool.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !tool.is_file() ||
        !["cargo-horizon-mod", "cargo-horizon-mod.exe"].iter().any(|n| file_name.eq_ignore_ascii_case(n))
    {
        return Err("select the trusted official cargo-horizon-mod executable".into());
    }
    let root = workspace.canonicalize().map_err(|e| format!("workspace: {e}"))?;
    if !root.is_dir() { return Err("workspace root must be an existing directory".into()); }
    let target = root.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err("project destination already exists; refusing to overwrite it".into());
    }
    let stage = (0..12).find_map(|_| {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let dir = root.join(format!(".horizon-ide-new-{}-{nanos}-{seq}", std::process::id()));
        match fs::create_dir(&dir) {
            Ok(()) => Some(Ok(dir)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => None,
            Err(error) => Some(Err(error.to_string())),
        }
    }).ok_or("could not reserve staging directory")??;

    let staged_project = stage.join(name);
    let mut child = match Command::new(&tool)
        .arg("new")
        .arg(&staged_project)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir(&stage);
            return Err(format!("could not start generator: {error}"));
        }
    };
    let start = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() >= Duration::from_secs(25) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Horizon template generator timed out".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("generator process: {error}"));
            }
        }
    };
    match result {
        Err(error) => return Err(format!("{error}. Staging directory retained for inspection: {}", stage.display())),
        Ok(status) if !status.success() => return Err(format!(
            "official generator returned {status}; inspect staging directory {}", stage.display()
        )),
        Ok(_) => {}
    }

    let manifest = staged_project.join("horizon-mod.toml");
    let expected_id = name.replace('-', "_");
    let text = fs::read_to_string(&manifest).map_err(|e| format!(
        "official template did not contain a readable manifest: {e}; staging {}", stage.display()
    ))?;
    if !text.lines().any(|line| line.trim() == format!("id = \"{expected_id}\""))
        || !text.lines().any(|line| line.trim() == "capabilities = [\"registries\"]")
        || staged_project.join("Cargo.toml").exists()
        || staged_project.join("mod.wasm").exists()
    {
        return Err(format!("unexpected generated project; staging retained at {}", stage.display()));
    }
    // Same-filesystem atomic rename: no incomplete project is intentionally
    // published in the workspace. An external actor racing the destination
    // between this check and rename still needs handle-based protection.
    if fs::symlink_metadata(&target).is_ok() {
        return Err("project destination appeared while generating; refusing overwrite".into());
    }
    fs::rename(&staged_project, &target)
        .map_err(|e| format!("cannot publish generated project: {e}; staging {}", stage.display()))?;
    let _ = fs::remove_dir(&stage);
    Ok(CreatedProject {
        manifest_path: target.join("horizon-mod.toml").display().to_string(),
        path: target.display().to_string(),
        mod_id: expected_id,
        template: "official-horizon-content",
        game_load_verified: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_directory_basename_only() {
        for name in ["ruby", "ruby_mod", "ruby-world"] {
            assert!(valid_slug(name), "{name}");
        }
        for name in ["", "../escape", "/absolute", "a/../b", "RUBY", ".hidden", "my mod", "a:b"] {
            assert!(!valid_slug(name), "{name}");
        }
    }

    #[test]
    fn staged_generator_publishes_a_manifest_and_refuses_overwrite() {
        let serial = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let parent = std::env::temp_dir().join(format!("horizon-starter-test-{}-{serial}", std::process::id()));
        let bin = parent.join("bin");
        let workspace = parent.join("workspace");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir(&workspace).unwrap();
        let src = bin.join("fake.rs");
        let executable = bin.join(if cfg!(windows) { "cargo-horizon-mod.exe" } else { "cargo-horizon-mod" });
        let fixture = r#"
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "new" { std::process::exit(2); }
    let folder = std::path::PathBuf::from(&args[2]);
    if folder.exists() { std::process::exit(3); }
    std::fs::create_dir(&folder).unwrap();
    let name = folder.file_name().unwrap().to_string_lossy().replace('-', "_");
    std::fs::write(folder.join("horizon-mod.toml"), format!(
        "id = \"{}\"\nname = \"Fixture\"\napi = \"0.2\"\ncapabilities = [\"registries\"]\n",
        name,
    )).unwrap();
}
"#;
        fs::write(&src, fixture).unwrap();
        let build = Command::new("rustc").arg(&src).arg("-o").arg(&executable)
            .stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
        assert!(build.success(), "controlled fixture compiler must succeed");
        let created = generate(&executable, &workspace, "ruby-mod").unwrap();
        assert_eq!(created.mod_id, "ruby_mod");
        assert!(!created.game_load_verified);
        assert_eq!(created.template, "official-horizon-content");
        assert!(Path::new(&created.manifest_path).is_file());
        let before = fs::read_to_string(&created.manifest_path).unwrap();
        assert!(generate(&executable, &workspace, "ruby-mod").is_err());
        assert_eq!(fs::read_to_string(&created.manifest_path).unwrap(), before);
        assert_eq!(fs::read_dir(&workspace).unwrap().count(), 1, "staging folder was removed");
        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn refuses_any_invalid_name_before_invoking_a_binary() {
        assert!(generate(Path::new("/no/tool"), Path::new("/no/workspace"), "../target").is_err());
    }
}
