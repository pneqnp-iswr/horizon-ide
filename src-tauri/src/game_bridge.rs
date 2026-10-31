//! Strict validation for Horizon's (currently unversioned) agent-control inventory
//! replies. Unlike a successful "give" command, an exact inventory delta
//! demonstrates that a real slot changed. It is not yet proof of package origin.
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stack {
    pub item: String,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inventory {
    pub slots: BTreeMap<u32, Stack>,
    pub carried: Option<Stack>,
    pub counts: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InventoryError(pub String);

impl std::fmt::Display for InventoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for InventoryError {}

pub fn item_id_is_valid(id: &str) -> bool {
    let mut split = id.split(':');
    let Some(namespace) = split.next() else { return false };
    let Some(item) = split.next() else { return false };
    if split.next().is_some() || namespace.is_empty() || item.is_empty() || id.len() > 256 {
        return false;
    }
    let valid_namespace = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || "_.-".contains(c);
    let valid_path = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || "_./-".contains(c);
    namespace.chars().all(valid_namespace)
        && item.chars().all(valid_path)
        && !item.starts_with('/')
        && !item.ends_with('/')
        && !item.split('/').any(|segment| segment == "." || segment == ".." || segment.is_empty())
}

fn stack_from(value: &Value, context: &str) -> Result<Option<Stack>, InventoryError> {
    if value.is_null() { return Ok(None); }
    let object = value.as_object().ok_or_else(|| InventoryError(format!("{context}: expected stack object")))?;
    if object.get("item").is_none_or(Value::is_null) { return Ok(None); }
    let item = object.get("item").and_then(Value::as_str).ok_or_else(||
        InventoryError(format!("{context}: missing item id")))?;
    if !item_id_is_valid(item) { return Err(InventoryError(format!("{context}: invalid item id"))); }
    let count = object.get("count").and_then(Value::as_u64).ok_or_else(||
        InventoryError(format!("{context}: invalid count")))?;
    if count == 0 || count > i32::MAX as u64 {
        return Err(InventoryError(format!("{context}: out-of-range count")));
    }
    Ok(Some(Stack { item: item.to_owned(), count }))
}

pub fn parse_inventory(value: &Value) -> Result<Inventory, InventoryError> {
    let object = value.as_object().ok_or_else(|| InventoryError("inventory: expected JSON object".into()))?;
    let mut slots = BTreeMap::new();
    for (group, range) in [
        ("hotbar", 0u32..9u32),
        ("main", 9..36),
        ("armor", 500..504),
        ("offhand", 504..505),
    ] {
        let raw = object.get(group).ok_or_else(|| InventoryError(format!("missing {group}")))?;
        let entries: Vec<&Value> = if group == "offhand" {
            vec![raw]
        } else {
            raw.as_array()
                .ok_or_else(|| InventoryError(format!("{group}: expected array")))?
                .iter().collect()
        };
        if entries.len() != range.len() {
            return Err(InventoryError(format!("{group}: incorrect number of slots")));
        }
        for (number, entry) in range.zip(entries) {
            let slot = entry.get("slot").and_then(Value::as_u64);
            if slot != Some(number as u64) || entry.get("slot").is_some_and(Value::is_boolean) {
                return Err(InventoryError(format!("{group}: incorrect slot number")));
            }
            if let Some(stack) = stack_from(entry, &format!("slot {number}"))? {
                if slots.insert(number, stack).is_some() {
                    return Err(InventoryError("duplicate slot".into()));
                }
            }
        }
    }
    let carried = stack_from(object.get("carried").unwrap_or(&Value::Null), "carried")?;
    let provided = object.get("counts").and_then(Value::as_object)
        .ok_or_else(|| InventoryError("inventory: missing counts".into()))?;
    let mut counts = BTreeMap::new();
    for (id, count) in provided {
        if !item_id_is_valid(id) { return Err(InventoryError("invalid count item id".into())); }
        let n = count.as_u64().ok_or_else(|| InventoryError("invalid count value".into()))?;
        if n > 0 { counts.insert(id.clone(), n); }
    }
    let mut computed = BTreeMap::<String, u64>::new();
    for stack in slots.values().chain(carried.iter()) {
        let entry = computed.entry(stack.item.clone()).or_default();
        *entry = entry.checked_add(stack.count).ok_or_else(||
            InventoryError("inventory count overflow".into()))?;
    }
    if computed != counts {
        return Err(InventoryError("inventory reported counts disagree with actual slots".into()));
    }
    Ok(Inventory { slots, carried, counts })
}

/// Exact item count increase AND a real inventory slot holding that exact id.
pub fn verify_one_added(before: &Inventory, after: &Inventory, item: &str) -> Result<Vec<u32>, InventoryError> {
    if !item_id_is_valid(item) { return Err(InventoryError("invalid target item".into())); }
    let old = before.counts.get(item).copied().unwrap_or(0);
    let new = after.counts.get(item).copied().unwrap_or(0);
    if new.checked_sub(old) != Some(1) {
        return Err(InventoryError("not exactly one target item added".into()));
    }
    let slots: Vec<_> = after.slots.iter().filter_map(|(slot, stack)|
        (stack.item == item).then_some(*slot)).collect();
    if slots.is_empty() {
        return Err(InventoryError("target item not present in an actual inventory slot".into()));
    }
    Ok(slots)
}

pub fn validate_unique_items(items: &[String]) -> Result<(), InventoryError> {
    if items.is_empty() || items.len() > 16 { return Err(InventoryError("item count must be 1..16".into())); }
    let mut seen = BTreeSet::new();
    for id in items {
        if !item_id_is_valid(id) || !seen.insert(id) {
            return Err(InventoryError("invalid or repeated item id".into()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn empty_inventory() -> Value {
        let slots = |a: u32, b: u32| (a..b).map(|slot| json!({"slot":slot,"item":null,"count":0})).collect::<Vec<_>>();
        json!({
            "hotbar":slots(0,9),"main":slots(9,36),"armor":slots(500,504),
            "offhand":{"slot":504,"item":null,"count":0},"carried":null,"counts":{}
        })
    }

    #[test]
    fn accepts_exact_real_slot_delta() {
        let before = parse_inventory(&empty_inventory()).unwrap();
        let mut after = empty_inventory();
        after["hotbar"][1] = json!({"slot":1,"item":"ruby:ruby","count":1});
        after["counts"] = json!({"ruby:ruby":1});
        let after = parse_inventory(&after).unwrap();
        assert_eq!(verify_one_added(&before, &after, "ruby:ruby").unwrap(), vec![1]);
    }

    #[test]
    fn rejects_false_counts_and_substring_matches() {
        let before = parse_inventory(&empty_inventory()).unwrap();
        let mut forged = empty_inventory();
        forged["counts"] = json!({"ruby:ruby":1});
        assert!(parse_inventory(&forged).is_err());
        let mut another = empty_inventory();
        another["hotbar"][0] = json!({"slot":0,"item":"ruby:ruby_fake","count":1});
        another["counts"] = json!({"ruby:ruby_fake":1});
        let parsed = parse_inventory(&another).unwrap();
        assert!(verify_one_added(&before, &parsed, "ruby:ruby").is_err());
    }

    #[test]
    fn rejects_wrong_quantity_invalid_slots_and_boolean_counts() {
        let before = parse_inventory(&empty_inventory()).unwrap();
        let mut bad = empty_inventory();
        bad["hotbar"][0] = json!({"slot":1,"item":"ruby:ruby","count":1});
        assert!(parse_inventory(&bad).is_err());
        bad["hotbar"][0] = json!({"slot":0,"item":"ruby:ruby","count":true});
        assert!(parse_inventory(&bad).is_err());
        bad["hotbar"][0] = json!({"slot":0,"item":"ruby:ruby","count":2});
        bad["counts"] = json!({"ruby:ruby":2});
        let parsed = parse_inventory(&bad).unwrap();
        assert!(verify_one_added(&before, &parsed, "ruby:ruby").is_err());
    }

    #[test]
    fn rejects_malformed_groups_and_wrong_totals() {
        let mut document = empty_inventory();
        document["main"] = json!([]);
        assert!(parse_inventory(&document).is_err());
        let mut document = empty_inventory();
        document["offhand"] = json!({"slot":0});
        assert!(parse_inventory(&document).is_err());
        let mut document = empty_inventory();
        document["counts"] = json!({"minecraft:stone":-1});
        assert!(parse_inventory(&document).is_err());
    }

    #[test]
    fn item_ids_are_strictly_namespaced() {
        for good in ["minecraft:stone", "ruby:crystal/ore", "foo_bar:baz-2"] {
            assert!(item_id_is_valid(good), "{good}");
        }
        for bad in ["Stone", "../file", "ruby:../secret", "Ruby:gem", "ruby:", "a:b:c", "a:/absolute"] {
            assert!(!item_id_is_valid(bad), "{bad}");
        }
    }
}
