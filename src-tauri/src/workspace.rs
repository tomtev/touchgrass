use crate::config;
use crate::state::{AppState, Workspace};
use std::sync::Mutex;
use tauri::State;

pub type AppStateMutex = Mutex<AppState>;

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppStateMutex>) -> Vec<Workspace> {
    let s = state.lock().unwrap();
    s.workspaces.clone()
}

#[tauri::command]
pub fn add_workspace(state: State<'_, AppStateMutex>, name: String) -> Result<Workspace, String> {
    let mut s = state.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let workspace = Workspace {
        id: id.clone(),
        name,
    };
    s.workspaces.push(workspace.clone());
    config::save_state(&s);
    Ok(workspace)
}

#[tauri::command]
pub fn rename_workspace(
    state: State<'_, AppStateMutex>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let ws = s
        .workspaces
        .iter_mut()
        .find(|w| w.id == id)
        .ok_or("Workspace not found")?;
    ws.name = name;
    config::save_state(&s);
    Ok(())
}

#[tauri::command]
pub fn remove_workspace(state: State<'_, AppStateMutex>, id: String) -> Result<(), String> {
    if id == "personal" {
        return Err("Cannot delete the Personal workspace".into());
    }
    let mut s = state.lock().unwrap();
    if !s.workspaces.iter().any(|w| w.id == id) {
        return Err("Workspace not found".into());
    }
    // Move projects from deleted workspace to personal
    for project in &mut s.projects {
        if project.workspace_id == id {
            project.workspace_id = "personal".into();
        }
    }
    s.workspaces.retain(|w| w.id != id);
    // If the active workspace was deleted, switch to personal
    if s.active_workspace_id.as_deref() == Some(&id) {
        s.active_workspace_id = Some("personal".into());
    }
    config::save_state(&s);
    Ok(())
}

#[tauri::command]
pub fn set_active_workspace(state: State<'_, AppStateMutex>, id: String) {
    let mut s = state.lock().unwrap();
    s.active_workspace_id = Some(id);
    config::save_state(&s);
}

#[tauri::command]
pub fn get_active_workspace_id(state: State<'_, AppStateMutex>) -> Option<String> {
    let s = state.lock().unwrap();
    s.active_workspace_id.clone()
}

#[tauri::command]
pub fn move_project_to_workspace(
    state: State<'_, AppStateMutex>,
    project_id: String,
    workspace_id: String,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    // Validate workspace exists
    if !s.workspaces.iter().any(|w| w.id == workspace_id) {
        return Err("Workspace not found".into());
    }
    let project = s
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or("Project not found")?;
    project.workspace_id = workspace_id;
    config::save_state(&s);
    Ok(())
}
