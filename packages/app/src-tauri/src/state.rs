use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_true() -> bool {
    true
}

fn default_theme() -> String {
    "system".into()
}

fn default_color_scheme() -> String {
    "default".into()
}

fn default_code_editor() -> String {
    "code".into()
}

fn default_workspace_id() -> String {
    "personal".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    #[serde(default)]
    pub default_channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub label: String,
    pub command: String,
    /// If Some, only applies to this project
    pub project_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub command: String,
    pub channel: Option<String>,
    /// The underlying tool's session ID (e.g. Claude Code's session ID for --resume)
    #[serde(default)]
    pub tool_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastSession {
    pub command: String,
    pub label: String,
    pub channel: Option<String>,
    pub tool_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub projects: Vec<Project>,
    pub active_project_id: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    pub presets: Vec<Preset>,
    /// project_id -> active tab session_id
    pub active_tabs: HashMap<String, String>,
    /// Sessions persisted across app restarts (for resume)
    #[serde(default)]
    pub saved_sessions: Vec<SessionInfo>,
    /// "dark" | "light" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// "default" | "coffee"
    #[serde(default = "default_color_scheme")]
    pub color_scheme: String,
    /// Code editor command (e.g. "code", "cursor", "zed", "idea")
    #[serde(default = "default_code_editor")]
    pub code_editor: String,
    /// project_id -> last session info (for quick resume when all sessions are closed)
    #[serde(default)]
    pub last_sessions: HashMap<String, LastSession>,
}

/// IDs of built-in default presets (used for migration on load).
pub const DEFAULT_PRESET_IDS: &[&str] = &["claude", "claude-skip", "codex", "codex-auto", "pi"];

impl Default for AppState {
    fn default() -> Self {
        Self {
            projects: Vec::new(),
            active_project_id: None,
            workspaces: vec![Workspace {
                id: "personal".into(),
                name: "Personal".into(),
            }],
            active_workspace_id: Some("personal".into()),
            presets: vec![
                Preset {
                    id: "claude".into(),
                    label: "claude --permission-mode acceptEdits".into(),
                    command: "claude --permission-mode acceptEdits".into(),
                    project_id: None,
                    enabled: true,
                },
                Preset {
                    id: "claude-skip".into(),
                    label: "claude --dangerously-skip-permissions".into(),
                    command: "claude --dangerously-skip-permissions".into(),
                    project_id: None,
                    enabled: true,
                },
                Preset {
                    id: "codex".into(),
                    label: "codex --approval-mode auto-edit".into(),
                    command: "codex --approval-mode auto-edit".into(),
                    project_id: None,
                    enabled: true,
                },
                Preset {
                    id: "codex-auto".into(),
                    label: "codex --full-auto".into(),
                    command: "codex --full-auto".into(),
                    project_id: None,
                    enabled: true,
                },
                Preset {
                    id: "pi".into(),
                    label: "pi".into(),
                    command: "pi".into(),
                    project_id: None,
                    enabled: true,
                },
            ],
            active_tabs: HashMap::new(),
            saved_sessions: Vec::new(),
            theme: "system".into(),
            color_scheme: "default".into(),
            code_editor: "code".into(),
            last_sessions: HashMap::new(),
        }
    }
}
