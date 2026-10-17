// Merit menu-bar app (macOS first).
// A tray icon next to Wi-Fi with: Start session · Stop & certify · Anchor status · Open dashboard · Quit.
// While a session runs, it records the CLASS of each key you press (char, space, enter, back, del,
// paste, nav, select, undo, cmd) and its timing. It never records which character you typed.
// Requires macOS Input Monitoring / Accessibility permission for this app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;

use rdev::{listen, EventType, Key};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Serialize)]
struct KeyEvent {
    seq: u64,
    t: u64,
    k: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<usize>,
}

#[derive(Default)]
struct Mods {
    shift: bool,
    meta: bool,
    ctrl: bool,
}

/// Set when the OS refuses the key listener (macOS: Input Monitoring is off for this app).
static LISTENER_FAILED: AtomicBool = AtomicBool::new(false);

struct Session {
    allow: Vec<String>,
    path: PathBuf,
    started: Instant,
    seq: u64,
    file: std::fs::File,
    // Honest counts of what was and was not recorded, so an empty session can say why. Counts and app names only; never characters.
    seen: u64,
    secure_skipped: u64,
    app_unknown: u64,
    apps_skipped: HashMap<String, u64>,
}

/// Is the app in front on the person's list? (exact name, or the app's name contains a listed name)
fn app_allowed(app: Option<&str>, allow: &[String]) -> bool {
    app.map(|a| allow.iter().any(|x| a.eq_ignore_ascii_case(x) || a.to_lowercase().contains(&x.to_lowercase()))).unwrap_or(false)
}

/// `sessions/20261017T020747Z-desktop`: the only shape the dashboard may ask us to touch.
fn session_base_ok(base: &str) -> bool {
    let Some(rest) = base.strip_prefix("sessions/") else { return false };
    let Some(stamp) = rest.strip_suffix("-desktop") else { return false };
    let b = stamp.as_bytes();
    b.len() == 16 && b.iter().enumerate().all(|(i, c)| match i { 8 => *c == b'T', 15 => *c == b'Z', _ => c.is_ascii_digit() })
}

#[derive(Default)]
struct State {
    session: Option<Session>,
    mods: Mods,
    to_sign: Vec<String>,
}

type Shared = Arc<Mutex<State>>;

/// Apps Merit measures in by default. Everything else is ignored, so password managers, banking sites
/// and anything sensitive are never measured. Edit ~/.merit/apps.json to change the list.
fn default_apps() -> Vec<String> {
    let mut v: Vec<&str> = vec![
        "Terminal", "iTerm2", "Warp", "WezTerm", "Alacritty", "kitty", "Ghostty",
        "Code", "Visual Studio Code", "Cursor", "Zed", "Sublime Text",
        "Obsidian", "Notes", "TextEdit", "Pages", "Microsoft Word", "WINWORD", "Notion",
        "WindowsTerminal", "Windows Terminal", "powershell", "cmd", "gnome-terminal", "konsole",
    ];
    // On macOS, password fields put the system in Secure Event Input, which Merit honors, so browsers
    // can be included. On Windows/Linux there is no equivalent signal, so browsers stay off by default.
    if cfg!(target_os = "macos") {
        v.extend(["Safari", "Google Chrome", "Arc", "Firefox", "Brave Browser"]);
    }
    v.into_iter().map(String::from).collect()
}

fn allowed_apps() -> Vec<String> {
    let path = merit_home().join("apps.json");
    if let Ok(s) = fs::read_to_string(&path) {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(&s) {
            return list;
        }
    }
    let list = default_apps();
    let _ = fs::write(&path, serde_json::to_string_pretty(&list).unwrap_or_default());
    list
}

/// The app in front right now (macOS, Windows, Linux/X11).
fn frontmost_app() -> Option<String> {
    active_win_pos_rs::get_active_window().ok().map(|w| w.app_name)
}

fn merit_home() -> PathBuf {
    let p = core::merit_home();
    let _ = fs::create_dir_all(p.join("sessions"));
    p
}

/// Map a key press to its class. Never returns or stores the character.
fn classify(key: Key, m: &Mods) -> Option<&'static str> {
    use Key::*;
    if m.meta || m.ctrl {
        return Some(match key {
            KeyV => "paste",
            KeyZ => "undo",
            KeyA | LeftArrow | RightArrow | UpArrow | DownArrow if m.shift || key == KeyA => "select",
            _ => "cmd",
        });
    }
    Some(match key {
        ShiftLeft | ShiftRight | MetaLeft | MetaRight | ControlLeft | ControlRight | Alt | AltGr | CapsLock => return None,
        Backspace => "back",
        Delete => "del",
        Return | KpReturn => "enter",
        Space => "space",
        LeftArrow | RightArrow | UpArrow | DownArrow | Home | End | PageUp | PageDown => {
            if m.shift { "select" } else { "nav" }
        }
        Escape | Tab | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 | F9 | F10 | F11 | F12 => "cmd",
        Num0 | Num1 | Num2 | Num3 | Num4 | Num5 | Num6 | Num7 | Num8 | Num9 | Kp0 | Kp1 | Kp2 | Kp3 | Kp4 | Kp5 | Kp6 | Kp7 | Kp8 | Kp9 => {
            if m.shift { "punct" } else { "digit" } // shift+digit = ! @ # $ …
        }
        Dot | Comma | SemiColon | Quote | Slash | BackSlash | Minus | Equal | LeftBracket | RightBracket | BackQuote
        | KpMinus | KpPlus | KpMultiply | KpDivide | IntlBackslash => "punct",
        KeyA | KeyB | KeyC | KeyD | KeyE | KeyF | KeyG | KeyH | KeyI | KeyJ | KeyK | KeyL | KeyM | KeyN | KeyO
        | KeyP | KeyQ | KeyR | KeyS | KeyT | KeyU | KeyV | KeyW | KeyX | KeyY | KeyZ => {
            if m.shift { "upper" } else { "char" }
        }
        _ => "char",
    })
}

#[cfg(target_os = "macos")]
#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

/// True while a password field (or any app) has enabled macOS Secure Event Input.
fn secure_input_active() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        return IsSecureEventInputEnabled() != 0;
    }
    #[allow(unreachable_code)]
    false
}

fn start_listener(state: Shared) {
    std::thread::spawn(move || {
        let cb = move |ev: rdev::Event| {
            let mut st = state.lock().unwrap();
            match ev.event_type {
                EventType::KeyPress(k) => {
                    match k {
                        Key::ShiftLeft | Key::ShiftRight => st.mods.shift = true,
                        Key::MetaLeft | Key::MetaRight => st.mods.meta = true,
                        Key::ControlLeft | Key::ControlRight => st.mods.ctrl = true,
                        _ => {}
                    }
                    let class = classify(k, &st.mods);
                    if let (Some(class), Some(s)) = (class, st.session.as_mut()) {
                        s.seen += 1;
                        // Never measure while macOS is in Secure Event Input (password fields).
                        if secure_input_active() {
                            s.secure_skipped += 1;
                            return;
                        }
                        // Measure only inside apps the person chose.
                        let app = frontmost_app();
                        if !app_allowed(app.as_deref(), &s.allow) {
                            match app {
                                Some(a) => { if s.apps_skipped.len() < 50 || s.apps_skipped.contains_key(&a) { *s.apps_skipped.entry(a).or_insert(0) += 1; } }
                                None => s.app_unknown += 1,
                            }
                            return;
                        }
                        // We never read the clipboard: a paste is counted, its contents and length are not read.
                        let e = KeyEvent { seq: s.seq, t: s.started.elapsed().as_millis() as u64, k: class, n: None };
                        s.seq += 1;
                        let _ = writeln!(s.file, "{}", serde_json::to_string(&e).unwrap());
                    }
                }
                EventType::KeyRelease(k) => match k {
                    Key::ShiftLeft | Key::ShiftRight => st.mods.shift = false,
                    Key::MetaLeft | Key::MetaRight => st.mods.meta = false,
                    Key::ControlLeft | Key::ControlRight => st.mods.ctrl = false,
                    _ => {}
                },
                _ => {}
            }
        };
        if let Err(e) = listen(cb) {
            LISTENER_FAILED.store(true, Ordering::Relaxed);
            eprintln!("merit: key listener failed (grant Input Monitoring in System Settings): {:?}", e);
        }
    });
}

fn start_session(state: &Shared) -> String {
    let mut st = state.lock().unwrap();
    if st.session.is_some() {
        return "Already measuring".into();
    }
    if LISTENER_FAILED.load(Ordering::Relaxed) {
        return "Merit cannot see keys: turn on Input Monitoring for Merit (System Settings → Privacy & Security)".into();
    }
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let path = merit_home().join("sessions").join(format!("{stamp}-desktop.jsonl"));
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            }
            st.session = Some(Session { allow: allowed_apps(), path, started: Instant::now(), seq: 0, file, seen: 0, secure_skipped: 0, app_unknown: 0, apps_skipped: HashMap::new() });
            "Measuring integrity (key types only, never letters)".into()
        }
        Err(e) => format!("Could not start: {e}"),
    }
}

/// What was seen versus recorded, saved next to the session (owner-only). Lets the dashboard explain an empty session.
fn write_meta(s: &Session) {
    let mut apps: Vec<(&String, &u64)> = s.apps_skipped.iter().collect();
    apps.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    apps.truncate(12);
    let meta = serde_json::json!({
        "seen": s.seen, "recorded": s.seq, "secure_skipped": s.secure_skipped, "app_unknown": s.app_unknown,
        "apps_skipped": apps.into_iter().map(|(k, v)| serde_json::json!({ "app": k, "keys": v })).collect::<Vec<_>>(),
        "listener_failed": LISTENER_FAILED.load(Ordering::Relaxed),
    });
    let path = s.path.with_extension("meta.json");
    if fs::write(&path, serde_json::to_string_pretty(&meta).unwrap_or_default()).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
    }
}

/// Stop recording and hand the session to the dashboard, which builds the certificate with the shared
/// TypeScript code and asks the native side to sign it. No Node, no external tools.
fn stop_session(state: &Shared) -> Result<(String, u64), String> {
    let session = state.lock().unwrap().session.take();
    let Some(s) = session else { return Err("Not measuring".into()) };
    write_meta(&s);
    drop(s.file);
    let name = s.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok((name, s.seq))
}

#[derive(Serialize)]
struct SessionSummary {
    file: String,
    cert: Option<serde_json::Value>,
    anchored: bool,
}

#[tauri::command]
fn list_sessions() -> Vec<SessionSummary> {
    let dir = merit_home().join("sessions");
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(&dir) {
        let mut files: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false)).collect();
        files.sort();
        files.reverse();
        for p in files {
            let base = p.to_string_lossy().replace(".jsonl", "");
            let cert_path = format!("{base}.cert.json");
            let cert = fs::read_to_string(&cert_path).ok().and_then(|s| serde_json::from_str(&s).ok());
            let anchored = PathBuf::from(format!("{cert_path}.ots")).exists();
            out.push(SessionSummary { file: p.file_name().unwrap().to_string_lossy().into(), cert, anchored });
        }
    }
    out
}

/// Sessions waiting for the dashboard to sign them. Draining a queue avoids racing a window that is still loading.
#[tauri::command]
fn take_to_sign(state: tauri::State<Shared>) -> Vec<String> {
    std::mem::take(&mut state.lock().unwrap().to_sign)
}

#[tauri::command]
fn log(msg: String) {
    eprintln!("merit dashboard: {msg}");
}

#[tauri::command]
fn capture_health() -> serde_json::Value {
    serde_json::json!({ "listener_failed": LISTENER_FAILED.load(Ordering::Relaxed) })
}

/// Add an app to the measured list (apps.json). Names only; no paths, no control characters.
#[tauri::command]
fn add_app(name: String) -> Result<Vec<String>, String> {
    let n = name.trim().to_string();
    if n.is_empty() || n.len() > 64 || n.chars().any(|c| c.is_control()) { return Err("not a valid app name".into()); }
    let mut list = allowed_apps();
    if !list.iter().any(|x| x.eq_ignore_ascii_case(&n)) { list.push(n); }
    fs::write(merit_home().join("apps.json"), serde_json::to_string_pretty(&list).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(list)
}

/// Open the macOS Input Monitoring pane, where Merit must be switched on to see key presses.
#[tauri::command]
fn open_input_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent").spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    Err("only needed on macOS".into())
}

/// Remove a session that recorded nothing (0 bytes) and its notes. Refuses anything else.
#[tauri::command]
fn delete_empty_session(base: String) -> Result<(), String> {
    if !session_base_ok(&base) { return Err("not a session".into()); }
    let jsonl = merit_home().join(format!("{base}.jsonl"));
    match fs::metadata(&jsonl) { Ok(m) if m.len() == 0 => {} Ok(_) => return Err("that session has recorded keys; it is not empty".into()), Err(e) => return Err(e.to_string()) }
    let _ = fs::remove_file(&jsonl);
    let _ = fs::remove_file(merit_home().join(format!("{base}.meta.json")));
    Ok(())
}

#[tauri::command]
fn recording_status(state: tauri::State<Shared>) -> bool {
    state.lock().unwrap().session.is_some()
}

fn open_dashboard(app: &AppHandle) {
    // A menu-bar-only (Accessory) app is never the active app, so its window cannot take focus and the first click is spent
    // activating it instead of pressing the button. While the dashboard is open the app is a normal app; it goes back to the
    // menu bar when the window closes.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("dashboard") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App("index.html".into()))
        .title("Merit")
        .inner_size(720.0, 560.0)
        .focused(true);
    // Clicking an inactive window must also click through to the page.
    #[cfg(target_os = "macos")]
    { b = b.accept_first_mouse(true); }
    if let Ok(w) = b.build() {
        let _ = w.set_focus();
        #[cfg(target_os = "macos")]
        {
            let handle = app.clone();
            w.on_window_event(move |e| {
                if matches!(e, tauri::WindowEvent::Destroyed) { let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory); }
            });
        }
    }
}

fn main() {
    let state: Shared = Arc::new(Mutex::new(State::default()));
    start_listener(state.clone());

    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![list_sessions, recording_status, capture_health, add_app, open_input_settings, delete_empty_session, take_to_sign, log, core::public_key, core::sign, core::events_root, core::read_file, core::write_file, core::list_files, core::file_size, core::http])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let status = MenuItem::with_id(app, "status", "Idle", false, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Measure integrity", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop & sign", true, None::<&str>)?;
            let dash = MenuItem::with_id(app, "dash", "Open dashboard", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Merit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&status, &sep, &start, &stop, &dash, &sep, &quit])?;

            let st = state.clone();
            let status_item = status.clone();
            TrayIconBuilder::with_id("merit")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "start" => {
                        let msg = start_session(&st);
                        let _ = status_item.set_text(&msg);
                        if let Some(tray) = app.tray_by_id("merit") {
                            if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-active.png")) { let _ = tray.set_icon(Some(img)); let _ = tray.set_icon_as_template(true); }
                        }
                    }
                    "stop" => {
                        let msg = match stop_session(&st) {
                            Ok((name, n)) => {
                                st.lock().unwrap().to_sign.push(name);
                                open_dashboard(app);
                                let _ = app.emit("sign-queued", ());
                                if n == 0 { "Nothing was recorded (see the dashboard)".to_string() } else { format!("Signing ({n} keystrokes)…") }
                            }
                            Err(m) => m,
                        };
                        let _ = status_item.set_text(&msg);
                        if let Some(tray) = app.tray_by_id("merit") {
                            if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) { let _ = tray.set_icon(Some(img)); let _ = tray.set_icon_as_template(true); }
                        }
                    }
                    "dash" => open_dashboard(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // `merit-menubar --sign <session.jsonl>`: sign a recorded session through the same path as "Stop & sign".
            let args: Vec<String> = std::env::args().collect();
            if let Some(i) = args.iter().position(|a| a == "--sign") {
                if let Some(name) = args.get(i + 1).and_then(|f| std::path::Path::new(f).file_name()).map(|n| n.to_string_lossy().into_owned()) {
                    state.lock().unwrap().to_sign.push(name);
                    open_dashboard(app.handle());
                }
            } else if args.iter().any(|a| a == "--dashboard") {
                open_dashboard(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Merit");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn l(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

    #[test]
    fn app_matching_is_exact_or_contains_and_case_insensitive() {
        let a = l(&["Terminal", "Code", "Notes"]);
        assert!(app_allowed(Some("Terminal"), &a));
        assert!(app_allowed(Some("terminal"), &a));
        assert!(app_allowed(Some("Visual Studio Code"), &a));      // contains "code"
        assert!(!app_allowed(Some("Messages"), &a));
        assert!(!app_allowed(Some("Claude"), &a));
        assert!(!app_allowed(None, &a), "an app we could not identify is never measured");
        assert!(!app_allowed(Some("Terminal"), &[]), "an empty list measures nothing");
    }

    #[test]
    fn only_real_session_names_may_be_touched() {
        assert!(session_base_ok("sessions/20261017T020747Z-desktop"));
        for bad in ["", "sessions/", "sessions/../x-desktop", "../sessions/20261017T020747Z-desktop", "sessions/20261017T020747Z-desktop.jsonl", "sessions/20261017T02074Z-desktop", "sessions/2026101xT020747Z-desktop", "sessions/20261017T020747Z-other", "/etc/passwd", "sessions/20261017T020747Z-desktop/../../key"] {
            assert!(!session_base_ok(bad), "{bad}");
        }
    }

    #[test]
    fn recorder_lines_have_no_null_fields() {
        let e = KeyEvent { seq: 1, t: 2, k: "char", n: None };
        assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"seq":1,"t":2,"k":"char"}"#);
    }
}
