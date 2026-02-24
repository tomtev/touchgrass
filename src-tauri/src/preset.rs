use crate::config;
use crate::project::AppStateMutex;
use crate::state::Preset;
use tauri::State;

#[tauri::command]
pub fn list_presets(
    state: State<'_, AppStateMutex>,
    project_id: Option<String>,
) -> Vec<Preset> {
    let s = state.lock().unwrap();
    s.presets
        .iter()
        .filter(|p| p.project_id.is_none() || p.project_id == project_id)
        .cloned()
        .collect()
}

#[tauri::command]
pub fn add_preset(
    state: State<'_, AppStateMutex>,
    label: String,
    command: String,
    project_id: Option<String>,
) -> Preset {
    let mut s = state.lock().unwrap();
    let preset = Preset {
        id: uuid::Uuid::new_v4().to_string(),
        label,
        command,
        project_id,
        enabled: true,
    };
    s.presets.push(preset.clone());
    config::save_state(&s);
    preset
}

#[tauri::command]
pub fn remove_preset(state: State<'_, AppStateMutex>, preset_id: String) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.presets.retain(|p| p.id != preset_id);
    config::save_state(&s);
    Ok(())
}

#[tauri::command]
pub fn update_preset(
    state: State<'_, AppStateMutex>,
    preset_id: String,
    label: Option<String>,
    command: Option<String>,
    enabled: Option<bool>,
) -> Result<Preset, String> {
    let mut s = state.lock().unwrap();
    let preset = s
        .presets
        .iter_mut()
        .find(|p| p.id == preset_id)
        .ok_or_else(|| format!("Preset not found: {preset_id}"))?;

    if let Some(l) = label {
        preset.label = l;
    }
    if let Some(c) = command {
        preset.command = c;
    }
    if let Some(e) = enabled {
        preset.enabled = e;
    }

    let updated = preset.clone();
    config::save_state(&s);
    Ok(updated)
}

#[tauri::command]
pub fn reorder_presets(
    state: State<'_, AppStateMutex>,
    preset_ids: Vec<String>,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let mut reordered = Vec::with_capacity(s.presets.len());
    for id in &preset_ids {
        if let Some(pos) = s.presets.iter().position(|p| &p.id == id) {
            reordered.push(s.presets.remove(pos));
        }
    }
    // Append any remaining presets not in the reorder list
    reordered.append(&mut s.presets);
    s.presets = reordered;
    config::save_state(&s);
    Ok(())
}
