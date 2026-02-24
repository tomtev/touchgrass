import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface Workspace {
  id: string;
  name: string;
}

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceId = writable<string | null>(null);

export async function loadWorkspaces() {
  const list = await invoke<Workspace[]>('list_workspaces');
  workspaces.set(list);
  const activeId = await invoke<string | null>('get_active_workspace_id');
  activeWorkspaceId.set(activeId);
}

export async function addWorkspace(name: string): Promise<Workspace> {
  const workspace = await invoke<Workspace>('add_workspace', { name });
  await loadWorkspaces();
  return workspace;
}

export async function renameWorkspace(id: string, name: string) {
  await invoke('rename_workspace', { id, name });
  await loadWorkspaces();
}

export async function removeWorkspace(id: string) {
  await invoke('remove_workspace', { id });
  await loadWorkspaces();
}

export async function setActiveWorkspace(id: string) {
  await invoke('set_active_workspace', { id });
  activeWorkspaceId.set(id);
}

export async function moveProjectToWorkspace(projectId: string, workspaceId: string) {
  await invoke('move_project_to_workspace', { projectId, workspaceId });
}
