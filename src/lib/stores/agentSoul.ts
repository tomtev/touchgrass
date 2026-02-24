import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface AgentSoul {
  name: string;
  purpose: string;
  owner: string;
  dna?: string;
}

// Active project's soul (kept for backward compat)
export const agentSoul = writable<AgentSoul | null>(null);

// All project souls keyed by project path
export const agentSouls = writable<Record<string, AgentSoul>>({});

export async function loadAgentSoul(cwd: string): Promise<void> {
  try {
    const res = await invoke<{ ok: boolean; soul: AgentSoul | null }>('daemon_get_agent_soul', { cwd });
    agentSoul.set(res.soul);
    agentSouls.update((m) => {
      const next = { ...m };
      if (res.soul) next[cwd] = res.soul;
      else delete next[cwd];
      return next;
    });
  } catch {
    agentSoul.set(null);
  }
}

/** Load agent souls for multiple project paths (non-blocking, best-effort) */
export async function loadAllAgentSouls(paths: string[]): Promise<void> {
  const results = await Promise.allSettled(
    paths.map(async (cwd) => {
      const res = await invoke<{ ok: boolean; soul: AgentSoul | null }>('daemon_get_agent_soul', { cwd });
      return { cwd, soul: res.soul };
    })
  );
  agentSouls.update((m) => {
    const next = { ...m };
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.soul) {
        next[r.value.cwd] = r.value.soul;
      }
    }
    return next;
  });
}

export async function saveAgentSoul(cwd: string, soul: AgentSoul): Promise<void> {
  await invoke('daemon_set_agent_soul', {
    cwd,
    name: soul.name,
    purpose: soul.purpose,
    owner: soul.owner,
    dna: soul.dna,
  });
  agentSoul.set(soul);
  agentSouls.update((m) => ({ ...m, [cwd]: soul }));
}
