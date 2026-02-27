<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import Sidebar from './lib/Sidebar.svelte';
  import TabBar from './lib/TabBar.svelte';
  import BottomBar from './lib/BottomBar.svelte';
  import TerminalView from './lib/TerminalView.svelte';
  import PresetPopover from './lib/PresetPopover.svelte';
  import ToolIcon from './lib/ToolIcon.svelte';
  import EmptyState from './lib/EmptyState.svelte';
  import SettingsModal from './lib/SettingsModal.svelte';
  import AgentFace from './lib/AgentFace.svelte';
  import SetupWizard from './lib/SetupWizard.svelte';
  import ToastContainer from './lib/ToastContainer.svelte';
  import { showToast } from './lib/stores/toasts';
  import { loadTheme, resolvedTheme } from './lib/stores/theme';
  import { channelIcon } from './lib/icons';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen } from '@tauri-apps/api/event';

  const appWindow = getCurrentWindow();

  function handleTitlebarMousedown(e: MouseEvent) {
    if (e.buttons === 1) {
      if (e.detail === 2) {
        appWindow.toggleMaximize();
      } else {
        appWindow.startDragging();
      }
    }
  }
  import {
    projects,
    activeProject,
    activeProjectId,
    loadProjects,
    addProject,
    setActiveProject,
  } from './lib/stores/projects';
  import { loadWorkspaces } from './lib/stores/workspaces';
  import {
    currentSessions,
    activeSessionId,
    spawnSession,
    setActiveTab,
    killSession,
    loadSessions,
    resumeSession,
    isLiveSession,
    renameSession,
    getLastSession,
  } from './lib/stores/sessions';
  import type { SessionInfo, LastSession } from './lib/stores/sessions';
  import type { Preset } from './lib/stores/presets';

  let showPresetPopover = $state(false);
  let showSettings = $state(false);
  let settingsTab = $state<'general' | 'channels' | 'presets' | 'workspaces' | 'appearance'>('general');
  let setupComplete = $state(false);
  let setupChecking = $state(true);
  let lastSession = $state<LastSession | null>(null);
  let avatarHovered = $state(false);

  async function initApp() {
    loadTheme();
    await loadWorkspaces();
    await loadProjects();
    const apId = $activeProjectId;
    if (apId) {
      await loadSessions(apId);
    }

    listen<{ event_type: string; title?: string; chat_id?: string; username?: string }>(
      'daemon-event',
      (event) => {
        const { event_type, title, username } = event.payload;
        if (event_type === 'channel-linked') {
          showToast(`${title || 'Channel'} linked`, { title: 'Channel linked', variant: 'success' });
        } else if (event_type === 'channel-unlinked') {
          showToast('Channel unlinked', { variant: 'success' });
        } else if (event_type === 'user-paired') {
          showToast(`${username ? '@' + username : 'User'} paired successfully`, { title: 'User paired', variant: 'success' });
        }
      }
    );
  }

  onMount(async () => {
    loadTheme();
    try {
      const report = await invoke<{ tg: { installed: boolean } }>('check_dependencies');
      if (report.tg.installed) {
        setupComplete = true;
        await initApp();
      }
    } catch {
      // If check fails, show wizard
    }
    setupChecking = false;
  });

  // Reload sessions and agent soul when active project changes
  $effect(() => {
    const pid = $activeProjectId;
    if (pid) {
      loadSessions(pid);
      getLastSession(pid).then((s) => (lastSession = s));
    } else {
      lastSession = null;
    }
  });

  async function handleAddProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select project folder',
    });
    if (selected) {
      try {
        await addProject(selected as string);
      } catch (e: any) {
        showToast(e?.toString() ?? 'Failed to add project', { variant: 'error' });
      }
    }
  }

  function handleSelectPreset(preset: Preset, channel?: string) {
    showPresetPopover = false;
    const proj = $activeProject;
    if (proj) {
      spawnSession(proj.id, preset.command, preset.label, proj.path, channel, $resolvedTheme === 'dark');
      if (channel) {
        const name = channel.split(':').pop() ?? channel;
        showToast(`Connected to ${name}`, { title: 'Channel connected', variant: 'success', icon: channelIcon(channel) ?? undefined });
      }
    }
  }

  function handleCustomCommand(command: string, channel?: string) {
    showPresetPopover = false;
    const proj = $activeProject;
    if (proj) {
      const label = command.split(/\s+/)[0];
      spawnSession(proj.id, command, label, proj.path, channel, $resolvedTheme === 'dark');
      if (channel) {
        const name = channel.split(':').pop() ?? channel;
        showToast(`Connected to ${name}`, { title: 'Channel connected', variant: 'success', icon: channelIcon(channel) ?? undefined });
      }
    }
  }

  function handleRenameTab(sessionId: string, newLabel: string) {
    const proj = $activeProject;
    if (proj) {
      renameSession(sessionId, proj.id, newLabel);
    }
  }

  function handleCloseTab(sessionId: string) {
    const proj = $activeProject;
    if (proj) {
      killSession(sessionId, proj.id);
    }
  }

  function handleResumeTab(session: SessionInfo) {
    const proj = $activeProject;
    if (proj) {
      resumeSession(session, proj.path, $resolvedTheme === 'dark');
    }
  }

  function handleResumeLastSession() {
    const proj = $activeProject;
    if (!proj || !lastSession) return;

    // Build resume command if we have a tool session ID
    let command = lastSession.command;
    const parts = command.split(/\s+/);
    const baseCmd = parts[0];
    const toolSid = lastSession.tool_session_id;

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

    spawnSession(
      proj.id,
      command,
      lastSession.label,
      proj.path,
      lastSession.channel ?? undefined,
      $resolvedTheme === 'dark',
    );
    if (lastSession.channel) {
      const name = lastSession.channel.split(':').pop() ?? lastSession.channel;
      showToast(`Connected to ${name}`, { title: 'Channel connected', variant: 'success', icon: channelIcon(lastSession.channel) ?? undefined });
    }
  }

  function handleResumeFromPicker(tool: string, sessionRef: string, channel?: string) {
    showPresetPopover = false;
    const proj = $activeProject;
    if (!proj) return;

    // Build the resume command based on tool type
    let command: string;
    if (tool === 'claude') {
      command = `claude --resume ${sessionRef}`;
    } else if (tool === 'codex') {
      command = `codex resume ${sessionRef}`;
    } else if (tool === 'kimi') {
      command = `kimi --session ${sessionRef}`;
    } else {
      command = `${tool} --session ${sessionRef}`;
    }

    const label = `${tool} (resume)`;
    spawnSession(proj.id, command, label, proj.path, channel, $resolvedTheme === 'dark');
    if (channel) {
      const name = channel.split(':').pop() ?? channel;
      showToast(`Connected to ${name}`, { title: 'Channel connected', variant: 'success', icon: channelIcon(channel) ?? undefined });
    }
  }
</script>

<div class="app-shell">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="titlebar" onmousedown={handleTitlebarMousedown}>
    <span class="titlebar-title">{setupComplete && $activeProject ? $activeProject.name : 'touchgrass'}</span>
  </div>

  {#if !setupComplete && !setupChecking}
    <SetupWizard onComplete={async () => {
      setupComplete = true;
      await initApp();
    }} />
  {:else if setupComplete}
  <div class="app-layout">
    <Sidebar
      onAddProject={handleAddProject}
      onOpenSettings={(tab) => { settingsTab = (tab as any) || 'general'; showSettings = true; }}
    />

    <main class="main-panel">
    {#if $activeProject}
      <div class="tab-row">
        <TabBar
          sessions={$currentSessions}
          activeSessionId={$activeSessionId}
          onSelectTab={(id) => { setActiveTab($activeProject!.id, id); }}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
          onNewTab={() => (showPresetPopover = !showPresetPopover)}
        />
      </div>

      <div class="terminal-area">
        {#each $currentSessions as session (session.id)}
            {#if isLiveSession(session.id)}
              <TerminalView
                sessionId={session.id}
                visible={session.id === $activeSessionId}
              />
            {:else if session.id === $activeSessionId}
              <div class="dead-session">
                {#if $agentSoul}
                  <AgentFace name={$activeProject.name} size="lg" dna={$agentSoul?.dna} />
                {:else}
                  <ToolIcon command={session.command} size={32} />
                {/if}
                <p class="dead-label">{session.label}</p>
                <p class="dead-desc">Session ended</p>
                <button onclick={() => handleResumeTab(session)}>
                  Resume
                </button>
              </div>
            {/if}
          {/each}

          {#if $currentSessions.length === 0}
            <div class="no-sessions">
              <p>No sessions yet.</p>
              {#if lastSession}
                <button onclick={handleResumeLastSession}>
                  Resume: {lastSession.label}{lastSession.channel ? ` (${lastSession.channel.split(':').pop()})` : ''}
                </button>
              {/if}
              <button class="ghost" onclick={() => (showPresetPopover = true)}>
                + New Session
              </button>
            </div>
          {/if}
      </div>

      <BottomBar
        sessionId={$activeSessionId}
        projectPath={$activeProject.path}
        channel={$currentSessions.find(s => s.id === $activeSessionId)?.channel ?? null}
        visible={$currentSessions.length > 0}
      />

      {#if showPresetPopover}
        <PresetPopover
          projectId={$activeProject.id}
          projectPath={$activeProject.path}
          defaultChannel={$activeProject.default_channel}
          onSelect={handleSelectPreset}
          onCustom={handleCustomCommand}
          onResume={handleResumeFromPicker}
          onManagePresets={() => { showPresetPopover = false; settingsTab = 'presets'; showSettings = true; }}
          onClose={() => (showPresetPopover = false)}
        />
      {/if}
    {:else}
      <EmptyState onAddProject={handleAddProject} />
    {/if}
  </main>
  </div>
  {/if}
</div>

{#if showSettings}
  <SettingsModal initialTab={settingsTab} onClose={() => (showSettings = false)} />
{/if}

<ToastContainer />

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }

  .titlebar {
    height: var(--titlebar-height);
    min-height: var(--titlebar-height);
    background: var(--card);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .titlebar-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-foreground);
    pointer-events: none;
  }

  .app-layout {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .main-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .tab-row {
    display: flex;
    align-items: stretch;
  }

  .tab-row :global(.tab-bar) {
    flex: 1;
    min-width: 0;
  }

  .terminal-area {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: var(--background);
  }

  .no-sessions,
  .dead-session {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
  }

  .no-sessions p {
    color: var(--muted-foreground);
    font-size: 14px;
  }

  .agent-greeting {
    font-size: 18px !important;
    font-weight: 600;
    color: var(--foreground) !important;
  }

  .agent-desc {
    max-width: 400px;
    text-align: center;
    line-height: 1.5;
  }

  .dead-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--foreground);
  }

  .dead-desc {
    font-size: 13px;
    color: var(--muted-foreground);
    margin-bottom: 4px;
  }
</style>
