# TouchGrass — touchgrass.sh

Manage your AI agent CLIs from your phone. See @AGENTS.md for full architecture, file map, design patterns, and pitfalls.

## Dev Commands

```bash
bun run dev           # Run via bun
bun run build         # Compile to standalone binary: ./tg
bun run typecheck     # tsc --noEmit (run before committing)
```

## Rules

- **Runtime is Bun**, not Node.js. Use Bun APIs (`Bun.spawn`, `Bun.serve`, `Bun.sleep`, `Bun.file`).
- **No frameworks/libraries** — raw fetch for Telegram API, raw HTTP for Unix socket server.
- **All IDs are tagged strings**: `"telegram:123456"` for chat/user IDs, `"telegram:42"` for message refs. Never use bare numbers.
- **Channel interface** (`src/channel/types.ts`) is the abstraction boundary. Handlers send simple HTML. Channel implementations handle platform specifics.
- **Handlers take `InboundMessage` + `RouterContext`**, never platform-specific types like `TelegramMessage`.
- Config lives at `~/.tg/config.json`. Old format auto-migrates. Always use `loadConfig()`/`saveConfig()`.
- Test with `bun run typecheck` — there are no unit tests, TypeScript strict mode is the safety net.
