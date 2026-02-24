use crate::config;
use crate::daemon;
use crate::hook_server::HookServer;
use crate::state::{AppState, LastSession, SessionInfo};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct PtySession {
    pub info: SessionInfo,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) child: Box<dyn Child + Send + Sync>,
    pub(crate) _reader_handle: std::thread::JoinHandle<()>,
}

pub struct PtyManager {
    pub(crate) sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

pub type PtyManagerMutex = Mutex<PtyManager>;

#[tauri::command]
pub fn spawn_session(
    app: AppHandle,
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    project_id: String,
    command: String,
    label: String,
    cwd: String,
    channel: Option<String>,
    dark_mode: Option<bool>,
) -> Result<SessionInfo, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Always wrap the command with the tg binary for session management
    let tg_path = if let Some(bin) = daemon::find_tg_binary() {
        bin.to_string_lossy().to_string()
    } else if let Some((bun, main_ts)) = daemon::find_tg_dev() {
        format!("{} run {}", bun.to_string_lossy(), main_ts.to_string_lossy())
    } else {
        return Err("Cannot find touchgrass binary (tg)".to_string());
    };
    let effective_command = if let Some(ref ch) = channel {
        // Strip "type:" prefix (e.g. "telegram:Dev2" → "Dev2") for the CLI --channel flag
        let ch_flag = if let Some(idx) = ch.find(':') { &ch[idx + 1..] } else { ch.as_str() };
        format!("{tg_path} {command} --channel '{ch_flag}'")
    } else {
        format!("{tg_path} {command}")
    };

    // Spawn an interactive shell that runs the command, then stays open
    // so the user can continue typing after the process exits
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(["-i", "-c", &format!("{}; exec {}", effective_command, shell)]);
    cmd.cwd(&cwd);

    // Strip CLAUDECODE to prevent
    // "cannot be launched inside another Claude Code session" errors
    cmd.env_remove("CLAUDECODE");
    cmd.env("TERM", "xterm-256color");

    // Tell CLI tools about the terminal background so they can adapt their theme
    match dark_mode {
        Some(true) | None => cmd.env("COLORFGBG", "15;0"),   // white on black
        Some(false) => cmd.env("COLORFGBG", "0;15"),          // black on white
    };

    // Pass hook server port so the Claude Code hook script can POST events to the app
    if let Some(hook_server) = app.try_state::<HookServer>() {
        cmd.env("TOUCHGRASS_APP_PORT", hook_server.port.to_string());
        cmd.env("TOUCHGRASS_SESSION_ID", &session_id);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Drop slave — we only need the master side
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let event_name = format!("pty-output-{}", session_id);
    let sid = session_id.clone();
    let app_for_reader = app.clone();

    let reader_handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // PTY closed — emit exit event
                    let _ = app_for_reader.emit(&format!("pty-exit-{}", sid), ());
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];
                    // Send as Vec<u8> which Tauri serializes as array of numbers
                    let _ = app_for_reader.emit(&event_name, data.to_vec());
                }
                Err(_) => {
                    let _ = app_for_reader.emit(&format!("pty-exit-{}", sid), ());
                    break;
                }
            }
        }
    });

    let info = SessionInfo {
        id: session_id.clone(),
        project_id,
        label,
        command,
        channel,
        tool_session_id: None,
    };

    let session = PtySession {
        info: info.clone(),
        master: pair.master,
        writer,
        child,
        _reader_handle: reader_handle,
    };

    let mut mgr = pty_mgr.lock().unwrap();
    mgr.sessions.insert(session_id, session);

    // Persist session for resume across app restarts
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    {
        let mut state = app_state.lock().unwrap();
        state.saved_sessions.retain(|s| s.id != info.id);
        state.saved_sessions.push(info.clone());
        // Remember as last session for this project (quick resume when all sessions closed)
        state.last_sessions.insert(
            info.project_id.clone(),
            LastSession {
                command: info.command.clone(),
                label: info.label.clone(),
                channel: info.channel.clone(),
                tool_session_id: None,
            },
        );
        config::save_state(&state);
    }

    Ok(info)
}

#[tauri::command]
pub fn write_to_session(
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut mgr = pty_mgr.lock().unwrap();
    if let Some(session) = mgr.sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub fn resize_session(
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mgr = pty_mgr.lock().unwrap();
    if let Some(session) = mgr.sessions.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub fn kill_session(
    app: AppHandle,
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    session_id: String,
) -> Result<(), String> {
    let mut mgr = pty_mgr.lock().unwrap();
    if let Some(mut session) = mgr.sessions.remove(&session_id) {
        // Send SIGTERM to the process group so tg can cleanly exit
        // and call /remote/{id}/exit on the daemon
        if let Some(pid) = session.child.process_id() {
            if pid > 1 {
                unsafe {
                    // Kill the process group (negative pid)
                    libc::kill(-(pid as i32), libc::SIGTERM);
                }
            }
        }
        // Give the process a moment to clean up before dropping the PTY
        let _ = std::thread::spawn(move || {
            // Wait up to 2 seconds for the process to exit
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(100));
                match session.child.try_wait() {
                    Ok(Some(_)) => return, // Process exited cleanly
                    _ => continue,
                }
            }
            // Force kill if still running
            let _ = session.child.kill();
        });
    }

    // Remove from persisted sessions
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    {
        let mut state = app_state.lock().unwrap();
        state.saved_sessions.retain(|s| s.id != session_id);
        config::save_state(&state);
    }

    Ok(())
}

#[tauri::command]
pub fn list_sessions(
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    project_id: String,
) -> Vec<SessionInfo> {
    let mgr = pty_mgr.lock().unwrap();
    mgr.sessions
        .values()
        .filter(|s| s.info.project_id == project_id)
        .map(|s| s.info.clone())
        .collect()
}

#[tauri::command]
pub fn get_saved_sessions(
    app: AppHandle,
    project_id: String,
) -> Vec<SessionInfo> {
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    let state = app_state.lock().unwrap();
    state
        .saved_sessions
        .iter()
        .filter(|s| s.project_id == project_id)
        .cloned()
        .collect()
}

#[tauri::command]
pub fn close_saved_session(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    let mut state = app_state.lock().unwrap();
    state.saved_sessions.retain(|s| s.id != session_id);
    config::save_state(&state);
    Ok(())
}

#[tauri::command]
pub fn rename_session(
    app: AppHandle,
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    session_id: String,
    label: String,
) -> Result<(), String> {
    // Update live session
    let mut mgr = pty_mgr.lock().unwrap();
    if let Some(session) = mgr.sessions.get_mut(&session_id) {
        session.info.label = label.clone();
    }
    drop(mgr);
    // Update saved session
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    let mut state = app_state.lock().unwrap();
    if let Some(s) = state.saved_sessions.iter_mut().find(|s| s.id == session_id) {
        s.label = label;
    }
    config::save_state(&state);
    Ok(())
}

#[tauri::command]
pub fn set_tool_session_id(
    app: AppHandle,
    session_id: String,
    tool_session_id: String,
) -> Result<(), String> {
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    let mut state = app_state.lock().unwrap();
    if let Some(s) = state.saved_sessions.iter_mut().find(|s| s.id == session_id) {
        s.tool_session_id = Some(tool_session_id.clone());
        let project_id = s.project_id.clone();
        // Also update the last_sessions entry for this project
        if let Some(last) = state.last_sessions.get_mut(&project_id) {
            last.tool_session_id = Some(tool_session_id);
        }
        config::save_state(&state);
    }
    Ok(())
}

#[tauri::command]
pub fn get_last_session(
    app: AppHandle,
    project_id: String,
) -> Option<LastSession> {
    let app_state: tauri::State<'_, Mutex<AppState>> = app.state();
    let state = app_state.lock().unwrap();
    state.last_sessions.get(&project_id).cloned()
}
