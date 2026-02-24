use crate::daemon;
use crate::pty_manager::PtyManagerMutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::Read;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct DepStatus {
    pub name: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyReport {
    pub tg: DepStatus,
    pub ai_tools: Vec<DepStatus>,
    pub any_ai_installed: bool,
}

fn which(name: &str) -> Option<String> {
    let output = std::process::Command::new("which")
        .arg(name)
        .output()
        .ok()?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }
    None
}

#[tauri::command]
pub fn check_dependencies() -> DependencyReport {
    // Check tg: reuse daemon's lookup
    let tg_path = daemon::find_tg_binary()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| {
            daemon::find_tg_dev().map(|(bun, main_ts)| {
                format!(
                    "{} run {}",
                    bun.to_string_lossy(),
                    main_ts.to_string_lossy()
                )
            })
        });

    let tg = DepStatus {
        name: "tg".into(),
        installed: tg_path.is_some(),
        path: tg_path,
    };

    // Check AI tools
    let ai_names = ["claude", "codex", "kimi", "pi"];
    let ai_tools: Vec<DepStatus> = ai_names
        .iter()
        .map(|&name| {
            let path = which(name);
            DepStatus {
                name: name.into(),
                installed: path.is_some(),
                path,
            }
        })
        .collect();

    let any_ai_installed = ai_tools.iter().any(|t| t.installed);

    DependencyReport {
        tg,
        ai_tools,
        any_ai_installed,
    }
}

#[tauri::command]
pub fn spawn_setup_pty(
    app: AppHandle,
    pty_mgr: tauri::State<'_, PtyManagerMutex>,
    command: String,
    pty_id: String,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let home = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(["-l", "-c", &command]);
    cmd.cwd(&home);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {e}"))?;

    let event_name = format!("pty-output-{pty_id}");
    let pid = pty_id.clone();
    let app_for_reader = app.clone();

    let reader_handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app_for_reader.emit(&format!("pty-exit-{pid}"), ());
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];
                    let _ = app_for_reader.emit(&event_name, data.to_vec());
                }
                Err(_) => {
                    let _ = app_for_reader.emit(&format!("pty-exit-{pid}"), ());
                    break;
                }
            }
        }
    });

    // Store in PtyManager so write_to_session/resize_session/kill_session work
    use crate::pty_manager::PtySession;
    use crate::state::SessionInfo;

    let info = SessionInfo {
        id: pty_id.clone(),
        project_id: "__setup__".into(),
        label: "Setup".into(),
        command,
        channel: None,
        tool_session_id: None,
    };

    let session = PtySession {
        info,
        master: pair.master,
        writer,
        child,
        _reader_handle: reader_handle,
    };

    let mut mgr = pty_mgr.lock().unwrap();
    mgr.sessions.insert(pty_id, session);

    Ok(())
}
