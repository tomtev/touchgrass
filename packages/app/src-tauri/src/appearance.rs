use crate::config;
use crate::state::AppState;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn get_theme(state: State<'_, Mutex<AppState>>) -> String {
    let s = state.lock().unwrap();
    s.theme.clone()
}

#[tauri::command]
pub fn set_theme(state: State<'_, Mutex<AppState>>, theme: String) -> Result<(), String> {
    if !matches!(theme.as_str(), "dark" | "light" | "system") {
        return Err("Invalid theme. Must be dark, light, or system.".into());
    }
    let mut s = state.lock().unwrap();
    s.theme = theme;
    config::save_state(&s);
    Ok(())
}

#[tauri::command]
pub fn get_color_scheme(state: State<'_, Mutex<AppState>>) -> String {
    let s = state.lock().unwrap();
    s.color_scheme.clone()
}

#[tauri::command]
pub fn set_color_scheme(
    state: State<'_, Mutex<AppState>>,
    color_scheme: String,
) -> Result<(), String> {
    if !matches!(color_scheme.as_str(), "default" | "coffee" | "outdoor") {
        return Err("Invalid color scheme.".into());
    }
    let mut s = state.lock().unwrap();
    s.color_scheme = color_scheme;
    config::save_state(&s);
    Ok(())
}

#[tauri::command]
pub fn get_code_editor(state: State<'_, Mutex<AppState>>) -> String {
    let s = state.lock().unwrap();
    s.code_editor.clone()
}

#[tauri::command]
pub fn set_code_editor(state: State<'_, Mutex<AppState>>, editor: String) -> Result<(), String> {
    let trimmed = editor.trim().to_string();
    if trimmed.is_empty() {
        return Err("Editor command cannot be empty.".into());
    }
    let mut s = state.lock().unwrap();
    s.code_editor = trimmed;
    config::save_state(&s);
    Ok(())
}
