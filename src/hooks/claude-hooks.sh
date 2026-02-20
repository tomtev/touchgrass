#!/bin/bash
# touchgrass hook for Claude Code lifecycle events.
# Reads hook JSON from stdin and POSTs to the daemon (CLI mode) or app (desktop mode).
# Installed by touchgrass into ~/.touchgrass/hooks/ and referenced in ~/.claude/settings.json.
INPUT=$(cat)

# CLI mode: forward to daemon via Unix socket
if [ -n "$TG_SESSION_ID" ]; then
  SOCK="$HOME/.touchgrass/daemon.sock"
  AUTH=$(cat "$HOME/.touchgrass/daemon.auth" 2>/dev/null || true)
  if [ -z "$AUTH" ] || [ ! -S "$SOCK" ]; then exit 0; fi
  curl -sS --max-time 2 --unix-socket "$SOCK" \
    -X POST -H "x-touchgrass-auth: $AUTH" -H "Content-Type: application/json" \
    -d "$INPUT" "http://localhost/hook/$TG_SESSION_ID" >/dev/null 2>&1 &
fi

# App mode: forward to local HTTP server
if [ -n "$TOUCHGRASS_APP_PORT" ] && [ -n "$TOUCHGRASS_SESSION_ID" ]; then
  curl -sS --max-time 2 -X POST -H "Content-Type: application/json" \
    -d "$INPUT" "http://127.0.0.1:$TOUCHGRASS_APP_PORT/hook/$TOUCHGRASS_SESSION_ID" >/dev/null 2>&1 &
fi

exit 0
