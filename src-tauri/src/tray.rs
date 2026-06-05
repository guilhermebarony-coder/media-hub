// 1.3.x — "Background mode" tray support.
//
// Model (per the design discussion): the window controls keep their
// normal behavior — X quits, minimize goes to the taskbar (so alt-tab
// still works). A dedicated topbar button ("run in background")
// explicitly hides the window into the system tray. The Rust backend
// keeps running, so the React download queue (which lives in the
// hidden-but-alive webview) keeps processing jobs.
//
// The tray icon is created once at startup but kept hidden; we just
// toggle its visibility. Tray icon visible == "app is in background
// mode". Left-click the tray icon (or its Show item) to restore.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

pub const TRAY_ID: &str = "mh-tray";
const MAIN_WINDOW: &str = "main";

/// Build the (initially hidden) tray icon + its right-click menu.
/// Called once from `setup()`.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "mh-show", "Show Media Hub", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "mh-quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .expect("app should have a default window icon")
                .clone(),
        )
        .menu(&menu)
        .tooltip("Media Hub")
        // We handle left-click ourselves (restore); don't pop the menu
        // on left-click — the menu is for right-click only.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "mh-show" => restore(app),
            "mh-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore(tray.app_handle());
            }
        })
        .build(app)?;

    // Start hidden — only shown once the user enters background mode.
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
    Ok(())
}

/// Restore the main window and hide the tray icon.
fn restore<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
}

/// Hide the main window into the tray. The backend (and the hidden
/// webview's download queue) keeps running.
#[tauri::command]
pub fn app_enter_background<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        win.hide().map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Bring the window back from background mode (mirrors the tray click /
/// Show menu item). Exposed so the frontend can offer a programmatic
/// "exit background" path if ever needed.
#[tauri::command]
pub fn app_exit_background<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    restore(&app);
    Ok(())
}

/// Update the tray tooltip — used by the frontend to surface the live
/// active-download count while the window is hidden (e.g. "Media Hub —
/// 2 downloading"). No-op if the tray isn't currently shown.
#[tauri::command]
pub fn app_set_tray_tooltip<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(&text)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
