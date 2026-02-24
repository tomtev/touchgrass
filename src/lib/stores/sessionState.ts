import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export type SessionState = 'idle' | 'busy' | 'attention' | 'exited';

export interface SessionStateInfo {
  state: SessionState;
  lastOutputAt: number;
  /** The detected prompt text when state is 'attention' */
  prompt?: string;
  /** Input type from daemon: 'approval' | 'question' */
  inputType?: string;
}

// Per-CLI approval patterns (same as touchgrass)
const APPROVAL_PATTERNS: { promptText: string; optionText: string }[] = [
  { promptText: 'Do you want to', optionText: '1. Yes' },
  { promptText: 'Would you like to run', optionText: '1. Yes' },
  { promptText: 'Allow this action', optionText: 'Yes' },
];

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

function stripAnsiReadable(text: string): string {
  return text.replace(ANSI_RE, ' ').replace(/\s{2,}/g, ' ');
}

const IDLE_TIMEOUT = 3000;
const BUFFER_MAX = 2000;
const BUFFER_TRIM = 1000;

// Only count as "busy" if output is SUSTAINED over time (not a burst).
// TUI redraws finish in <100ms; AI streaming runs for seconds.
const BUSY_WINDOW_MS = 5000;       // look at last 5 seconds
const BUSY_MIN_SPAN_MS = 2500;     // output must span at least 2.5 seconds
const BUSY_MIN_CHUNKS = 10;        // AND at least this many output events
const BUSY_MIN_BYTES = 2000;       // AND at least this many bytes

// After user input (typing/resize), suppress busy for this long
const INPUT_SUPPRESS_MS = 1500;

// Sessions receiving hook events (skip PTY heuristics for these)
const hookActiveSessions = new Set<string>();

// Internal state
const buffers = new Map<string, string>();
const lastAttentionPrompt = new Map<string, string>();
const lastInputAt = new Map<string, number>();
const recentChunks = new Map<string, { ts: number; bytes: number }[]>();

// Sessions connected via channel (for daemon polling)
const channelSessions = new Map<string, string>(); // sessionId → channel

export const sessionStates = writable<Map<string, SessionStateInfo>>(new Map());

let idleTimer: ReturnType<typeof setInterval> | null = null;
let daemonPollTimer: ReturnType<typeof setInterval> | null = null;

function startIdleChecker() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const now = Date.now();
    sessionStates.update((m) => {
      let changed = false;
      for (const [id, info] of m) {
        if (info.state === 'busy' && now - info.lastOutputAt > IDLE_TIMEOUT) {
          m.set(id, { ...info, state: 'idle' });
          changed = true;
        }
      }
      return changed ? new Map(m) : m;
    });
  }, 1000);
}

function getRecentStats(sessionId: string, now: number): { chunks: number; bytes: number; spanMs: number } {
  const arr = recentChunks.get(sessionId);
  if (!arr || arr.length === 0) return { chunks: 0, bytes: 0, spanMs: 0 };
  const cutoff = now - BUSY_WINDOW_MS;
  while (arr.length > 0 && arr[0].ts < cutoff) arr.shift();
  if (arr.length === 0) return { chunks: 0, bytes: 0, spanMs: 0 };
  let bytes = 0;
  for (const c of arr) bytes += c.bytes;
  const spanMs = arr[arr.length - 1].ts - arr[0].ts;
  return { chunks: arr.length, bytes, spanMs };
}

function recordChunk(sessionId: string, byteCount: number, now: number) {
  let arr = recentChunks.get(sessionId);
  if (!arr) { arr = []; recentChunks.set(sessionId, arr); }
  arr.push({ ts: now, bytes: byteCount });
  if (arr.length > 200) arr.splice(0, arr.length - 100);
}

/** Call from TerminalView when user types */
export function reportInput(sessionId: string) {
  lastInputAt.set(sessionId, Date.now());
}

/** Register a session that's connected to a channel (for daemon polling) */
export function registerChannelSession(sessionId: string, channel: string) {
  channelSessions.set(sessionId, channel);
  startDaemonPolling();
}

/** Called when a Claude Code hook event is received — instant state update */
export function reportHookEvent(sessionId: string, hookEventName: string, toolName?: string, claudeSessionId?: string) {
  hookActiveSessions.add(sessionId);
  const now = Date.now();

  // Store Claude Code's session ID for resume support
  if (claudeSessionId && !capturedToolSessionIds.has(sessionId)) {
    capturedToolSessionIds.add(sessionId);
    invoke('set_tool_session_id', { sessionId, toolSessionId: claudeSessionId }).catch(() => {});
  }

  sessionStates.update((m) => {
    const next = new Map(m);
    switch (hookEventName) {
      case 'PermissionRequest': {
        let prompt = `Allow ${toolName || 'tool'}?`;
        next.set(sessionId, { state: 'attention', lastOutputAt: now, prompt });
        break;
      }
      case 'UserPromptSubmit':
        next.set(sessionId, { state: 'busy', lastOutputAt: now });
        break;
      case 'Stop':
        next.set(sessionId, { state: 'idle', lastOutputAt: now });
        break;
    }
    return next;
  });
}

// Track which sessions have already had their tool session ID captured
const capturedToolSessionIds = new Set<string>();

/** Call from TerminalView when PTY output is received */
export function reportOutput(sessionId: string, data: Uint8Array) {
  const now = Date.now();

  // Hook-active sessions get instant state from hook events — skip PTY heuristics entirely.
  // Only update lastOutputAt for busy state (to keep idle timer working as fallback).
  // Don't touch idle/attention states — those are set precisely by hook events.
  if (hookActiveSessions.has(sessionId)) {
    sessionStates.update((m) => {
      const current = m.get(sessionId);
      if (current && current.state === 'busy') {
        const next = new Map(m);
        next.set(sessionId, { ...current, lastOutputAt: now });
        return next;
      }
      return m;
    });
    startIdleChecker();
    return;
  }

  const text = new TextDecoder().decode(data);
  const readable = stripAnsiReadable(text);

  recordChunk(sessionId, data.length, now);

  // Buffer for pattern scanning
  let buf = (buffers.get(sessionId) ?? '') + readable;
  if (buf.length > BUFFER_MAX) buf = buf.slice(-BUFFER_TRIM);
  buffers.set(sessionId, buf);

  // Check attention patterns (always, regardless of volume)
  let attention = false;
  let detectedPrompt: string | undefined;

  for (const pattern of APPROVAL_PATTERNS) {
    const promptIdx = buf.lastIndexOf(pattern.promptText);
    if (promptIdx !== -1 && buf.indexOf(pattern.optionText, promptIdx) !== -1) {
      const end = buf.indexOf('?', promptIdx);
      detectedPrompt = end !== -1
        ? buf.slice(promptIdx, end + 1).trim()
        : pattern.promptText;
      if (lastAttentionPrompt.get(sessionId) !== detectedPrompt) {
        lastAttentionPrompt.set(sessionId, detectedPrompt);
        attention = true;
      }
      break;
    }
  }

  // Check if this is sustained significant output (not echo/resize/TUI redraw)
  const lastInput = lastInputAt.get(sessionId) ?? 0;
  const recentlyTyped = now - lastInput < INPUT_SUPPRESS_MS;
  const stats = getRecentStats(sessionId, now);
  const isSignificant = !recentlyTyped
    && stats.spanMs >= BUSY_MIN_SPAN_MS
    && stats.chunks >= BUSY_MIN_CHUNKS
    && stats.bytes >= BUSY_MIN_BYTES;

  sessionStates.update((m) => {
    const next = new Map(m);
    const current = next.get(sessionId);

    if (attention) {
      next.set(sessionId, { state: 'attention', lastOutputAt: now, prompt: detectedPrompt });
    } else if (isSignificant) {
      next.set(sessionId, { state: 'busy', lastOutputAt: now });
      if (current?.state === 'attention') lastAttentionPrompt.delete(sessionId);
    } else if (current) {
      // Update timestamp only — don't change state
      next.set(sessionId, { ...current, lastOutputAt: now });
    } else {
      next.set(sessionId, { state: 'idle', lastOutputAt: now });
    }
    return next;
  });

  startIdleChecker();
}

/** Call from TerminalView when PTY exit event is received */
export function reportExit(sessionId: string) {
  sessionStates.update((m) => {
    const next = new Map(m);
    next.set(sessionId, { state: 'exited', lastOutputAt: Date.now() });
    return next;
  });
  cleanup(sessionId);
}

export function removeSessionState(sessionId: string) {
  sessionStates.update((m) => {
    const next = new Map(m);
    next.delete(sessionId);
    return next;
  });
  cleanup(sessionId);
}

function cleanup(sessionId: string) {
  buffers.delete(sessionId);
  lastAttentionPrompt.delete(sessionId);
  recentChunks.delete(sessionId);
  lastInputAt.delete(sessionId);
  channelSessions.delete(sessionId);
  hookActiveSessions.delete(sessionId);
  capturedToolSessionIds.delete(sessionId);

  // Stop daemon polling when no channel sessions remain
  if (channelSessions.size === 0 && daemonPollTimer) {
    clearInterval(daemonPollTimer);
    daemonPollTimer = null;
  }
}

// --- Daemon polling for channel-connected sessions ---

interface DaemonInputSession {
  session_id: string;
  command: string;
  input_type: string;
}

async function pollDaemon() {
  if (channelSessions.size === 0) return;
  try {
    const resp = await invoke<{ ok: boolean; sessions: DaemonInputSession[] }>('daemon_input_needed');
    if (!resp.ok) return;

    // Build a set of session IDs the daemon says need input
    const daemonById = new Map(resp.sessions.map(s => [s.session_id, s]));

    sessionStates.update((m) => {
      const next = new Map(m);
      for (const [sessionId, _channel] of channelSessions) {
        const current = next.get(sessionId);
        if (!current || current.state === 'exited') continue;

        const daemonMatch = daemonById.get(sessionId);

        if (daemonMatch) {
          // Daemon says this session needs input
          if (current.state !== 'attention') {
            next.set(sessionId, {
              state: 'attention',
              lastOutputAt: current.lastOutputAt,
              inputType: daemonMatch.input_type,
            });
          }
        }
      }
      return next;
    });
  } catch {
    // Daemon not running — silently ignore
  }
}

function startDaemonPolling() {
  if (daemonPollTimer) return;
  daemonPollTimer = setInterval(pollDaemon, 2000);
  pollDaemon(); // initial poll
}

/** Get aggregate state for a project's sessions */
export function getProjectState(
  states: Map<string, SessionStateInfo>,
  sessionIds: string[],
): SessionState | null {
  if (sessionIds.length === 0) return null;

  let hasAttention = false;
  let hasBusy = false;
  let hasExited = false;

  for (const id of sessionIds) {
    const info = states.get(id);
    if (!info) continue;
    if (info.state === 'attention') hasAttention = true;
    else if (info.state === 'busy') hasBusy = true;
    else if (info.state === 'exited') hasExited = true;
  }

  if (hasAttention) return 'attention';
  if (hasBusy) return 'busy';
  if (hasExited) return 'exited';
  return 'idle';
}
