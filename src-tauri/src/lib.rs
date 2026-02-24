mod agent;
mod appearance;
mod config;
mod daemon;
mod hook_server;
mod preset;
mod project;
mod pty_manager;
mod setup;
mod state;
mod workspace;

use pty_manager::PtyManager;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = config::load_state();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Start hook notification server for Claude Code lifecycle events
            match hook_server::HookServer::start(app.handle().clone()) {
                Ok(server) => {
                    app.manage(server);
                }
                Err(e) => {
                    log::warn!("Hook server failed to start: {e}");
                }
            }
            Ok(())
        })
        .manage(Mutex::new(app_state))
        .manage(Mutex::new(PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            // Project commands
            project::list_projects,
            project::add_project,
            project::remove_project,
            project::set_active_project,
            project::get_active_project_id,
            project::set_active_tab,
            project::get_active_tab,
            project::reveal_in_finder,
            project::open_in_editor,
            project::set_default_channel,
            project::get_default_channel,
            // PTY commands
            pty_manager::spawn_session,
            pty_manager::write_to_session,
            pty_manager::resize_session,
            pty_manager::kill_session,
            pty_manager::list_sessions,
            pty_manager::get_saved_sessions,
            pty_manager::close_saved_session,
            pty_manager::set_tool_session_id,
            pty_manager::rename_session,
            pty_manager::get_last_session,
            // Preset commands
            preset::list_presets,
            preset::add_preset,
            preset::remove_preset,
            preset::update_preset,
            preset::reorder_presets,
            // Agent commands
            agent::create_agent,
            // Daemon commands
            daemon::daemon_health,
            daemon::daemon_list_channels,
            daemon::daemon_runtime_channels,
            daemon::daemon_get_channel,
            daemon::daemon_add_channel,
            daemon::daemon_remove_channel,
            daemon::daemon_remove_user,
            daemon::daemon_remove_group,
            daemon::daemon_generate_code,
            daemon::daemon_restart,
            daemon::daemon_input_needed,
            daemon::daemon_recent_sessions,
            daemon::daemon_list_skills,
            daemon::daemon_list_background_jobs,
            daemon::daemon_get_agent_soul,
            daemon::daemon_set_agent_soul,
            // Workspace commands
            workspace::list_workspaces,
            workspace::add_workspace,
            workspace::rename_workspace,
            workspace::remove_workspace,
            workspace::set_active_workspace,
            workspace::get_active_workspace_id,
            workspace::move_project_to_workspace,
            // Setup commands
            setup::check_dependencies,
            setup::spawn_setup_pty,
            // Appearance commands
            appearance::get_theme,
            appearance::set_theme,
            appearance::get_color_scheme,
            appearance::set_color_scheme,
            appearance::get_code_editor,
            appearance::set_code_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
