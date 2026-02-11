# TouchGrass — touchgrass.sh

## What This Project Does

Manage your AI agent CLIs (Claude Code, Codex, PI) from your phone via messaging platforms. Currently supports Telegram, designed for adding Discord/Slack/WhatsApp via the `Channel` interface.

CLI command: `tg` (as in TouchGrass).

**Runtime:** Bun (not Node.js). **Language:** TypeScript (strict mode). **No framework** — raw HTTP, raw Telegram Bot API.

## Quick Reference

```bash
bun run dev           # Run via bun (dev)
bun run build         # Compile to standalone binary
bun run typecheck     # tsc --noEmit
```

CLI commands: `tg init`, `tg pair`, `tg claude [args]`, `tg codex [args]`, `tg pi [args]`, `tg ls`, `tg doctor`, `tg config`, `tg logs`

## Architecture Overview

Two processes cooperate:

1. **CLI process** (`tg claude`) — spawns a PTY, watches JSONL for assistant output, sends to Telegram, polls daemon for remote input
2. **Daemon process** — auto-starts on demand, polls Telegram for messages, routes them to sessions, auto-stops after 30s idle

```
User terminal                         Telegram
    |                                     |
  tg claude                          TelegramChannel
    |                                     |
  PTY + JSONL watcher              startReceiving() poll loop
    |                                     |
  daemon (Unix socket)  <-------->  command-router
    |                                     |
  SessionManager  <---  stdin-input handler
```

## File Map

### Core Abstractions
| File | Purpose |
|------|---------|
| `src/channel/types.ts` | `Channel` interface, `InboundMessage`, `ChannelChatId`, `ChannelUserId` |
| `src/channels/telegram/channel.ts` | `TelegramChannel` implements `Channel` — sends messages, polls for updates, strips @mentions |
| `src/channels/telegram/api.ts` | Raw Telegram Bot API wrapper (sendMessage, editMessageText, getUpdates, getFile) |
| `src/channels/telegram/formatter.ts` | `escapeHtml()`, `chunkText()` — Telegram-specific |

### Bot Layer (channel-agnostic)
| File | Purpose |
|------|---------|
| `src/bot/command-router.ts` | Routes `InboundMessage` to handlers. `RouterContext` = { config, sessionManager, channel } |
| `src/bot/handlers/stdin-input.ts` | Smart 6-step input routing (reply-to, prefix, attached, auto-route, disambiguate) |
| `src/bot/handlers/pair.ts` | Pairing code validation |
| `src/bot/handlers/help.ts` | Help text |
| `src/bot/handlers/spawn.ts` | Spawn daemon-managed sessions |
| `src/bot/handlers/session-mgmt.ts` | ls, attach, detach, stop, kill |

### Session Management
| File | Purpose |
|------|---------|
| `src/session/manager.ts` | `SessionManager` — spawns sessions, manages remotes, attachments, group subscriptions, message tracking |
| `src/session/session.ts` | `Session` — PTY wrapper with output buffering |
| `src/session/types.ts` | `SessionState`, `SessionInfo`, `SessionEvents` |
| `src/session/output-buffer.ts` | Batches output to prevent message flooding |

### Daemon
| File | Purpose |
|------|---------|
| `src/daemon/index.ts` | Entry point — creates channels from config, wires SessionManager + router, auto-stop timer |
| `src/daemon/control-server.ts` | Unix socket HTTP server (`~/.tg/daemon.sock`) — register/input/exit/track-message/subscribed-groups endpoints |
| `src/daemon/lifecycle.ts` | PID file, signal handlers, shutdown callbacks |
| `src/daemon/logger.ts` | JSON logger → `~/.tg/logs/daemon.log` |

### CLI
| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point — routes CLI commands via dynamic import |
| `src/cli/run.ts` | `tg claude/codex/pi` — PTY, JSONL watcher, daemon registration, group output polling |
| `src/cli/ensure-daemon.ts` | Auto-starts daemon if not running |
| `src/cli/init.ts` | Interactive bot token setup |
| `src/cli/pair.ts` | Generate pairing codes |
| `src/cli/doctor.ts` | Health checks |
| `src/cli/config.ts` | View/edit config |
| `src/cli/ls.ts` | List sessions |
| `src/cli/client.ts` | `daemonRequest()` helper for Unix socket |
| `src/cli/logs.ts` | Tail daemon log |

### Config & Security
| File | Purpose |
|------|---------|
| `src/config/schema.ts` | `TgConfig`, `ChannelConfig`, `PairedUser`, `TgSettings`, helpers |
| `src/config/store.ts` | Load/save config with auto-migration from old format |
| `src/config/paths.ts` | All paths under `~/.tg/` |
| `src/security/allowlist.ts` | `isUserPaired()`, `addPairedUser()`, `removePairedUser()` — searches across all channels |
| `src/security/rate-limiter.ts` | Brute-force protection for pairing (5 attempts/min) |
| `src/security/pairing.ts` | SHA256-hashed single-use pairing codes (10 min expiry) |

### Utilities
| File | Purpose |
|------|---------|
| `src/utils/ansi.ts` | `stripAnsi()`, `markdownToHtml()`, re-exports `escapeHtml`/`chunkText` |

## Key Design Patterns

### Tagged String IDs
All IDs are prefixed with channel type for disambiguation:
- `ChannelChatId`: `"telegram:123456"`, `"telegram:-987654"` (groups are negative)
- `ChannelUserId`: `"telegram:123456"`
- Message refs: `"telegram:42"` (for reply-to tracking)
- Remote session IDs: `"r-abc123"` (3-byte hex, no channel prefix)

### Channel Interface
Handlers send simple HTML (`<b>`, `<i>`, `<code>`, `<pre>`). Each channel implementation converts to native format if needed. `TelegramChannel` sends as-is. A future Discord channel would convert `<b>` → `**bold**`, `<code>` → backticks.

New channel checklist:
1. Create `src/channels/<name>/channel.ts` implementing `Channel`
2. Add channel creation in `src/daemon/index.ts` (match on `cfg.type`)
3. Add init flow in CLI if needed

### Group Chat Support
- `InboundMessage.isGroup` flag — set by channel implementation
- Bot strips `@BotUsername` mentions from text (Telegram-specific, in `TelegramChannel`)
- `SessionManager.groupSubscriptions` tracks which groups receive session output
- Groups auto-subscribe when a user routes input from a group to a session
- `/main <id>` from a group also subscribes the group
- Output goes to `ownerChatId` + all subscribed groups
- `cli/run.ts` polls `GET /remote/:id/subscribed-groups` every 2s for remote session group output

### Auto-Daemon
No explicit start/stop. `ensureDaemon()` checks PID + health, forks if needed. Daemon auto-stops after 30s with no sessions.

### Smart Input Routing (stdin-input.ts)
1. Reply-to: `msg.replyToRef` → `sessionManager.getSessionByMessage(ref)`
2. Session prefix: `r-abc123 some text`
3. Connected session (regular)
4. Connected remote session
5. Single remote auto-route
6. Multiple sessions: show disambiguation list

### Bot Commands
- `/sessions` — List active sessions
- `/connect <id>` — Connect this chat/group to a session
- `/disconnect` — Disconnect from current session
- `/send <id> <text>` — Send to a specific session
- `/help` — Show help
- `/pair <code>` — Pair with a pairing code

### Config Format
```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "credentials": { "botToken": "..." },
      "pairedUsers": [{ "userId": "telegram:123", "pairedAt": "..." }]
    }
  },
  "settings": {
    "outputBatchMinMs": 300,
    "outputBatchMaxMs": 800,
    "outputBufferMaxChars": 4096,
    "maxSessions": 10,
    "defaultShell": "/bin/zsh"
  }
}
```
Old format (`botToken` at top level, `pairedUsers[].telegramId: number`) auto-migrates on first load.

### Daemon Control Server Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Daemon status + session list |
| GET | `/health` | Liveness check (pid, startedAt) |
| POST | `/shutdown` | Graceful shutdown |
| POST | `/generate-code` | Generate pairing code |
| POST | `/remote/register` | Register remote session (body: command, chatId, cwd, name) |
| GET | `/remote/:id/input` | Drain remote input queue |
| POST | `/remote/:id/exit` | Mark remote session done (body: exitCode) |
| POST | `/remote/:id/track-message` | Track message ref for reply routing (body: msgRef) |
| GET | `/remote/:id/subscribed-groups` | Get group chatIds subscribed to session output |

## Common Pitfalls

- **Bun PTY**: `proc.terminal` can be `undefined` per types even when `terminal` option is passed — use `!` assertion
- **Type predicates**: `config is OldConfig` fails on `Record<string, unknown>` param — use plain boolean return + cast at call site
- **Telegram groups**: Bot needs "Group Privacy" disabled in BotFather (`/setprivacy` → Disable) to see non-command messages
- **Telegram mentions**: In groups, commands arrive as `/pair@BotName` — `TelegramChannel.stripBotMention()` handles this
- **JSONL paths**: Claude uses `~/.claude/projects/<encoded-cwd>/`, Codex uses `~/.codex/sessions/YYYY/MM/DD/`, PI uses `~/.pi/agent/sessions/--<encoded-cwd>--/`
- **chatId vs userId**: In personal chats they share the same numeric ID. In groups, chatId is the group (negative number), userId is the sender
