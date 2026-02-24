<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { skills, backgroundJobs, loadSkills, loadBackgroundJobs, type SkillInfo, type BackgroundJob } from './stores/skills';
  import { sessionStates, type SessionState } from './stores/sessionState';
  import { channelIcon, channelLabel } from './icons';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';

  interface Props {
    sessionId: string | null;
    projectPath: string;
    channel: string | null;
    visible: boolean;
  }

  let { sessionId, projectPath, channel, visible }: Props = $props();

  let showSkillsPopover = $state(false);
  let showJobsPopover = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Load skills when project path changes
  $effect(() => {
    if (projectPath) {
      loadSkills(projectPath);
    }
  });

  // Poll background jobs for the project
  $effect(() => {
    const path = projectPath;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (path && sessionId) {
      loadBackgroundJobs(path);
      pollTimer = setInterval(() => loadBackgroundJobs(path), 5000);
    } else {
      backgroundJobs.set([]);
    }
  });

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  function toggleSkills(e: MouseEvent) {
    e.stopPropagation();
    showSkillsPopover = !showSkillsPopover;
    if (showSkillsPopover) showJobsPopover = false;
  }

  function toggleJobs(e: MouseEvent) {
    e.stopPropagation();
    showJobsPopover = !showJobsPopover;
    if (showJobsPopover) showSkillsPopover = false;
  }

  function closePopovers() {
    showSkillsPopover = false;
    showJobsPopover = false;
  }

  function getStateDot(state: SessionState): string {
    switch (state) {
      case 'busy': return 'busy';
      case 'attention': return 'attention';
      case 'exited': return 'exited';
      default: return 'idle';
    }
  }

  function getStateLabel(state: SessionState): string {
    switch (state) {
      case 'busy': return 'Busy';
      case 'attention': return 'Attention';
      case 'exited': return 'Exited';
      default: return 'Idle';
    }
  }

  function compactCommand(cmd: string | null): string {
    if (!cmd) return 'running';
    const trimmed = cmd.trim();
    return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if visible}
<div class="bottom-bar" onclick={closePopovers}>
  <div class="left">
    {#if channel}
      <button class="bar-btn channel-btn">
        <span class="channel-icon">{@html channelIcon(channel)}</span>
        <span>{channelLabel(channel)}</span>
      </button>
      <span class="divider"></span>
    {/if}
    <button class="bar-btn" onclick={toggleSkills}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H1.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5H5v.5A1.5 1.5 0 0 0 6.5 10h3A1.5 1.5 0 0 0 11 8.5V8h3.5a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5H11v-.5A1.5 1.5 0 0 0 9.5 1h-3ZM10 3V2.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V3h4Zm-4 5V4h4v4.5a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V8Z"/>
      </svg>
      <span>Skills{$skills.length > 0 ? ` (${$skills.length})` : ''}</span>
    </button>
    <span class="divider"></span>
    <button class="bar-btn" onclick={toggleJobs}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11ZM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11Zm3.3 4.35a.75.75 0 1 1-1.06-1.06l1.5-1.5a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1-1.06 1.06L6.5 6.1l-.7.75Zm0 4.3a.75.75 0 0 1-1.06-1.06l1.5-1.5a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1-1.06 1.06L6.5 10.4l-.7.75ZM10 5.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Zm.75 3.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z"/>
      </svg>
      <span>Jobs</span>
      {#if $backgroundJobs.length > 0}
        <span class="badge">{$backgroundJobs.length}</span>
      {/if}
    </button>
  </div>

  <div class="right">
    {#if sessionId}
      {@const stateInfo = $sessionStates.get(sessionId)}
      {@const state = stateInfo?.state ?? 'idle'}
      <span class="state-indicator">
        <span class="state-dot {getStateDot(state)}"></span>
        <span class="state-label">{getStateLabel(state)}</span>
      </span>
    {/if}
  </div>

  {#if showSkillsPopover}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="popover skills-popover" onclick={(e) => e.stopPropagation()}>
      <div class="popover-header">Skills</div>
      {#if $skills.length === 0}
        <div class="popover-empty">No skills found</div>
      {:else}
        <div class="popover-list">
          {#each $skills as skill (skill.id)}
            <div class="popover-item">
              <span class="skill-name">{skill.name}</span>
              {#if skill.scope === 'personal'}
                <span class="skill-scope">personal</span>
              {/if}
              {#if skill.description}
                <span class="skill-desc">{skill.description}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if showJobsPopover}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="popover jobs-popover" onclick={(e) => e.stopPropagation()}>
      <div class="popover-header">Background Jobs</div>
      {#if $backgroundJobs.length === 0}
        <div class="popover-empty">No running jobs</div>
      {:else}
        <div class="popover-list">
          {#each $backgroundJobs as job (job.task_id)}
            <div class="popover-item">
              <span class="job-id">{job.task_id}</span>
              <span class="job-cmd">{compactCommand(job.command)}</span>
              {#if job.urls?.length}
                {#each job.urls as url}
                  <button class="job-url" onclick={() => shellOpen(url)}>{url}</button>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
{/if}

<style>
  .bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--bottom-bar-height);
    min-height: var(--bottom-bar-height);
    background: var(--card);
    border-top: 1px solid var(--border);
    padding: 0 8px;
    font-size: 12px;
    position: relative;
    z-index: 10;
  }

  .left {
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 100%;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .bar-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    border: none;
    background: none;
    color: var(--muted-foreground);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.1s, color 0.15s;
    white-space: nowrap;
  }

  .bar-btn:hover {
    background: var(--muted);
    color: var(--foreground);
  }

  .channel-btn {
    cursor: default;
  }

  .channel-btn:hover {
    background: none;
    color: var(--muted-foreground);
  }

  .channel-icon {
    display: flex;
    align-items: center;
  }

  .channel-icon :global(svg) {
    width: 13px;
    height: 13px;
  }

  .divider {
    width: 1px;
    height: 100%;
    background: var(--border);
    margin: 0 2px;
    flex-shrink: 0;
    align-self: stretch;
  }


  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--primary-foreground, #fff);
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
  }

  .state-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 4px;
  }

  .state-label {
    color: var(--muted-foreground);
    font-size: 12px;
  }

  .state-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .state-dot.idle {
    background: var(--muted-foreground);
    opacity: 0.4;
  }

  .state-dot.busy {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .state-dot.attention {
    background: #eab308;
    box-shadow: 0 0 6px rgba(234, 179, 8, 0.6);
    animation: pulse 0.8s ease-in-out infinite;
  }

  .state-dot.exited {
    background: var(--muted-foreground);
    opacity: 0.5;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Popovers */
  .popover {
    position: absolute;
    bottom: calc(var(--bottom-bar-height) + 4px);
    left: 8px;
    min-width: 240px;
    max-width: 360px;
    max-height: 300px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 20;
  }

  .jobs-popover {
    left: 80px;
  }

  .popover-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
  }

  .popover-empty {
    padding: 16px 12px;
    color: var(--muted-foreground);
    font-size: 12px;
    text-align: center;
  }

  .popover-list {
    overflow-y: auto;
    max-height: 250px;
  }

  .popover-item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }

  .popover-item:last-child {
    border-bottom: none;
  }

  .skill-name {
    font-weight: 500;
    color: var(--foreground);
    font-size: 12px;
  }

  .skill-scope {
    font-size: 10px;
    color: var(--muted-foreground);
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  .skill-desc {
    width: 100%;
    font-size: 11px;
    color: var(--muted-foreground);
    line-height: 1.3;
  }

  .job-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--foreground);
  }

  .job-cmd {
    font-size: 11px;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-url {
    width: 100%;
    font-size: 11px;
    color: var(--primary);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-url:hover {
    text-decoration: underline;
  }
</style>
