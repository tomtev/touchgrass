# Touchgrass Desktop App

## Overview

A Tauri (Rust + Web) desktop app that gives users a native terminal experience for touchgrass.
It bundles the `tg` binary as a sidecar so users don't need to install anything separately.
Multiple terminal tabs per project, each connected to channels like Telegram.

## Why Tauri

- **Small bundle** (~5-10MB vs Electron's ~150MB) — uses OS-native webview
- **Rust backend** — real PTY spawning, fast IPC, cross-platform
- **First-class sidecar support** — bundle the `tg` binary for users who don't have it
- **Web frontend** — full access to xterm.js and any UI framework
- **Cross-platform** — macOS, Linux, Windows from one codebase

## Layout

The app is project-centric. The left sidebar is the primary navigation — it lists all projects and lets you switch between them. Each project has its own set of terminal tabs. This is similar to how VS Code's sidebar scopes everything to a workspace, or how Discord's server list scopes channels.

```
┌─────────┬──────────────────────────────────────┐
│ SIDEBAR │  Tab Bar: [claude] [codex] [+]       │
│         │──────────────────────────────────────│
│ ⚙       │                                      │
│         │                                      │
│ ▶ myapp │         xterm.js terminal            │
│   api   │         (active tab)                 │
│   web   │                                      │
│         │                                      │
│ ▶ blog  │                                      │
│         │                                      │
│ + Add   │                                      │
│         │                                      │
│         │                                      │
│ 📡 TG ● │                                      │
└─────────┴──────────────────────────────────────┘
```

### Left Sidebar

- **Project list** — each project is a folder on disk (cwd)
- Clicking a project switches the tab bar to that project's terminals
- Each project shows its name (folder basename) and active session count
- Expand a project to see its individual sessions inline
- **"+ Add Project"** — opens a dropdown: "Open folder" (any folder) or "Create agent" (scaffolds an agent project)
- **Channel status** — bottom of sidebar, shows connected channels (Telegram dot = green when linked)
- **Settings gear** — top or bottom of sidebar
- Collapsible (hotkey to toggle, e.g. Cmd+B)

### Tab Bar (per project)

- Scoped to the selected project — switching projects switches tabs
- Each tab = one terminal session running `tg <tool> [flags]`
- **"+" button** — opens a **popover** with preset commands (see Presets below)
- Drag to reorder tabs within a project
- Close button per tab (with confirm if session is active)
- Right-click: rename, duplicate, kill

### Presets Popover

Clicking "+" in the tab bar opens a popover (oat.ink Dropdown) showing launch presets. Each preset defines a tool + flags combo so users can one-click into their preferred setup.

```
┌─────────────────────────────────────┐
│  New Terminal                       │
│─────────────────────────────────────│
│  ▸ Claude                          │
│  ▸ Claude (dangerously skip)       │
│  ▸ Claude (plan mode)              │
│  ▸ Codex                           │
│  ▸ Codex (full auto)               │
│  ▸ PI                              │
│  ▸ Kimi                            │
│  ▸ Shell                           │
│─────────────────────────────────────│
│  ✎ Custom command...               │
│  ⚙ Edit presets...                 │
└─────────────────────────────────────┘
```

**Built-in presets** (shipped with app):
| Label | Command |
|-------|---------|
| Claude | `tg claude` |
| Claude (dangerously skip) | `tg claude --dangerously-skip-permissions` |
| Claude (plan mode) | `tg claude --plan` |
| Codex | `tg codex` |
| Codex (full auto) | `tg codex --full-auto` |
| PI | `tg pi` |
| Kimi | `tg kimi` |
| Shell | Plain shell (no tg wrapper) |

**Custom command** — opens a text input where user can type any command (e.g. `tg claude --model sonnet --allowedTools Bash,Read`).

**Channel selector** — each preset row can optionally show a channel tag. By default, new tabs use the project's default channel (if set) or no channel. The user picks a channel in the popover before launching, or changes it later on a running tab.

**Edit presets** — opens a settings subpanel where users can:
- Add/remove/reorder presets
- Each preset has: label, command, optional icon/color, optional default channel
- Presets are per-project (override) or global (default)
- Import/export presets as JSON

### Channel Assignment

Every terminal tab can be connected to zero or more channels (Telegram groups/DMs). This is how remote control works — the channel receives output and can send input to the session.

**How channels work per tab:**
- A tab starts with no channel, the project's default channel, or a preset's default channel
- The tab bar shows a small channel indicator next to the tab label (e.g. a colored dot or channel icon)
- Clicking the indicator (or right-click → "Channels...") opens a **channel popover** on the tab

**Channel popover on a running tab:**
```
┌──────────────────────────────┐
│  Channels for "claude"       │
│──────────────────────────────│
│  ✓ TG: My Dev Group         │
│  ○ TG: Personal DM          │
│  ○ TG: Team Chat             │
│──────────────────────────────│
│  + Link new channel          │
└──────────────────────────────┘
```

- Lists all available channels (configured via `tg setup` / `tg pair`)
- Checkboxes — a tab can be linked to multiple channels simultaneously
- Changes take effect immediately on a running session (sends `tg` commands under the hood to attach/detach channels)
- "Link new channel" opens the channel setup flow

**Under the hood**, changing channels on a running tab calls:
- `tg send --attach <session_id> <channel_id>` to connect
- `tg send --detach <session_id> <channel_id>` to disconnect
- Or the Rust backend manages this directly via the daemon API

### Main Area

- Full xterm.js terminal for the active tab
- Resizes fluidly with window
- When no project is selected or no tabs exist: empty state with "Create your first session" prompt

## Architecture

```
┌───────────────────────────────────────────────────┐
│  Tauri App                                        │
│                                                   │
│  ┌──────────────── Frontend ────────────────────┐ │
│  │                                              │ │
│  │  ┌──────────┬───────────────────────────┐    │ │
│  │  │ Sidebar  │  TabBar (per project)     │    │ │
│  │  │          │  ┌─────────────────────┐  │    │ │
│  │  │ Projects │  │                     │  │    │ │
│  │  │ ├ myapp  │  │   xterm.js          │  │    │ │
│  │  │ ├ blog   │  │   (active session)  │  │    │ │
│  │  │ └ api    │  │                     │  │    │ │
│  │  │          │  └─────────────────────┘  │    │ │
│  │  │ Channels │                           │    │ │
│  │  │ Settings │                           │    │ │
│  │  └──────────┴───────────────────────────┘    │ │
│  │                                              │ │
│  └──────────────────┬───────────────────────────┘ │
│                     │ Tauri IPC (invoke + events)  │
│  ┌──────────────────▼───────────────────────────┐ │
│  │  Rust Backend                                │ │
│  │                                              │ │
│  │  Project Registry                            │ │
│  │  ├─ add/remove projects (by folder path)     │ │
│  │  ├─ persist project list + metadata          │ │
│  │  └─ each project owns N sessions             │ │
│  │                                              │ │
│  │  PTY Manager                                 │ │
│  │  ├─ spawn(tool, project_id) → session_id     │ │
│  │  ├─ write(session_id, data)                  │ │
│  │  ├─ resize(session_id, cols, rows)           │ │
│  │  └─ kill(session_id)                         │ │
│  │                                              │ │
│  │  Config Manager                              │ │
│  │  ├─ channel credentials                      │ │
│  │  └─ app preferences                          │ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  Sidecar: tg binary (bundled per-platform)        │
└───────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| App framework | Tauri v2 | Rust + webview |
| Frontend | Svelte 5 (or React) | Tauri's default scaffold uses Svelte |
| Terminal emulator | xterm.js | Industry standard, used by VS Code |
| xterm addons | xterm-addon-fit, xterm-addon-webgl | Auto-resize + GPU rendering |
| PTY (Rust) | `portable-pty` crate | Real PTY, not just stdin/stdout pipes |
| IPC streaming | Tauri events | Bidirectional byte streaming pty ↔ xterm |
| Sidecar | `tauri.conf.json` externalBin | Bundle `tg` binary per platform |
| UI components | [oat.ink](https://oat.ink) | Framework-agnostic, zero-dep CSS/JS library — Sidebar, Tabs, Dialog, etc. |
| Styling | oat.ink + custom CSS | oat handles layout primitives; custom CSS for terminal-specific styling |

## Sidecar Strategy

### Bundling

In `tauri.conf.json`:
```json
{
  "bundle": {
    "externalBin": ["binaries/tg"]
  }
}
```

Platform binaries follow Tauri's naming convention:
```
binaries/
  tg-aarch64-apple-darwin      # macOS ARM
  tg-x86_64-apple-darwin       # macOS Intel
  tg-x86_64-unknown-linux-gnu  # Linux x86
  tg-aarch64-unknown-linux-gnu # Linux ARM
  tg-x86_64-pc-windows-msvc.exe
```

These are the same binaries already built for touchgrass releases.

### Resolution Order

1. Check if user has `tg` on PATH (system install)
2. Fall back to bundled sidecar binary
3. This lets power users use their own version while new users get zero-config

## Data Model

Projects are the top-level grouping. Each project has a folder path and owns multiple sessions.

```
App State
├── projects: Map<project_id, Project>
│   ├── Project { id, name, path, sessions[], active_tab_index, presets?, defaultChannels? }
│   │   ├── Session { id, preset/command, channels[], pty, created_at, label }
│   │   ├── Session { ... }
│   │   └── Session { ... }
│   └── Project { ... }
├── active_project_id: string
├── presets: Preset[]          # global default presets
├── channels: Channel[]        # all configured channels (from tg config)
└── config: AppConfig
```

Persisted to `~/.touchgrass/app-state.json`:
```json
{
  "presets": [
    { "id": "claude",      "label": "Claude",                    "command": "tg claude" },
    { "id": "claude-skip", "label": "Claude (dangerously skip)", "command": "tg claude --dangerously-skip-permissions" },
    { "id": "claude-plan", "label": "Claude (plan mode)",        "command": "tg claude --plan" },
    { "id": "codex",       "label": "Codex",                     "command": "tg codex" },
    { "id": "codex-auto",  "label": "Codex (full auto)",         "command": "tg codex --full-auto" },
    { "id": "pi",          "label": "PI",                        "command": "tg pi" },
    { "id": "kimi",        "label": "Kimi",                      "command": "tg kimi" },
    { "id": "shell",       "label": "Shell",                     "command": "$SHELL" }
  ],
  "projects": [
    {
      "id": "proj_abc123",
      "name": "myapp",
      "path": "/Users/tommy/Dev/myapp",
      "defaultChannels": ["tg:group:-100123456"],
      "tabs": [
        { "presetId": "claude-skip", "label": "claude", "channels": ["tg:group:-100123456"] },
        { "presetId": "codex",       "label": "codex",  "channels": [] },
        { "command": "tg claude --model sonnet", "label": "sonnet", "channels": ["tg:dm:789"] }
      ],
      "presets": [],
      "activeTab": 0
    }
  ],
  "activeProject": "proj_abc123"
}
```

- Tabs reference a `presetId` (resolved from global or project presets) or a raw `command` for custom entries
- Each tab has a `channels` array — which channels it's connected to for remote I/O
- Projects have `defaultChannels` — new tabs inherit these unless overridden
- Channel IDs follow the format `tg:<type>:<chat_id>` (matches existing touchgrass convention)

On launch, the app restores the project list and re-spawns sessions for each saved tab.

## Rust Backend — Key Modules

### `project.rs`

```rust
struct Project {
    id: String,
    name: String,           // folder basename, user-renameable
    path: PathBuf,
    sessions: Vec<String>,  // session IDs
    active_tab: usize,
}
```

Commands:
```rust
#[tauri::command]
fn add_project(path: &str) -> Result<ProjectInfo, String>

#[tauri::command]
fn remove_project(project_id: &str) -> Result<(), String>

#[tauri::command]
fn list_projects() -> Vec<ProjectInfo>

#[tauri::command]
fn set_active_project(project_id: &str) -> Result<(), String>
```

### `pty_manager.rs`

Owns all PTY sessions. Each session belongs to a project.

```rust
struct PtySession {
    id: String,
    project_id: String,
    command: String,        // full command, e.g. "tg claude --dangerously-skip-permissions"
    label: String,          // display name for tab
    channels: Vec<String>,  // attached channel IDs, e.g. ["tg:group:-100123456"]
    cwd: PathBuf,           // inherited from project.path
    master: Box<dyn MasterPty>,
    child: Box<dyn Child>,
    created_at: Instant,
}
```

Commands:
```rust
#[tauri::command]
fn spawn_session(project_id: &str, command: &str, channels: Vec<&str>) -> Result<String, String>

#[tauri::command]
fn write_to_session(session_id: &str, data: &[u8]) -> Result<(), String>

#[tauri::command]
fn resize_session(session_id: &str, cols: u16, rows: u16) -> Result<(), String>

#[tauri::command]
fn kill_session(session_id: &str) -> Result<(), String>

#[tauri::command]
fn list_sessions(project_id: &str) -> Vec<SessionInfo>

#[tauri::command]
fn attach_channel(session_id: &str, channel_id: &str) -> Result<(), String>

#[tauri::command]
fn detach_channel(session_id: &str, channel_id: &str) -> Result<(), String>

#[tauri::command]
fn list_channels() -> Vec<ChannelInfo>  // all configured channels from tg config
```

PTY output is streamed to the frontend via Tauri events:
```rust
// Rust side — reader thread per session
app_handle.emit(&format!("pty-output-{}", session_id), data)?;
```

```js
// Frontend side — xterm.js listener
listen(`pty-output-${sessionId}`, (event) => {
  terminal.write(event.payload);
});
```

### `agent.rs`

Handles agent project scaffolding:
```rust
#[tauri::command]
fn create_agent(title: &str, description: &str, path: &str) -> Result<ProjectInfo, String>
```

This:
1. Creates the directory at `path` if needed
2. Runs `tg agent create --title "..." --description "..."` in that directory
3. Returns a `ProjectInfo` so the frontend can add it to the sidebar

### `config.rs`

Reads/writes `~/.touchgrass/config.json` for:
- Channel credentials (Telegram bot token, etc.)
- App preferences (theme, font size, default tool)

Reads/writes `~/.touchgrass/app-state.json` for:
- Project list + metadata
- Active project selection
- Tab state per project (restored on launch)

## Frontend — Key Components

### App Layout

```
AppLayout
├── Sidebar (left, fixed width, collapsible)
│   ├── ProjectList
│   │   ├── ProjectItem (click to switch, expand to see sessions)
│   │   └── AddProjectButton (opens native folder picker)
│   ├── ChannelStatus (bottom section)
│   └── SettingsButton
├── MainPanel (right, fills remaining space)
│   ├── TabBar (scoped to active project)
│   │   ├── SessionTab[] (click to switch, close button, drag to reorder)
│   │   └── AddTabButton (opens tool picker)
│   └── TerminalView (active session's xterm.js)
└── EmptyState (shown when no project/session selected)
```

### Sidebar (`Sidebar.svelte`)

The primary navigation. Always visible (unless collapsed).

```
Sidebar
├── logo / app name at top
├── project list (scrollable)
│   ├── each project: icon + name + session count badge
│   ├── selected project highlighted
│   ├── expand project → inline list of sessions with tool icons
│   └── right-click project → rename, remove, open in Finder/Explorer
├── "+ Add Project" button → dropdown: "Open folder" / "Create agent"
├── divider
├── channel status section
│   └── Telegram: ● connected / ○ disconnected
└── settings gear icon
```

### TabBar (`TabBar.svelte`)

Scoped to the currently selected project. Switching projects swaps the entire tab bar.

- Each tab shows: tool icon + label + close (×)
- "+" button → opens PresetPopover (see Presets Popover above)
- Active tab underlined or highlighted
- Drag to reorder within the project
- Tabs persist across app restarts (saved in app-state.json)
- Double-click tab label to rename

### PresetPopover (`PresetPopover.svelte`)

Uses oat.ink Dropdown component. Anchored to the "+" button.

- Lists global presets, then project-specific presets (if any), separated by a divider
- Each item shows: label + subtle command preview (e.g. `--dangerously-skip-permissions`)
- Bottom of popover: channel selector (which channel(s) to connect on launch, defaults to project default)
- Click a preset → spawns a new tab with that command + selected channels
- "Custom command..." → inline text input, Enter to spawn
- "Edit presets..." → navigates to preset editor in settings

### ChannelPopover (`ChannelPopover.svelte`)

Opened from the channel indicator on a tab (small icon/dot next to the tab label), or via right-click → "Channels...".

- Lists all configured channels with checkboxes
- Checked = currently attached to this session
- Toggle a checkbox → immediately attaches/detaches the channel on the running session
- Shows channel type icon (Telegram) + chat name
- "Link new channel" → opens channel setup flow
- Changes persist to app-state.json so they restore on relaunch

### TerminalView (`TerminalView.svelte`)

```
TerminalView
├── xterm.js instance (one per session, hidden when not active)
├── fit addon (auto-resize on window/panel change)
├── webgl addon (GPU-accelerated rendering)
├── onData → invoke("write_to_session", { id, data })
├── listen("pty-output-{id}") → terminal.write(payload)
└── onResize → invoke("resize_session", { id, cols, rows })
```

Terminal instances are kept alive when switching tabs (not destroyed/recreated).
Switching tabs just shows/hides the xterm container div.

### Settings Panel (`Settings.svelte`)

- Channel setup (runs `tg setup` in embedded terminal, or native form)
- Theme picker (dark / light / system)
- Font family and size
- Default tool selection
- Keybindings
- About / version info

## User Flows

### First Launch (no tg installed)

1. App opens → welcome screen (empty state, no projects)
2. User clicks "Get Started"
3. App runs bundled `tg setup` in an embedded terminal
4. User enters Telegram bot token
5. App shows "Pair your device" → runs `tg pair`
6. User scans/enters code in Telegram
7. "Add your first project" → folder picker → project appears in sidebar
8. Click "+" tab → pick Claude → terminal opens with `tg claude` in that project dir

### First Launch (tg already installed)

1. App detects existing `~/.touchgrass/config.json`
2. Skips setup, shows main UI with empty project list
3. Optionally imports existing running sessions from `tg ls` and groups them by cwd into auto-created projects

### Daily Use

1. Open app → sidebar shows saved projects, last active project is selected
2. Tabs from last session are restored (re-spawned)
3. Work in a terminal, messages flow to/from Telegram
4. Switch to another project in sidebar → tab bar swaps to that project's sessions
5. Click "+" in tab bar → pick tool → new terminal tab for that project
6. Close app → sessions can optionally keep running (daemon stays alive)

### Adding a New Project

Projects can be **any folder** — not just git repos. A project is simply a working directory that scopes terminal sessions.

1. Click "+ Add Project" in sidebar
2. A dialog offers two options:
   - **Open existing folder** → native folder picker → project appears in sidebar
   - **Create new agent project** → opens agent creation form (see below)
3. Project appears in sidebar with folder name
4. Project is now active, tab bar is empty → click "+" to create first session

### Creating an Agent Project

When creating a new project, the user can optionally scaffold it as a touchgrass agent. This runs `tg agent create` under the hood and pre-populates the project with an `AGENTS.md` file.

```
┌─────────────────────────────────────┐
│  Create Agent Project               │
│─────────────────────────────────────│
│                                     │
│  Title:  [ My Research Agent     ]  │
│                                     │
│  Description:                       │
│  [ Helps me research topics and  ]  │
│  [ summarize findings            ]  │
│                                     │
│  Location:                          │
│  [ ~/Dev/my-research-agent    📂 ]  │
│                                     │
│         [Cancel]  [Create Agent]    │
└─────────────────────────────────────┘
```

Flow:
1. User fills in title, description, and picks a folder location
2. App creates the folder (if it doesn't exist)
3. App runs `tg agent create --title "..." --description "..."` in that folder
4. This generates `AGENTS.md` with the agent definition
5. Project is added to sidebar with the agent title as the name
6. First tab auto-opens with `tg claude` (or user's default preset) in that directory

### Connecting a Channel

1. Click channel status area in sidebar (or settings)
2. "Add Telegram" → embedded terminal runs `tg setup`
3. Or: native UI form that writes config directly
4. Once connected, green dot appears next to channel name in sidebar

## Project Structure

```
touchgrass-app/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri entry, command registration
│   │   ├── project.rs           # Project CRUD, persistence
│   │   ├── pty_manager.rs       # PTY spawn/read/write/resize/kill
│   │   ├── agent.rs             # Agent project scaffolding (tg agent create)
│   │   ├── config.rs            # App config + state persistence
│   │   └── sidecar.rs           # tg binary resolution (PATH vs bundled)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── binaries/                # Platform-specific tg binaries
│       ├── tg-aarch64-apple-darwin
│       ├── tg-x86_64-unknown-linux-gnu
│       └── tg-x86_64-pc-windows-msvc.exe
├── src/
│   ├── App.svelte               # Root layout (sidebar + main panel)
│   ├── lib/
│   │   ├── Sidebar.svelte       # Project list, channels, settings link
│   │   ├── ProjectItem.svelte   # Single project row (expandable)
│   │   ├── TabBar.svelte        # Session tabs for active project
│   │   ├── TerminalView.svelte  # xterm.js wrapper (one per session)
│   │   ├── PresetPopover.svelte  # "+" popover with launch presets + custom command
│   │   ├── ChannelPopover.svelte # Per-tab channel attach/detach popover
│   │   ├── AgentCreator.svelte  # Agent project creation form (title, desc, path)
│   │   ├── Settings.svelte      # Settings panel
│   │   ├── EmptyState.svelte    # Welcome / "add project" prompt
│   │   └── stores/
│   │       ├── projects.ts      # Project list + active project state
│   │       ├── sessions.ts      # Session state per project
│   │       ├── presets.ts       # Global + per-project preset management
│   │       └── config.ts        # App config state
│   └── styles/
│       └── global.css           # oat.ink imports + terminal overrides
├── package.json
├── svelte.config.js
└── vite.config.ts
```

## Build & Release

### Development
```bash
cd touchgrass-app
cargo tauri dev          # launches app with hot-reload
```

### Building

Tauri builds per-platform:
```bash
cargo tauri build        # .dmg (macOS), .deb/.AppImage (Linux), .msi (Windows)
```

### CI/CD

GitHub Actions matrix:
- macOS ARM + Intel (universal binary possible)
- Linux x86_64
- Windows x86_64

Each build:
1. Downloads the matching `tg` release binary
2. Places it in `src-tauri/binaries/` with correct target triple name
3. Runs `cargo tauri build`
4. Uploads installer artifact

### Auto-Update

Tauri v2 has built-in updater support:
- App checks for updates on launch
- Downloads + applies delta updates
- Can point at GitHub Releases or custom endpoint

## Open Questions

- **Frontend framework**: Svelte 5 (lighter, Tauri default, pairs well with oat.ink's vanilla approach) vs React?
- **Session persistence**: Should closing the app kill PTY sessions or keep them running via the daemon?
- **Tab restore**: Restore last session's tabs on reopen, or start fresh?
- **Native setup UI**: Run `tg setup` in embedded terminal, or build a native form that writes config directly?
- **Repo location**: Separate repo (`touchgrass-app`) or monorepo subfolder?
- **Licensing**: Same as touchgrass CLI, or separate?

## MVP Scope

Phase 1 — Working project-based terminal app:
1. Tauri v2 scaffold with Svelte 5
2. oat.ink Sidebar component for project list (left panel)
3. oat.ink Tabs component for session tab bar (per project)
4. Rust project registry (add/remove/switch projects)
5. Rust PTY manager (spawn, read, write, resize, kill per session)
6. xterm.js terminal component with fit + webgl addons
7. Bundle `tg` sidecar binaries
8. Spawn `tg <tool>` scoped to project directory
9. "+" button in sidebar (add project via folder picker)
10. "+" button in tab bar (add session via tool picker)

Phase 2 — Persistence & polish:
1. App state persistence (projects, tabs, active selections restored on launch)
2. Settings panel (theme, font, default tool, channel setup)
3. Channel status indicator in sidebar
4. Session keep-alive when switching tabs (hidden, not destroyed)
5. Empty states (no projects, no sessions)
6. Keyboard shortcuts (Cmd+T new tab, Cmd+W close tab, Cmd+1-9 switch tabs, Cmd+B toggle sidebar)

Phase 3 — Distribution:
1. CI/CD for macOS (ARM + Intel), Linux x86, Windows
2. Auto-updater via Tauri v2 updater
3. Download section on touchgrass.sh
4. Homebrew cask, winget, AUR packages
