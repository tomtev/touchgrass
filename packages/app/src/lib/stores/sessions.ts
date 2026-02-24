import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { activeProjectId } from './projects';
import { removeSessionState, sessionStates } from './sessionState';

export interface SessionInfo {
  id: string;
  project_id: string;
  label: string;
  command: string;
  channel?: string | null;
  tool_session_id?: string | null;
}

export interface LastSession {
  command: string;
  label: string;
  channel?: string | null;
  tool_session_id?: string | null;
}

// All sessions keyed by project_id
export const sessionsByProject = writable<Map<string, SessionInfo[]>>(new Map());

// Active tab per project
export const activeTabs = writable<Map<string, string>>(new Map());

// Track which session IDs are live PTY sessions (vs saved/dead)
const liveSessions = new Set<string>();

export const currentSessions = derived(
  [sessionsByProject, activeProjectId],
  ([$sessions, $activeProjectId]) => {
    if (!$activeProjectId) return [];
    return $sessions.get($activeProjectId) ?? [];
  }
);

export const activeSessionId = derived(
  [activeTabs, activeProjectId],
  ([$activeTabs, $activeProjectId]) => {
    if (!$activeProjectId) return null;
    return $activeTabs.get($activeProjectId) ?? null;
  }
);

export function isLiveSession(sessionId: string): boolean {
  return liveSessions.has(sessionId);
}

export async function loadSessions(projectId: string) {
  const live = await invoke<SessionInfo[]>('list_sessions', { projectId });
  const saved = await invoke<SessionInfo[]>('get_saved_sessions', { projectId });

  // Track live sessions
  for (const s of live) liveSessions.add(s.id);

  // Merge: live sessions take priority, saved-only sessions shown as dead
  const liveIds = new Set(live.map((s) => s.id));
  const deadSessions = saved.filter((s) => !liveIds.has(s.id));

  // Remove dead sessions that never captured a tool session ID — nothing to resume
  const resumable = deadSessions.filter((s) => s.tool_session_id);
  const stale = deadSessions.filter((s) => !s.tool_session_id);
  for (const s of stale) {
    invoke('close_saved_session', { sessionId: s.id }).catch(() => {});
  }

  const allSessions = [...live, ...resumable];

  sessionsByProject.update((m) => {
    const next = new Map(m);
    next.set(projectId, allSessions);
    return next;
  });

  // Mark resumable dead sessions as exited
  if (resumable.length > 0) {
    sessionStates.update((m) => {
      const next = new Map(m);
      for (const s of resumable) {
        if (!next.has(s.id)) {
          next.set(s.id, { state: 'exited', lastOutputAt: Date.now() });
        }
      }
      return next;
    });
  }

  // Restore persisted active tab, or default to first session
  let currentTab: string | undefined;
  activeTabs.subscribe((m) => { currentTab = m.get(projectId); })();
  if (!currentTab && allSessions.length > 0) {
    const persisted = await invoke<string | null>('get_active_tab', { projectId });
    const target = (persisted && allSessions.some((s) => s.id === persisted))
      ? persisted
      : allSessions[0].id;
    setActiveTab(projectId, target);
  }
}

export async function spawnSession(
  projectId: string,
  command: string,
  label: string,
  cwd: string,
  channel?: string,
  darkMode?: boolean
): Promise<SessionInfo> {
  const session = await invoke<SessionInfo>('spawn_session', {
    projectId,
    command,
    label,
    cwd,
    channel: channel ?? null,
    darkMode: darkMode ?? null,
  });

  liveSessions.add(session.id);

  sessionsByProject.update((m) => {
    const next = new Map(m);
    const existing = next.get(projectId) ?? [];
    next.set(projectId, [...existing, session]);
    return next;
  });

  setActiveTab(projectId, session.id);
  return session;
}

export async function resumeSession(
  savedSession: SessionInfo,
  cwd: string,
  darkMode?: boolean,
): Promise<SessionInfo> {
  // Remove the old saved session from backend and UI
  await invoke('close_saved_session', { sessionId: savedSession.id });
  removeSessionState(savedSession.id);
  liveSessions.delete(savedSession.id);

  sessionsByProject.update((m) => {
    const next = new Map(m);
    const existing = next.get(savedSession.project_id) ?? [];
    next.set(savedSession.project_id, existing.filter((s) => s.id !== savedSession.id));
    return next;
  });

  // Resolve the tool's session ID for resume
  let command = savedSession.command;
  const parts = command.split(/\s+/);
  const baseCmd = parts[0];
  let toolSid = savedSession.tool_session_id;

  // If we don't have a stored session ID, try to fetch the most recent from daemon
  if (!toolSid && (baseCmd === 'claude' || baseCmd === 'codex' || baseCmd === 'pi' || baseCmd === 'kimi')) {
    try {
      const resp = await invoke<{ ok: boolean; sessions: Array<{ sessionRef: string }> }>(
        'daemon_recent_sessions', { tool: baseCmd, cwd }
      );
      if (resp.ok && resp.sessions.length > 0) {
        toolSid = resp.sessions[0].sessionRef;
      }
    } catch {
      // Daemon not running — fall through without resume flag
    }
  }

  // Apply --resume <id> to the original command (insert after the tool name)
  if (toolSid) {
    if (baseCmd === 'claude' && !command.includes('--resume')) {
      parts.splice(1, 0, '--resume', toolSid);
      command = parts.join(' ');
    } else if (baseCmd === 'codex' && !command.includes('resume')) {
      parts.splice(1, 0, 'resume', toolSid);
      command = parts.join(' ');
    } else if ((baseCmd === 'pi' || baseCmd === 'kimi') && !command.includes('--session')) {
      parts.splice(1, 0, '--session', toolSid);
      command = parts.join(' ');
    }
  }

  // Spawn a new session with the resume command
  return spawnSession(
    savedSession.project_id,
    command,
    savedSession.label,
    cwd,
    savedSession.channel ?? undefined,
    darkMode,
  );
}

export async function renameSession(sessionId: string, projectId: string, newLabel: string) {
  await invoke('rename_session', { sessionId, label: newLabel });
  sessionsByProject.update((m) => {
    const next = new Map(m);
    const sessions = next.get(projectId) ?? [];
    next.set(projectId, sessions.map(s => s.id === sessionId ? { ...s, label: newLabel } : s));
    return next;
  });
}

export function setActiveTab(projectId: string, sessionId: string) {
  activeTabs.update((m) => {
    const next = new Map(m);
    next.set(projectId, sessionId);
    return next;
  });
  invoke('set_active_tab', { projectId, sessionId });
}

export async function killSession(sessionId: string, projectId: string) {
  if (liveSessions.has(sessionId)) {
    await invoke('kill_session', { sessionId });
  } else {
    // Dead/saved session — just remove from persisted state
    await invoke('close_saved_session', { sessionId });
  }
  liveSessions.delete(sessionId);
  removeSessionState(sessionId);

  sessionsByProject.update((m) => {
    const next = new Map(m);
    const existing = next.get(projectId) ?? [];
    const filtered = existing.filter((s) => s.id !== sessionId);
    next.set(projectId, filtered);
    return next;
  });

  // If the killed session was active, switch to the last remaining one
  activeTabs.update((tabs) => {
    const next = new Map(tabs);
    if (next.get(projectId) === sessionId) {
      next.delete(projectId);
    }
    return next;
  });

  // Re-read to get the updated list
  const updatedMap = getStoreValue(sessionsByProject);
  const remaining = updatedMap.get(projectId) ?? [];
  if (remaining.length > 0) {
    setActiveTab(projectId, remaining[remaining.length - 1].id);
  }
}

export async function getLastSession(projectId: string): Promise<LastSession | null> {
  return invoke<LastSession | null>('get_last_session', { projectId });
}

function getStoreValue<T>(store: { subscribe: (fn: (v: T) => void) => () => void }): T {
  let value: T;
  const unsub = store.subscribe((v) => (value = v));
  unsub();
  return value!;
}
