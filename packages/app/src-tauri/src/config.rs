use crate::state::{AppState, Workspace, DEFAULT_PRESET_IDS};
use std::path::PathBuf;

fn state_path() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(".touchgrass").join("app-state.json")
}

pub fn load_state() -> AppState {
    let path = state_path();
    let mut state = if path.exists() {
        let data = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppState::default()
    };

    // Migrate workspaces: ensure "personal" workspace exists
    if state.workspaces.is_empty() || !state.workspaces.iter().any(|w| w.id == "personal") {
        if !state.workspaces.iter().any(|w| w.id == "personal") {
            state.workspaces.insert(
                0,
                Workspace {
                    id: "personal".into(),
                    name: "Personal".into(),
                },
            );
        }
    }
    if state.active_workspace_id.is_none() {
        state.active_workspace_id = Some("personal".into());
    }
    // Ensure all projects have a workspace_id
    for project in &mut state.projects {
        if project.workspace_id.is_empty() {
            project.workspace_id = "personal".into();
        }
    }

    // Migrate presets: ensure defaults exist, remove stale built-in ones
    let defaults = AppState::default();
    let default_ids: std::collections::HashSet<&str> =
        DEFAULT_PRESET_IDS.iter().copied().collect();

    // Remove built-in presets that are no longer in defaults
    state.presets.retain(|p| {
        p.project_id.is_some() || default_ids.contains(p.id.as_str()) || !is_old_builtin(&p.id)
    });

    // Add any missing default presets
    for dp in &defaults.presets {
        if !state.presets.iter().any(|p| p.id == dp.id) {
            state.presets.push(dp.clone());
        }
    }

    // Update command/label for existing defaults to match code
    for dp in &defaults.presets {
        if let Some(existing) = state.presets.iter_mut().find(|p| p.id == dp.id) {
            existing.command = dp.command.clone();
            existing.label = dp.label.clone();
        }
    }

    // Sort built-in presets to match default order, user presets stay at end
    let order: std::collections::HashMap<&str, usize> = DEFAULT_PRESET_IDS
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, i))
        .collect();
    state.presets.sort_by_key(|p| {
        order.get(p.id.as_str()).copied().unwrap_or(usize::MAX)
    });

    state
}

/// IDs of presets that were built-in in previous versions but may have been removed.
fn is_old_builtin(id: &str) -> bool {
    matches!(id, "shell" | "claude" | "claude-skip" | "codex" | "codex-auto" | "pi" | "kimi")
}

pub fn save_state(state: &AppState) {
    let path = state_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(&path, json);
    }
}
