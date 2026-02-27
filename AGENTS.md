# ⛳ touchgrass.sh

## What This Project Does

touchgrass is a terminal bridge for controlling local AI CLI sessions from chat.
Its core product goal is to be the best possible remote controller for Claude Code, Codex, PI, Kimi, and similar terminal-first AI tools.
Users can build personal agents on top of touchgrass by defining behavior in `AGENTS.md` (without needing a separate agent runtime flag).

Supported channels:
- Telegram

## Runtime

- Runtime: Bun
- Language: TypeScript (strict)
- Transport: daemon + PTY + channel adapters
- Structure: Bun workspaces monorepo

## Monorepo Layout

```
packages/
  cli/      — @touchgrass/cli: CLI + daemon (the core product)
  web/      — @touchgrass/web: touchgrass.sh website (SvelteKit on Cloudflare)
  app/      — @touchgrass/app: Tauri v2 desktop app (Rust + Svelte 5)
```

The `termlings` avatar library is a separate open source package: https://github.com/tomtev/termlings (npm: `termlings`)

## CLI

For local development, use the `tg` shell alias (defined in `~/.zshrc`) which maps to `bun run /Users/tommyvedvik/Dev/touchgrass/packages/cli/src/main.ts`. This avoids needing an installed binary and prevents double-daemon conflicts. The installed binary is `touchgrass` with `tg` as a symlink alias.

```bash
touchgrass setup      # configure channel credentials (init alias exists)
touchgrass pair       # generate pairing code

touchgrass claude
touchgrass codex
touchgrass pi
touchgrass kimi

touchgrass office chat <session_id> "text"       # write into terminal (PTY stdin)
touchgrass office chat <session_id> --file <path> # write file path into terminal
touchgrass send <session_id> "text"         # send message to channel(s)
touchgrass send <session_id> --file <path>  # send file to channel(s)

touchgrass sessions              # alias: touchgrass ls
touchgrass channels
touchgrass links
touchgrass office peek <id>
touchgrass stop <id>
touchgrass kill <id>
```

> **Note:** `tg` works as a shorthand alias for `touchgrass` everywhere.

Telegram chat shorthands:
- `/files` or `touchgrass files <query>` opens the file picker (`.gitignore` aware when in a git repo)
- `@?<query>` is shorthand for the same picker
- `@?<query> - <prompt>` auto-resolves top fuzzy match and sends `@path - prompt`
- `/resume` or `touchgrass resume` opens a picker of recent local sessions and restarts the same tool on the selected session

## Architecture

1. CLI process (`touchgrass claude/codex/pi/kimi`):
- spawns PTY
- watches JSONL outputs
- bridges tool output to chat
- polls daemon for remote input

2. Daemon process:
- starts on demand
- receives messages from configured channel adapters
- routes messages to the correct session
- stops automatically after idle timeout

## Important Files

- `packages/termlings/src/index.ts` - shared avatar DNA system (encode/decode, grid generation, SVG/terminal render)
- `packages/cli/src/main.ts` - command entrypoint and help
- `packages/cli/src/cli/run.ts` - PTY/session bridge runtime
- `packages/cli/src/daemon/index.ts` - daemon wiring and routing
- `packages/cli/src/daemon/agent-soul.ts` - agent soul read/write (name, purpose, owner, DNA)
- `packages/cli/src/daemon/control-server.ts` - HTTP API for daemon (includes agent-soul endpoints)
- `packages/cli/src/bot/command-router.ts` - inbound message routing
- `packages/cli/src/bot/handlers/stdin-input.ts` - session input auto-routing
- `packages/cli/src/channel/types.ts` - channel interface contracts
- `packages/cli/src/channel/factory.ts` - channel instance creation
- `packages/cli/src/channels/telegram/*` - Telegram implementation

## Storage (`~/.touchgrass/`)

All config, runtime state, and session data lives in `~/.touchgrass/`. This directory is shared between the CLI and the desktop app.

| File / Dir | Purpose |
|---|---|
| `config.json` | Main config: channel credentials (bot tokens), paired users, linked groups, output batching settings, chat preferences (per-chat toggles like `thinking`) |
| `daemon.pid` | PID of the running daemon process |
| `daemon.sock` | Unix socket for CLI↔daemon IPC |
| `daemon.auth` | Auth token for daemon HTTP API |
| `daemon.lock` | Lock file to prevent multiple daemons |
| `daemon.port` | TCP port (written when daemon starts, used by the desktop app on non-Unix) |
| `sessions/` | Per-session JSONL files (`r-<id>.json`). Each file contains streamed tool output, tool calls, and assistant messages for one CLI session |
| `hooks/claude-hooks.sh` | Shell script installed into Claude Code hooks (`~/.claude/settings.json`) for instant permission/state detection |
| `logs/` | Daemon log files |
| `uploads/` | Temp storage for files sent via Telegram (photos, documents) |
| `status-boards.json` | Status board state (version, boards, jobs) |
| `app-state.json` | Desktop app state (see packages/app AGENTS.md) |

### `config.json` structure

```jsonc
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "credentials": { "botToken": "..." },
      "pairedUsers": [{ "userId": "telegram:<id>", "username": "...", "pairedAt": "..." }],
      "linkedGroups": [{ "chatId": "telegram:<id>", "title": "...", "linkedAt": "..." }]
    }
  },
  "settings": {
    "outputBatchMinMs": 300,
    "outputBatchMaxMs": 800,
    "outputBufferMaxChars": 4096,
    "maxSessions": 10,
    "defaultShell": "/bin/zsh"
  },
  "chatPreferences": {
    "telegram:<chatId>": { "thinking": true }
  }
}
```

## Agent DNA Avatar System

Each agent has a unique visual identity encoded as a **7-character hex DNA string** (e.g., `0a3f201`). DNA is generated during `termlings create` and stored in the `<agent-soul>` block of `AGENTS.md`. Legacy 6-char DNAs are still supported (parsed identically via `parseInt`).

> **Note:** Agent creation has moved to the termlings library. Use `termlings create` to scaffold new agents.

The avatar system lives in `packages/termlings/` and is shared across CLI, website, and desktop app via the `termlings` workspace package.

### Pixel grid

9 columns wide, variable rows tall. Pixel types:
- `f` = face/body color, `e` = eye (dark full block), `s` = squint eye (thin horizontal `▄▄`), `n` = narrow eye (thin vertical `▐▌`)
- `m` = mouth (thin dark `▀▀`), `q` = smile corner left (`▗`), `r` = smile corner right (`▖`)
- `d` = dark accent (full-block dark, for hat bands etc.)
- `h` = hat color (secondary hue), `l` = thin leg (`▌` in terminal), `k` = thin hat (`▐▌` in terminal)
- `_` = transparent

### DNA encoding

Mixed-radix packing with **fixed slot sizes** for forward compatibility:

| Trait | Current variants | Slot size |
|-------|-----------------|-----------|
| eyes | 11 | 12 |
| mouths | 7 | 12 |
| hats | 24 | 24 |
| bodies | 6 | 8 |
| legs | 6 | 8 |
| faceHue | 12 | 12 |
| hatHue | 12 | 12 |

Total: `12 × 12 × 24 × 8 × 8 × 12 × 12 = 31,850,496` slot space (~32M, 7 hex chars). Actual unique combos: ~13.5M (not all slots filled yet).

New trait variants can be added within slot limits without breaking existing DNA strings.

### Terminal rendering

`renderTerminal(dna)` outputs ANSI 24-bit color pixel art using `██` (2 chars per pixel for square proportions). Half-block chars `▌` and `▐▌` used for thin legs and hair details.

## Operational Notes

- Telegram is the only supported channel.
- This repo workflow is local-dev only.
- Installer sync rule: whenever `install.sh` or `install.ps1` changes, update/redeploy the website so `https://touchgrass.sh/install.sh` and `https://touchgrass.sh/install.ps1` serve the latest versions.
- Restart the daemon before testing runtime changes:
```bash
old_pid=$(cat ~/.touchgrass/daemon.pid 2>/dev/null || true)
[ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
tg channels
```
- In dev mode, restart the daemon after code changes so Telegram reflects updates:
```bash
old_pid=$(cat ~/.touchgrass/daemon.pid 2>/dev/null || true)
[ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
tg channels
```
- Session IDs are tagged and partial matching is supported in several CLI commands.
- Use `touchgrass stop` first and `touchgrass kill` only if needed.
- Keep routing changes covered by tests in `packages/cli/src/__tests__/`.
