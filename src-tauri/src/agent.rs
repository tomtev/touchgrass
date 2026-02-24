use crate::config;
use crate::daemon;
use crate::state::{AppState, Project};
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn create_agent(
    state: State<'_, Mutex<AppState>>,
    title: String,
    purpose: String,
    path: String,
) -> Result<Project, String> {
    let dest = std::path::Path::new(&path);

    // Create directory if needed
    if !dest.exists() {
        std::fs::create_dir_all(dest)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Build the tg agent create command
    let (program, base_args) = if let Some(bin) = daemon::find_tg_binary() {
        (bin.to_string_lossy().to_string(), vec![])
    } else if let Some((bun, main_ts)) = daemon::find_tg_dev() {
        (
            bun.to_string_lossy().to_string(),
            vec!["run".to_string(), main_ts.to_string_lossy().to_string()],
        )
    } else {
        return Err("Cannot find touchgrass binary. Install it or ensure 'tg' is in PATH.".to_string());
    };

    let mut args = base_args;
    args.extend([
        "agent".to_string(),
        "create".to_string(),
        path.clone(),
        "--name".to_string(),
        title.clone(),
        "--purpose".to_string(),
        purpose,
    ]);

    let output = std::process::Command::new(&program)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run agent create: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Agent creation failed: {}{}",
            stderr.trim(),
            if stdout.trim().is_empty() { String::new() } else { format!("\n{}", stdout.trim()) }
        ));
    }

    // Add as project
    let mut s = state.lock().unwrap();

    // Check for duplicate path
    if s.projects.iter().any(|p| p.path == path) {
        return Err("Project already exists at this path".into());
    }

    let ws_id = s
        .active_workspace_id
        .clone()
        .unwrap_or_else(|| "personal".into());
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: title,
        path,
        workspace_id: ws_id,
        default_channel: None,
    };

    s.projects.push(project.clone());
    s.active_project_id = Some(project.id.clone());
    config::save_state(&s);

    Ok(project)
}
