import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface Preset {
  id: string;
  label: string;
  command: string;
  project_id: string | null;
  enabled: boolean;
}

export const presets = writable<Preset[]>([]);

export const enabledPresets = derived(presets, ($presets) =>
  $presets.filter((p) => p.enabled !== false)
);

export async function loadPresets(projectId?: string) {
  const list = await invoke<Preset[]>('list_presets', {
    projectId: projectId ?? null,
  });
  presets.set(list);
}

export async function addPreset(
  label: string,
  command: string,
  projectId?: string
) {
  await invoke('add_preset', {
    label,
    command,
    projectId: projectId ?? null,
  });
  await loadPresets(projectId);
}

export async function removePreset(presetId: string, projectId?: string) {
  await invoke('remove_preset', { presetId });
  await loadPresets(projectId);
}

export async function updatePreset(
  presetId: string,
  updates: { label?: string; command?: string; enabled?: boolean },
  projectId?: string
) {
  await invoke('update_preset', {
    presetId,
    label: updates.label ?? null,
    command: updates.command ?? null,
    enabled: updates.enabled ?? null,
  });
  await loadPresets(projectId);
}
