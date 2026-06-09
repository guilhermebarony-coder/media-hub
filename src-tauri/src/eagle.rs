// Media Hub — Eagle (eagle.cool) integration.
//
// One-way push. "Send to Eagle" takes selected library assets and adds
// them to the user's currently-open Eagle library via Eagle's local HTTP
// API (http://localhost:41595 — no auth for localhost; a token is only
// needed for cross-device LAN access we don't use).
//
// Mapping (settled with owner, 2026-06-07):
//   our tags        -> Eagle item tags
//   our source_url  -> Eagle item `website` (stays clickable in Eagle)
//   our title       -> Eagle item name
// Nothing else (no folder-as-tag, no annotation) for P1.
//
// Design note: Eagle's public API is add+read heavy and weak on
// update/delete, so we deliberately never attempt two-way sync. We're
// the sourcing tool; Eagle is the manager. Eagle must be running — we
// detect first and, when it's down, return a recognizable marker the
// renderer turns into a friendly "open Eagle" dialog rather than a
// generic network error.

use serde::Serialize;
use serde_json::json;
use std::time::Duration;
use tauri::State;

use crate::library::{self, LibraryState};

const EAGLE_BASE: &str = "http://localhost:41595";

/// Marker error returned by `eagle_send` when Eagle isn't reachable. The
/// renderer matches on this exact string to show the "open Eagle" dialog.
pub const NOT_RUNNING: &str = "__eagle_not_running__";

#[derive(Serialize)]
pub struct EagleStatus {
    pub running: bool,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct EagleSendResult {
    pub sent: usize,
}

/// Minimal projection of the asset fields we push to Eagle.
#[derive(sqlx::FromRow)]
struct EagleAssetRow {
    id: String,
    title: String,
    source_url: String,
    file_path: String,
}

/// Short-timeout HTTP client. Eagle is local, so requests are fast; an
/// 8s ceiling keeps a stuck Eagle from hanging the UI action.
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

/// Probe `GET /api/application/info`. Never errors — a closed Eagle is a
/// normal state, reported as `running: false`.
#[tauri::command]
pub async fn eagle_detect() -> Result<EagleStatus, String> {
    let client = match http() {
        Ok(c) => c,
        Err(_) => return Ok(EagleStatus { running: false, version: None }),
    };
    let url = format!("{EAGLE_BASE}/api/application/info");
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let version = resp
                .text()
                .await
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v["data"]["version"].as_str().map(str::to_string));
            Ok(EagleStatus { running: true, version })
        }
        _ => Ok(EagleStatus { running: false, version: None }),
    }
}

/// Push the given library assets into the open Eagle library. Single
/// `addFromPaths` call covers the whole batch. Returns the count sent.
#[tauri::command]
pub async fn eagle_send(
    state: State<'_, LibraryState>,
    asset_ids: Vec<String>,
) -> Result<EagleSendResult, String> {
    if asset_ids.is_empty() {
        return Err("No items selected".into());
    }

    // Confirm Eagle is up before doing any work, so the renderer gets a
    // clean "open Eagle" signal instead of a raw connection error.
    if !eagle_detect().await?.running {
        return Err(NOT_RUNNING.into());
    }

    // Load the rows we need to push.
    let placeholders = asset_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, title, source_url, file_path FROM assets \
         WHERE id IN ({placeholders}) AND deleted_at IS NULL"
    );
    let mut q = sqlx::query_as::<_, EagleAssetRow>(&sql);
    for id in &asset_ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("load assets: {e}"))?;
    if rows.is_empty() {
        return Err("Selected items were not found in the library".into());
    }

    // Tags, keyed by asset id.
    let tags = library::load_tags_for(&state.pool, &asset_ids)
        .await
        .map_err(|e| format!("load tags: {e}"))?;

    // Build the addFromPaths payload. Eagle ingests every item into the
    // currently-open library (we don't pass a folderId in P1).
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "path": r.file_path,
                "name": r.title,
                "website": r.source_url,
                "tags": tags.get(&r.id).cloned().unwrap_or_default(),
            })
        })
        .collect();
    let body = json!({ "items": items });

    let client = http()?;
    let url = format!("{EAGLE_BASE}/api/item/addFromPaths");
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(&body).map_err(|e| format!("serialize: {e}"))?)
        .send()
        .await
        .map_err(|_| NOT_RUNNING.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Eagle returned HTTP {}", resp.status()));
    }

    // Eagle replies {"status":"success"} on success.
    let text = resp.text().await.unwrap_or_default();
    let ok = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["status"].as_str().map(|s| s == "success"))
        .unwrap_or(false);
    if !ok {
        return Err(format!("Eagle rejected the request: {text}"));
    }

    Ok(EagleSendResult { sent: rows.len() })
}
