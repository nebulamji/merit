// Merit menu-bar app (macOS first).
// A tray icon next to Wi-Fi with: Start session · Stop & certify · Anchor status · Open dashboard · Quit.
// While a session runs, it records the CLASS of each key you press (char, space, enter, back, del,
// paste, nav, select, undo, cmd) and its timing. It never records which character you typed.
// Requires macOS Input Monitoring / Accessibility permission for this app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rdev::{listen, EventType, Key};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
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

struct Session {
    path: PathBuf,
    started: Instant,
    seq: u64,
    file: std::fs::File,
}

#[derive(Default)]
struct State {
    session: Option<Session>,
    mods: Mods,
    last_cert: Option<PathBuf>,
}

type Shared = Arc<Mutex<State>>;

fn merit_home() -> PathBuf {
    let p = dirs::home_dir().unwrap_or_default().join(".merit");
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
        _ => "char",
    })
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
                    let paste_len = if class == Some("paste") {
                        arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok()).map(|s| s.chars().count())
                    } else {
                        None
                    };
                    if let (Some(class), Some(s)) = (class, st.session.as_mut()) {
                        let e = KeyEvent { seq: s.seq, t: s.started.elapsed().as_millis() as u64, k: class, n: paste_len };
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
            eprintln!("merit: key listener failed (grant Input Monitoring in System Settings): {:?}", e);
        }
    });
}

fn start_session(state: &Shared) -> String {
    let mut st = state.lock().unwrap();
    if st.session.is_some() {
        return "Already recording".into();
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
            st.session = Some(Session { path, started: Instant::now(), seq: 0, file });
            "Recording (key classes only)".into()
        }
        Err(e) => format!("Could not start: {e}"),
    }
}

/// Stop recording, then certify + anchor via the merit CLI (MERIT_CLI or ~/merit/dist/merit-cli.cjs).
fn stop_and_certify(state: &Shared) -> String {
    let session = state.lock().unwrap().session.take();
    let Some(s) = session else { return "Not recording".into() };
    drop(s.file);
    let cli = std::env::var("MERIT_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join("merit/dist/merit-cli.cjs"));
    let out = Command::new("node").arg(&cli).arg("certify").arg(&s.path).arg("--stamp").output();
    match out {
        Ok(o) if o.status.success() => {
            state.lock().unwrap().last_cert = Some(PathBuf::from(format!("{}", s.path.display()).replace(".jsonl", ".cert.json")));
            format!("Certified ({} key events). Anchor pending.", s.seq)
        }
        Ok(o) => format!("Certify failed: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("")),
        Err(e) => format!("Could not run merit CLI: {e}"),
    }
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

#[tauri::command]
fn recording_status(state: tauri::State<Shared>) -> bool {
    state.lock().unwrap().session.is_some()
}

fn open_dashboard(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("dashboard") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App("index.html".into()))
        .title("Merit")
        .inner_size(720.0, 560.0)
        .build();
}

fn main() {
    let state: Shared = Arc::new(Mutex::new(State::default()));
    start_listener(state.clone());

    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![list_sessions, recording_status])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let status = MenuItem::with_id(app, "status", "Idle", false, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start session", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop & certify", true, None::<&str>)?;
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
                        if let Some(tray) = app.tray_by_id("merit") { let _ = tray.set_title(Some("● REC")); }
                    }
                    "stop" => {
                        if let Some(tray) = app.tray_by_id("merit") { let _ = tray.set_title(Some("signing…")); }
                        let msg = stop_and_certify(&st);
                        let _ = status_item.set_text(&msg);
                        if let Some(tray) = app.tray_by_id("merit") { let _ = tray.set_title(None::<&str>); }
                        open_dashboard(app);
                    }
                    "dash" => open_dashboard(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Merit");
}
