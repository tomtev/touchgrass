import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { activeWorkspaceId } from './workspaces';

export interface Project {
  id: string;
  name: string;
  path: string;
  workspace_id: string;
  default_channel?: string | null;
}

export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);

export const activeProject = derived(
  [projects, activeProjectId],
  ([$projects, $activeProjectId]) =>
    $projects.find((p) => p.id === $activeProjectId) ?? null
);

export const filteredProjects = derived(
  [projects, activeWorkspaceId],
  ([$projects, $activeWorkspaceId]) =>
    $activeWorkspaceId
      ? $projects.filter((p) => p.workspace_id === $activeWorkspaceId)
      : $projects
);

export async function loadProjects() {
  const list = await invoke<Project[]>('list_projects');
  projects.set(list);
  const activeId = await invoke<string | null>('get_active_project_id');
  activeProjectId.set(activeId);
}

export async function addProject(path: string, workspaceId?: string): Promise<Project> {
  const project = await invoke<Project>('add_project', { path, workspaceId: workspaceId ?? null });
  await loadProjects();
  return project;
}

export async function removeProject(projectId: string) {
  await invoke('remove_project', { projectId });
  await loadProjects();
}

// Track last active project per workspace (in-memory, survives workspace switches)
const activeProjectPerWorkspace = new Map<string, string>();

export async function setActiveProject(projectId: string) {
  await invoke('set_active_project', { projectId });
  activeProjectId.set(projectId);

  // Remember this project for its workspace
  let allProjects: Project[] = [];
  projects.subscribe((p) => (allProjects = p))();
  const proj = allProjects.find((p) => p.id === projectId);
  if (proj) {
    activeProjectPerWorkspace.set(proj.workspace_id, projectId);
  }
}

export async function switchToWorkspace(workspaceId: string) {
  // Save current active project for the old workspace
  let currentProjectId: string | null = null;
  activeProjectId.subscribe((id) => (currentProjectId = id))();
  let allProjects: Project[] = [];
  projects.subscribe((p) => (allProjects = p))();

  if (currentProjectId) {
    const current = allProjects.find((p) => p.id === currentProjectId);
    if (current) {
      activeProjectPerWorkspace.set(current.workspace_id, currentProjectId);
    }
  }

  // Switch workspace
  const { setActiveWorkspace } = await import('./workspaces');
  await setActiveWorkspace(workspaceId);

  // Restore remembered project for the new workspace, or pick first
  const wsProjects = allProjects.filter((p) => p.workspace_id === workspaceId);
  const remembered = activeProjectPerWorkspace.get(workspaceId);
  const target = (remembered && wsProjects.some((p) => p.id === remembered))
    ? remembered
    : wsProjects[0]?.id;

  if (target) {
    await setActiveProject(target);
  } else {
    activeProjectId.set(null);
  }
}

export async function setDefaultChannel(projectId: string, channel: string | null) {
  await invoke('set_default_channel', { projectId, channel });
  projects.update((list) =>
    list.map((p) => (p.id === projectId ? { ...p, default_channel: channel } : p))
  );
}
