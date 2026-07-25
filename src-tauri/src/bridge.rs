// Media Hub — Browser-extension bridge (1.2.2).
//
// Tiny HTTP server bound to 127.0.0.1 that the Media Hub browser
// extension (and any `curl` script) hits to enqueue downloads.
//
// Design choices:
//   - Loopback-only bind. Never exposed to the network. The Windows
//     firewall doesn't even need a rule for 127.0.0.1 listeners.
//   - Bearer token auth. The token is generated on first launch and
//     stored in settings.json. The extension prompts the user to paste
//     it once on install; after that it's just a header.
//   - CORS allows any `chrome-extension://`, `moz-extension://`, and
//     `null` (file:// + extension service workers). Tight enough that a
//     drive-by website can't POST from a normal page.
//   - The server doesn't directly touch the React queue. It emits a
//     Tauri event `bridge:enqueue` — the frontend listens and routes
//     through the existing DownloadsProvider.enqueueUrls. This keeps
//     all the queue/persist/worker logic in one place and means the
//     bridge could be unit-tested in isolation later.
//
// Routes:
//   GET  /health  — no auth. Returns app version + a tiny shape the
//                   extension uses to verify a port is the right app.
//   POST /enqueue — auth required. Body: { url, audio_format?,
//                   project_id? }. Emits `bridge:enqueue` with the
//                   normalized payload, returns 202 immediately.
//   OPTIONS *     — handled by the CORS layer.
//
// Failure modes:
//   - Port collision → log + exit the bridge task. The app keeps
//     running, just no extension support until the user changes the
//     port in Settings. Future: try a small range of ports.
//   - Token mismatch → 401. We don't leak whether the token shape was
//     right (deliberate; "is X a valid token?" is not a probe we want
//     to answer).

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Path of the per-platform cookie cache the extension pushes over the
/// bridge: `<home>/Media Hub/.cookies/<platform>.txt`. Read by
/// `resolve_cookie_args` in lib.rs when no explicit cookie source is set
/// for that platform, so restricted downloads use an always-fresh session
/// with zero manual setup. Returns None only if the home dir won't resolve.
pub fn cookie_cache_path(app: &AppHandle, platform: &str) -> Option<std::path::PathBuf> {
    let home = app.path().home_dir().ok()?;
    Some(
        home.join("Media Hub")
            .join(".cookies")
            .join(format!("{platform}.txt")),
    )
}

/// Atomically (temp + rename) write a Netscape cookies blob to the
/// per-platform cache. Best-effort: logs and returns on any error rather
/// than failing the enqueue. Tightens perms to user-only on unix.
fn cache_cookies(app: &AppHandle, platform: &str, blob: &str) {
    let Some(path) = cookie_cache_path(app, platform) else {
        eprintln!("[bridge] cookie cache: no home dir; skipping");
        return;
    };
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("[bridge] cookie cache: mkdir failed: {e}");
            return;
        }
    }
    let tmp = path.with_extension("txt.tmp");
    if let Err(e) = std::fs::write(&tmp, blob) {
        eprintln!("[bridge] cookie cache: write failed: {e}");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if let Err(e) = std::fs::rename(&tmp, &path) {
        eprintln!("[bridge] cookie cache: rename failed: {e}");
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    eprintln!("[bridge] cached fresh cookies for platform '{platform}'");
}

/// Snapshot of the data the bridge needs from settings. Cloned at
/// spawn time so the long-lived axum handlers don't have to take the
/// settings mutex on every request. If the user regenerates the token
/// or changes the port, we restart the server (TODO future polish —
/// for MVP, the user just relaunches).
#[derive(Clone)]
struct BridgeState {
    app: AppHandle,
    token: String,
}

#[derive(Deserialize, Debug)]
struct EnqueueBody {
    /// URL to download. Required.
    url: String,
    /// Optional — when set ("mp3"/"m4a"/"flac"), enqueues as audio.
    #[serde(default)]
    audio_format: Option<String>,
    /// Optional — when set, downloads land in that project's folder
    /// instead of the library root. Same id shape as the active
    /// project picker uses.
    #[serde(default)]
    project_id: Option<String>,
    /// Optional — cosmetic, for future logging ("queued via Chrome
    /// extension" etc.). Defaults to "extension" when omitted.
    #[serde(default)]
    source: Option<String>,
    /// Optional — a Netscape cookies.txt blob the extension harvested for
    /// this URL's site (via chrome.cookies). When present we cache it
    /// per-platform (see cache_cookies) so this and future downloads of
    /// the same site use a fresh logged-in session. Never logged.
    #[serde(default)]
    cookies: Option<String>,
    /// 1.13.x — quick-menu overrides from the extension. `quality` is a
    /// numeric height string ("1080"/"720"/"480") or "" for best;
    /// `transcode` a preset id ("prores_422_lt" etc.) or "none";
    /// `rename` a title override. All optional.
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    transcode: Option<String>,
    #[serde(default)]
    rename: Option<String>,
    /// 1.13.x — 1-based media item for multi-video posts (a tweet with
    /// its own video plus a quoted one). Without it the status URL is
    /// ambiguous and every button grabs the first video.
    #[serde(default)]
    media_index: Option<u32>,
}

/// Body for POST /cookies — the extension's "Sync cookies" button. Warms
/// the per-platform cache WITHOUT enqueuing a download. `url` is any URL
/// on the target site (used to derive the platform); `cookies` is the
/// Netscape blob.
#[derive(Deserialize, Debug)]
struct CookiesBody {
    url: String,
    cookies: String,
}

/// Event payload the frontend listens for. Mirrors `enqueueUrls`'s
/// shape in downloads.tsx but transport-agnostic — we forward only
/// what the bridge accepts, no transcode preset (extension flows
/// always use the user's default from Settings).
#[derive(Serialize, Clone, Debug)]
struct EnqueueEvent {
    url: String,
    audio_format: Option<String>,
    project_id: Option<String>,
    source: String,
    // 1.13.x — extension quick-menu overrides (see EnqueueBody).
    quality: Option<String>,
    transcode: Option<String>,
    rename: Option<String>,
    media_index: Option<u32>,
}

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    app: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct EnqueueResponse {
    ok: bool,
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

/// Tiny constant-time comparison so timing attacks can't reveal a
/// prefix match. Both inputs are hex strings of the same expected
/// length but we tolerate length mismatch.
fn token_matches(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (a, b) in provided.bytes().zip(expected.bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// Pull the bearer token from `Authorization: Bearer <token>`. Returns
/// None when missing or malformed (caller responds 401).
fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    let auth = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(str::trim)
}

async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        ok: true,
        app: "media-hub",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn enqueue_handler(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    Json(body): Json<EnqueueBody>,
) -> Result<(StatusCode, Json<EnqueueResponse>), (StatusCode, Json<ErrorResponse>)> {
    // Auth.
    let provided = extract_bearer(&headers).unwrap_or("");
    if !token_matches(provided, &state.token) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                ok: false,
                error: "invalid token".into(),
            }),
        ));
    }

    // Validate URL — just a presence + length sanity check. We don't
    // try to verify it's a known platform; yt-dlp's site detection is
    // the source of truth and runs anyway during the actual fetch.
    let url = body.url.trim().to_string();
    if url.is_empty() || url.len() > 2048 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                ok: false,
                error: "url is empty or too long".into(),
            }),
        ));
    }

    // Validate audio_format against the same allowlist yt_download
    // enforces. Defensive — the renderer also validates — but never
    // trust input crossing a process boundary.
    let audio_format = body
        .audio_format
        .as_deref()
        .map(str::trim)
        .filter(|s| matches!(*s, "mp3" | "m4a" | "flac"))
        .map(|s| s.to_string());

    // Extension cookie-bridge: if a fresh cookies blob rode along, cache
    // it per-platform so the download picks up a live logged-in session
    // (resolve_cookie_args reads the cache). Best-effort, never blocks.
    // Gated on the user's consent — if the cookie system is off we never
    // even write their cookies to disk.
    if let Some(blob) = body.cookies.as_deref() {
        let blob = blob.trim();
        let consented =
            crate::settings::cookies_enabled(&state.app.state::<crate::settings::SettingsState>());
        if consented && !blob.is_empty() {
            if let Some(platform) = crate::settings::detect_platform(&url) {
                cache_cookies(&state.app, platform, blob);
            }
        } else if !blob.is_empty() && !consented {
            eprintln!("[bridge] cookies received but consent is OFF — discarding, not caching");
        }
    }

    let payload = EnqueueEvent {
        url,
        audio_format,
        project_id: body.project_id,
        source: body.source.unwrap_or_else(|| "extension".to_string()),
        quality: body.quality,
        transcode: body.transcode,
        rename: body.rename,
        media_index: body.media_index,
    };

    // Fire to the renderer. If the emit fails the queue isn't going
    // to receive it — return 500 so the extension can show a real
    // error instead of silently dropping the request.
    if let Err(e) = state.app.emit("bridge:enqueue", payload) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                ok: false,
                error: format!("emit failed: {e}"),
            }),
        ));
    }

    // 202 Accepted — the queue might take seconds to actually fetch
    // metadata + start the download, and we've fired the event but
    // not waited. Semantically accurate.
    Ok((StatusCode::ACCEPTED, Json(EnqueueResponse { ok: true })))
}

/// POST /cookies — the extension's "Sync cookies" button. Caches a fresh
/// cookies blob per-platform without enqueuing anything, so a later
/// in-app paste of that site uses a live session. Auth + consent gated.
async fn cookies_handler(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    Json(body): Json<CookiesBody>,
) -> Result<(StatusCode, Json<EnqueueResponse>), (StatusCode, Json<ErrorResponse>)> {
    let provided = extract_bearer(&headers).unwrap_or("");
    if !token_matches(provided, &state.token) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse { ok: false, error: "invalid token".into() }),
        ));
    }
    if !crate::settings::cookies_enabled(&state.app.state::<crate::settings::SettingsState>()) {
        // Consent is off app-side — refuse rather than silently storing.
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                ok: false,
                error: "cookie use is disabled in Media Hub settings".into(),
            }),
        ));
    }
    let url = body.url.trim();
    let blob = body.cookies.trim();
    let platform = crate::settings::detect_platform(url);
    match platform {
        Some(p) if !blob.is_empty() => {
            cache_cookies(&state.app, p, blob);
            Ok((StatusCode::OK, Json(EnqueueResponse { ok: true })))
        }
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                ok: false,
                error: "unsupported site or empty cookies".into(),
            }),
        )),
    }
}

/// Build the axum router. Pulled out so we could test it standalone
/// without spinning a real TCP listener.
fn build_app(state: Arc<BridgeState>) -> Router {
    // CORS: allow the extension origins + null. Predicate-based
    // because chrome-extension:// has the extension id baked in
    // (different per install) so we can't enumerate origins. The
    // predicate only allows the scheme.
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ])
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _req_parts: &_| {
                let Ok(s) = origin.to_str() else { return false };
                s == "null"
                    || s.starts_with("chrome-extension://")
                    || s.starts_with("moz-extension://")
                    || s.starts_with("safari-web-extension://")
            },
        ));

    Router::new()
        .route("/health", get(health_handler))
        .route("/enqueue", post(enqueue_handler))
        .route("/cookies", post(cookies_handler))
        .with_state(state)
        .layer(cors)
}

/// Spawn the HTTP server on a tokio task. Returns immediately —
/// errors during bind are logged but don't fail the app startup
/// (the rest of Media Hub works fine without the bridge).
pub fn spawn(app: AppHandle, token: String, port: u16) {
    let state = Arc::new(BridgeState {
        app: app.clone(),
        token,
    });
    let router = build_app(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Use Tauri's managed async runtime instead of `tokio::spawn`.
    // `setup()` runs before any tokio runtime is active on the
    // current thread, so a bare `tokio::spawn` panics with "no
    // reactor running" (observed 1.2.2 first launch). Tauri's
    // `async_runtime::spawn` runs the future on Tauri's internal
    // multi-threaded tokio runtime — same primitives, just hosted
    // by Tauri so it's alive whenever the app is.
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                eprintln!("[bridge] listening on http://{}", addr);
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[bridge] server error: {e}");
                }
            }
            Err(e) => {
                eprintln!(
                    "[bridge] could not bind {}: {} — extension support disabled this session",
                    addr, e
                );
            }
        }
    });
}
