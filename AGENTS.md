# touchgrass-app

Tauri v2 desktop app for touchgrass (Rust backend + Svelte 5 frontend).

## Stack

- **Backend**: Rust (Tauri v2)
- **Frontend**: Svelte 5 (runes: `$state`, `$props`, `$derived`, `$effect`)
- **Styling**: [oat.ink](https://oat.ink) (`@knadh/oat`)

## UI / Styling

Uses oat.ink as the base component library. Imported in `main.ts` as `@knadh/oat/oat.min.css`. Dark mode enabled via `data-theme="dark"` on `<body>`.

### Theme

oat.ink CSS variables are overridden in `src/styles/global.css` for the app's dark theme. The app also defines layout variables (`--bg-primary`, `--bg-secondary`, `--sidebar-width`, `--tab-height`, etc.) for structural styling.

### Component Patterns

Always use oat.ink semantic HTML. Reference: https://oat.ink/components/

**Buttons** — never write custom button CSS. Use oat classes/attributes:
```html
<button>Primary</button>
<button data-variant="secondary">Secondary</button>
<button data-variant="danger">Danger</button>
<button class="outline">Outline</button>
<button data-variant="danger" class="outline">Danger Outline</button>
<button class="ghost">Ghost</button>
<button class="small">Small</button>
<button class="large">Large</button>
<button disabled>Disabled</button>
```

**Form fields**:
```html
<label data-field>
  Name
  <input type="text" placeholder="..." />
</label>

<div data-field>
  <label for="my-select">Type</label>
  <select id="my-select">...</select>
</div>
```

**Input groups**:
```html
<fieldset class="group">
  <input type="text" />
  <button>Submit</button>
</fieldset>
```

**Toggles**:
```html
<label><input type="checkbox" role="switch" checked /> Label</label>
```

**Alerts**:
```html
<div role="alert">Info</div>
<div role="alert" data-variant="success">Success</div>
<div role="alert" data-variant="error">Error</div>
```

**Cards**:
```html
<article class="card">
  <header><h3>Title</h3></header>
  <p>Content</p>
  <footer>Actions</footer>
</article>
```

**Badges**:
```html
<span class="badge">Default</span>
<span class="badge success">Success</span>
<span class="badge danger">Danger</span>
```

**Spinners**:
```html
<div aria-busy="true"></div>
<span aria-busy="true" data-spinner="small"></span>
```

**Sidebar layout**:
```html
<div data-sidebar-layout>
  <aside data-sidebar>...</aside>
  <main>...</main>
</div>
```

## Agent DNA Avatar System

`AgentFace.svelte` renders pixel-art avatars from a 7-char hex DNA string. The DNA encodes 7 traits (eyes, mouth, hat, body, legs, face hue, hat hue) using mixed-radix packing with fixed slot sizes.

- DNA source of truth: `touchgrass/src/lib/avatar.ts`
- `AgentFace.svelte` duplicates the trait arrays and decode logic — **keep both files in sync** when adding/modifying traits
- Fixed slot sizes (eyes:8, mouths:8, hats:64, bodies:16, legs:16, hues:12) ensure adding variants doesn't break existing DNAs
- When no DNA is provided, falls back to a name-hash for deterministic appearance
- Pixel types: `f` (face), `e` (eye/dark), `m` (mouth/dark), `h` (hat), `l` (thin leg), `k` (thin hat), `_` (transparent)
- Eyes track the mouse cursor for an interactive effect
- `SoulTab.svelte` lets users edit agent soul fields (name, description, owner); DNA is preserved on save
- `agentSoul.ts` store loads/saves via the daemon's `/agent-soul` endpoint

## Storage

All data lives in `~/.touchgrass/`, shared with the CLI. The app owns `app-state.json`; everything else is owned by the CLI/daemon.

### `~/.touchgrass/app-state.json`

Desktop app state, read/written by the Rust backend (`src-tauri/src/config.rs`).

```jsonc
{
  "projects": [
    { "id": "uuid", "name": "my-project", "path": "/abs/path", "workspace_id": "personal" }
  ],
  "active_project_id": "uuid",
  "workspaces": [
    { "id": "personal", "name": "Personal" }
  ],
  "active_workspace_id": "personal",
  "presets": [
    { "id": "claude", "label": "claude --permission-mode acceptEdits", "command": "claude --permission-mode acceptEdits", "project_id": null, "enabled": true }
  ],
  "active_tabs": { "<project_id>": "<session_id>" },
  "saved_sessions": [
    { "id": "uuid", "project_id": "uuid", "label": "...", "command": "...", "channel": "telegram:Title", "tool_session_id": "..." }
  ],
  "theme": "dark",
  "color_scheme": "default",
  "code_editor": "code"
}
```

- **projects**: registered project folders, each assigned to a workspace
- **presets**: command presets shown in the new-session popover (can be global or per-project via `project_id`)
- **saved_sessions**: sessions persisted across app restarts (for resume). `channel` is prefixed (`"telegram:Title"`)
- **active_tabs**: tracks which session tab is selected per project
- **theme / color_scheme / code_editor**: user preferences

### Shared files from CLI (`~/.touchgrass/`)

The app reads these CLI-owned files at runtime:
- `daemon.sock` / `daemon.port` / `daemon.auth` — to communicate with the daemon
- `sessions/` — session JSONL files (for history/resume)
- `config.json` — channel info (to list available channels in the UI)

See the CLI `AGENTS.md` for the full `~/.touchgrass/` directory layout.

### Rules

- No custom button CSS — use oat.ink classes (`ghost`, `outline`, `small`, `large`) and `data-variant`
- No utility classes — use semantic HTML with oat.ink data attributes
- Use `role="switch"` for toggles, `role="alert"` for notices
- Use `aria-busy="true"` with `data-spinner` for loading states
- Keep component-specific layout overrides in scoped `<style>` blocks
- Only override oat.ink variables in `global.css`, not in component styles
