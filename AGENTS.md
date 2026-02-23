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

## CLI

For local development, use the `tg` shell alias (defined in `~/.zshrc`) which maps to `bun run /Users/tommyvedvik/Dev/touchgrass/src/main.ts`. This avoids needing an installed binary and prevents double-daemon conflicts.

```bash
tg setup      # configure channel credentials (init alias exists)
tg pair       # generate pairing code

tg claude
tg codex
tg pi
tg kimi

tg write <session_id> "text"       # write into terminal (PTY stdin)
tg write <session_id> --file <path> # write file path into terminal
tg send <session_id> "text"         # send message to channel(s)
tg send <session_id> --file <path>  # send file to channel(s)

tg ls
tg channels
tg links
tg peek <id>
tg stop <id>
tg kill <id>
```

Telegram chat shorthands:
- `/files` or `tg files <query>` opens the file picker (`.gitignore` aware when in a git repo)
- `@?<query>` is shorthand for the same picker
- `@?<query> - <prompt>` auto-resolves top fuzzy match and sends `@path - prompt`
- `/resume` or `tg resume` opens a picker of recent local sessions and restarts the same tool on the selected session

## Architecture

1. CLI process (`tg claude/codex/pi/kimi`):
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

- `src/main.ts` - command entrypoint and help
- `src/cli/run.ts` - PTY/session bridge runtime
- `src/cli/agent.ts` - agent create command (generates DNA, renders terminal avatar)
- `src/lib/avatar.ts` - shared avatar DNA system (encode/decode, grid generation, terminal render)
- `src/daemon/index.ts` - daemon wiring and routing
- `src/daemon/agent-soul.ts` - agent soul read/write (name, purpose, owner, DNA)
- `src/daemon/control-server.ts` - HTTP API for daemon (includes agent-soul endpoints)
- `src/bot/command-router.ts` - inbound message routing
- `src/bot/handlers/stdin-input.ts` - session input auto-routing
- `src/channel/types.ts` - channel interface contracts
- `src/channel/factory.ts` - channel instance creation
- `src/channels/telegram/*` - Telegram implementation

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
| `app-state.json` | Desktop app state (see touchgrass-app AGENTS.md) |

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

Each agent has a unique visual identity encoded as a **6-character hex DNA string** (e.g., `a3f201`). DNA is generated during `tg agent create` and stored in the `<agent-soul>` block of `AGENTS.md`.

### Pixel grid

9 columns wide, variable rows tall. Pixel types:
- `f` = face/body color, `e` = eye (dark), `m` = mouth (dark)
- `h` = hat color (secondary hue), `l` = thin leg (`▌` in terminal), `k` = thin hat (`▐▌` in terminal)
- `_` = transparent

### DNA encoding

Mixed-radix packing with **fixed slot sizes** for forward compatibility:

| Trait | Current variants | Slot size |
|-------|-----------------|-----------|
| eyes | 6 | 12 |
| mouths | 6 | 12 |
| hats | 24 | 24 |
| bodies | 7 | 8 |
| legs | 8 | 8 |
| faceHue | 12 | 12 |
| hatHue | 12 | 12 |

Total: `12 × 12 × 24 × 8 × 8 × 12 × 12 = 15,925,248` (~16M combinations, 6 hex chars).

New trait variants can be added within slot limits without breaking existing DNA strings. Shared code in `src/lib/avatar.ts`. The desktop app (`AgentFace.svelte`) duplicates the trait arrays and decode logic — keep both in sync.

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
- Use `tg stop` first and `tg kill` only if needed.
- Keep routing changes covered by tests in `src/__tests__/`.
