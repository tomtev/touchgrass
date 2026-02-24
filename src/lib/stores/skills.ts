import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  scope: string;
}

export interface BackgroundJob {
  task_id: string;
  status: string;
  command: string | null;
  urls: string[] | null;
  updated_at: number | null;
}

interface BackgroundJobSession {
  session_id: string;
  command: string;
  cwd: string;
  jobs: BackgroundJob[];
}

export const skills = writable<SkillInfo[]>([]);
export const backgroundJobs = writable<BackgroundJob[]>([]);

export async function loadSkills(cwd: string): Promise<void> {
  try {
    const resp = await invoke<{ ok: boolean; skills: SkillInfo[] }>('daemon_list_skills', { cwd });
    if (resp.ok) {
      skills.set(resp.skills);
    }
  } catch {
    // Daemon not running — clear skills
    skills.set([]);
  }
}

export async function loadBackgroundJobs(cwd: string): Promise<void> {
  try {
    const resp = await invoke<{ ok: boolean; sessions: BackgroundJobSession[] }>('daemon_list_background_jobs', { cwd });
    if (resp.ok) {
      // Flatten all jobs across sessions
      const allJobs = resp.sessions.flatMap((s) => s.jobs);
      backgroundJobs.set(allJobs);
    }
  } catch {
    backgroundJobs.set([]);
  }
}
