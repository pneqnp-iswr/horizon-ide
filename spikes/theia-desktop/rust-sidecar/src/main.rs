//! Non-privileged protocol probe. No game launch, builds, filesystem writes or shell.
const PROBE: &str = r#"{"protocolVersion":1,"backend":"rust-sidecar","status":"ready","gameConnected":false,"viewportPlayableVerified":false,"detail":"Rust stdio transport responsive; Tauri backend migration and native viewport are not implemented."}"#;

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--probe"] {
        println!("{PROBE}");
    } else {
        eprintln!("unsupported operation");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::PROBE;
    #[test]
    fn readonly_probe_does_not_claim_gameplay() {
        assert!(PROBE.contains(r#""gameConnected":false"#));
        assert!(PROBE.contains(r#""viewportPlayableVerified":false"#));
        assert!(PROBE.contains(r#""protocolVersion":1"#));
    }
}
