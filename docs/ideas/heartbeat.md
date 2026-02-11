# Heartbeat Mode

## Overview

A `--heartbeat` flag that automatically sends a message to the agent at a regular interval, prompting it to check a `HEARTBEAT.md` file for instructions. This enables long-running autonomous workflows where the agent periodically picks up new tasks without manual intervention.

## Usage

```bash
tg claude --heartbeat                    # Default: every 60 minutes
tg claude --heartbeat --interval 30      # Every 30 minutes
tg claude --heartbeat --interval 120     # Every 2 hours
tg codex --heartbeat                     # Works with any supported agent
```

## What it does

Every `--interval` minutes (default 60), touchgrass.sh automatically submits this message to the agent's terminal:

```
Go check @HEARTBEAT.md file and follow instructions
```

The agent (Claude Code, Codex, etc.) will then read the `HEARTBEAT.md` file in the project directory and execute whatever instructions are there.

## Example HEARTBEAT.md

```markdown
# Heartbeat Instructions

1. Run the test suite: `bun test`
2. If any tests fail, fix them
3. Check for new TODO comments in the codebase and address them
4. Run `bun run typecheck` and fix any type errors
5. Commit any changes with a descriptive message
```

The user can update `HEARTBEAT.md` at any time (even from their phone via a git push) and the agent will pick up new instructions on the next heartbeat.

## Implementation Plan

### CLI changes (`src/cli/run.ts`)

1. Parse `--heartbeat` flag (consumed by tg, not passed to agent)
2. Parse `--interval <minutes>` flag (default: 60)
3. After session starts and remote ID is registered, start a heartbeat timer:

```typescript
const HEARTBEAT_MSG = "Go check @HEARTBEAT.md file and follow instructions";

if (heartbeatEnabled && remoteId) {
  const intervalMs = heartbeatInterval * 60 * 1000;
  const heartbeatTimer = setInterval(() => {
    terminal.write(Buffer.from(HEARTBEAT_MSG));
    setTimeout(() => terminal.write(Buffer.from("\r")), 100);
  }, intervalMs);

  // Clean up on exit
  // Add heartbeatTimer to cleanup section
}
```

4. Also send the heartbeat message to Telegram so the user can see when heartbeats fire:

```typescript
if (channel && chatId) {
  channel.send(chatId, `<i>⛳ Heartbeat sent (every ${heartbeatInterval}m)</i>`);
}
```

### Flag parsing (`src/cli/run.ts`)

Add to the existing flag extraction (after `--name`):

```typescript
let heartbeatEnabled = false;
let heartbeatInterval = 60; // minutes

const heartbeatIdx = cmdArgs.indexOf("--heartbeat");
if (heartbeatIdx !== -1) {
  heartbeatEnabled = true;
  cmdArgs = [...cmdArgs.slice(0, heartbeatIdx), ...cmdArgs.slice(heartbeatIdx + 1)];
}

const intervalIdx = cmdArgs.indexOf("--interval");
if (intervalIdx !== -1 && intervalIdx + 1 < cmdArgs.length) {
  heartbeatInterval = parseInt(cmdArgs[intervalIdx + 1], 10) || 60;
  cmdArgs = [...cmdArgs.slice(0, intervalIdx), ...cmdArgs.slice(intervalIdx + 2)];
}
```

### Telegram notification

When a heartbeat fires, send a dim notification to Telegram so the user knows:

```
⛳ Heartbeat → my-project [claude] (r-abc123)
```

### Cleanup

Add `heartbeatTimer` to the cleanup section alongside `pollTimer` and `groupPollTimer`.

### Files to modify

| File | Change |
|------|--------|
| `src/cli/run.ts` | Parse flags, start heartbeat timer, cleanup |

That's it — single file change. No daemon changes needed since the heartbeat runs in the CLI process that owns the PTY.

## Edge cases

- If the agent is mid-response when heartbeat fires, the text gets queued in the PTY input buffer and will be processed when the agent is ready
- If `HEARTBEAT.md` doesn't exist, the agent will say so — user should create one
- Heartbeat should NOT fire if the agent process has exited (timer cleanup handles this)

## Future ideas

- `--heartbeat-file <path>` to use a custom file instead of `HEARTBEAT.md`
- Heartbeat status in `/sessions` output (next heartbeat in X minutes)
- `/heartbeat <id>` Telegram command to manually trigger a heartbeat
- `/pause <id>` and `/resume <id>` to pause/resume heartbeats from Telegram
