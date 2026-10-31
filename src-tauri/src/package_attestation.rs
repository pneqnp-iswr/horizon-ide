//! Parse *official* cargo-horizon-mod check --json results. This module
//! never trusts a successful subprocess exit alone, nor pretends an archive
//! contains an item when only the mod namespace is known.
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentAttestation {
    pub checker: &'static str,
    pub checker_report_kind: String,
    pub mod_id: String,
    pub version: String,
    pub content_api: String,
    pub sha256: String,
    pub official_static_check_passed: bool,
    pub target_namespace_matches: bool,
    pub target_member_verified: bool,
}

fn valid_mod_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b|
        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

pub fn parse_official_check(
    output: &str,
    expected_sha256: &str,
    target_item: &str,
) -> Result<ContentAttestation, String> {
    if output.len() > 65_536 || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || expected_sha256.len() != 64
    {
        return Err("invalid checker output size or expected package hash".into());
    }
    let answer: Value = serde_json::from_str(output.trim())
        .map_err(|_| "official checker did not return one JSON object")?;
    if answer.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("official Horizon package checker rejected the package".into());
    }
    let report = answer.get("report").and_then(Value::as_object)
        .ok_or("checker reply lacks a report object")?;
    let field = |key: &str| -> Result<String, String> {
        report.get(key).and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| format!("checker report lacks {key}"))
    };
    let kind = field("kind")?;
    if kind != "mod" {
        return Err(format!("unsupported package kind {kind} (expected content mod)"));
    }
    let mod_id = field("id")?;
    if !valid_mod_id(&mod_id) || ["minecraft", "horizon", "c"].contains(&mod_id.as_str()) {
        return Err("checker returned an invalid or reserved mod ID".into());
    }
    let namespace = target_item.split(':').next().unwrap_or_default();
    if namespace != mod_id {
        return Err("requested item is not in the checked mod namespace".into());
    }
    let api = field("api")?;
    if api != "0.2" {
        return Err(format!("this test requires content API 0.2, got {api}"));
    }
    let capabilities = report.get("capabilities")
        .and_then(Value::as_array).ok_or("checker report lacks capabilities")?;
    if !capabilities.iter().any(|cap| cap.as_str() == Some("registries")) {
        return Err("content mod does not declare the registries capability".into());
    }
    let digest = field("sha256")?;
    if !digest.eq_ignore_ascii_case(expected_sha256) {
        return Err("official checker SHA-256 disagrees with selected package".into());
    }
    Ok(ContentAttestation {
        checker: "cargo-horizon-mod",
        checker_report_kind: kind,
        mod_id,
        version: field("version")?,
        content_api: api,
        sha256: digest.to_ascii_lowercase(),
        official_static_check_passed: true,
        target_namespace_matches: true,
        // Static registry acceptance and namespace agreement do NOT inspect
        // an individual item member. Keep this gate false until ZIP member
        // parsing is independently validated.
        target_member_verified: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report() -> String {
        json!({
            "ok":true,
            "report":{
                "kind":"mod","id":"ruby","version":"0.1.0","api":"0.2",
                "capabilities":["registries"],"sha256":"a".repeat(64),
                "size":512,"signed":false
            }
        }).to_string()
    }
    #[test]
    fn accepts_only_a_real_official_content_check_with_matching_digest_and_namespace() {
        let value = parse_official_check(&report(), &"a".repeat(64), "ruby:ruby").unwrap();
        assert!(value.official_static_check_passed);
        assert!(value.target_namespace_matches);
        assert!(!value.target_member_verified);
        assert_eq!(value.mod_id, "ruby");
    }
    #[test]
    fn rejects_vanilla_item_and_different_namespace() {
        for item in ["minecraft:diamond", "other:ruby", "c:ruby"] {
            assert!(parse_official_check(&report(), &"a".repeat(64), item).is_err());
        }
    }
    #[test]
    fn rejects_false_success_missing_registry_wrong_digest_and_native_mod() {
        let mut p: Value = serde_json::from_str(&report()).unwrap();
        for (key,value) in [
            ("sha256",json!("b".repeat(64))),
            ("kind",json!("native-mod")),
            ("api",json!("0.1")),
            ("capabilities",json!(["hud"])),
            ("id",json!("minecraft")),
        ] {
            let previous = p["report"][key].clone();
            p["report"][key] = value;
            assert!(parse_official_check(&p.to_string(), &"a".repeat(64), "ruby:ruby").is_err(), "{key}");
            p["report"][key] = previous;
        }
        p["ok"] = json!(false);
        assert!(parse_official_check(&p.to_string(), &"a".repeat(64), "ruby:ruby").is_err());
    }
    #[test]
    fn rejects_trailing_json_and_untrusted_failure_text() {
        assert!(parse_official_check(&(report() + "\n{}"), &"a".repeat(64), "ruby:ruby").is_err());
        assert!(parse_official_check("{\"ok\":true}", &"a".repeat(64), "ruby:ruby").is_err());
    }
}
