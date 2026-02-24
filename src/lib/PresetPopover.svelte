<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { presets, loadPresets } from './stores/presets';
  import type { Preset } from './stores/presets';
  import {
    runtimeChannels,
    loadRuntimeChannels,
    checkDaemonHealth,
  } from './stores/daemon';
  import { commandIcon, telegramIcon } from './icons';

  interface RecentSession {
    sessionRef: string;
    label: string;
    mtimeMs: number;
  }

  interface Props {
    projectId: string;
    projectPath: string;
    defaultChannel?: string | null;
    onSelect: (preset: Preset, channel?: string) => void;
    onCustom: (command: string, channel?: string) => void;
    onResume: (tool: string, sessionRef: string, channel?: string) => void;
    onManagePresets: () => void;
    onClose: () => void;
  }

  let { projectId, projectPath, defaultChannel, onSelect, onCustom, onResume, onManagePresets, onClose }: Props = $props();

  let activeTab = $state<'new' | 'resume'>('new');
  let customCommand = $state('');
  let selectedChannel = $state<string>('');
  let selectedPresetId = $state<string>('');
  let channelOpen = $state(false);
  let commandOpen = $state(false);
  let refreshing = $state(false);

  function relativeAge(ms: number): string {
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  }

  function stripTimePrefix(label: string): string {
    return label.replace(/^\d+[smhd]\s+ago:\s*/, '');
  }

  // Resume tab state
  let resumeTool = $state<string>(localStorage.getItem('tg-resume-tool') || 'claude');
  let recentSessions = $state<RecentSession[]>([]);
  let loadingSessions = $state(false);

  const enabledPresets = $derived($presets.filter((p) => p.enabled !== false));
  const selectedPreset = $derived(enabledPresets.find((p) => p.id === selectedPresetId));
  const dmChannels = $derived($runtimeChannels.filter((c) => c.type === 'dm'));
  const groupChannels = $derived($runtimeChannels.filter((c) => c.type === 'group' || c.type === 'topic'));

  const selectedChannelTitle = $derived(
    selectedChannel.includes(':') ? selectedChannel.split(':').slice(1).join(':') : selectedChannel
  );
  const selectedChannelObj = $derived(
    $runtimeChannels.find((c) => c.title === selectedChannelTitle)
  );

  const toolOptions = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'pi', label: 'Pi' },
  ];

  onMount(async () => {
    await loadPresets(projectId);
    const enabled = $presets.filter((p) => p.enabled !== false);
    if (enabled.length > 0) {
      selectedPresetId = enabled[0].id;
    }
    try {
      const healthy = await checkDaemonHealth();
      if (healthy) {
        await loadRuntimeChannels();
        // Pre-select the project's default channel if set
        if (defaultChannel && !selectedChannel) {
          selectedChannel = defaultChannel;
        }
      }
    } catch {
      // Daemon not running
    }
  });

  async function loadRecentSessions() {
    loadingSessions = true;
    recentSessions = [];
    try {
      const resp = await invoke<{ ok: boolean; sessions: RecentSession[] }>(
        'daemon_recent_sessions', { tool: resumeTool, cwd: projectPath }
      );
      if (resp.ok) {
        recentSessions = resp.sessions.slice(0, 20);
      }
    } catch {
      // Daemon not running or endpoint unavailable
    }
    loadingSessions = false;
  }

  function switchToResume() {
    activeTab = 'resume';
    channelOpen = false;
    commandOpen = false;
    loadRecentSessions();
  }

  function handleToolChange(tool: string) {
    resumeTool = tool;
    localStorage.setItem('tg-resume-tool', tool);
    loadRecentSessions();
  }

  function handleResumeSession(session: RecentSession) {
    const channel = selectedChannel || undefined;
    onResume(resumeTool, session.sessionRef, channel);
  }

  function handleStart() {
    const channel = selectedChannel || undefined;
    const cmd = customCommand.trim();
    if (cmd) {
      onCustom(cmd, channel);
      return;
    }
    const preset = enabledPresets.find((p) => p.id === selectedPresetId);
    if (preset) {
      onSelect(preset, channel);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (channelOpen || commandOpen) {
        channelOpen = false;
        commandOpen = false;
      } else {
        onClose();
      }
    }
  }

  function selectChannel(title: string) {
    selectedChannel = title ? `telegram:${title}` : '';
    channelOpen = false;
  }

  function selectPreset(id: string) {
    selectedPresetId = id;
    customCommand = '';
    commandOpen = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="popover-backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="popover" data-dropdown onclick={(e) => e.stopPropagation()}>
    <div class="tab-bar" role="tablist">
      <button role="tab" aria-selected={activeTab === 'new'} onclick={() => { activeTab = 'new'; }}>New</button>
      <button role="tab" aria-selected={activeTab === 'resume'} onclick={switchToResume}>Resume</button>
    </div>

    {#if $runtimeChannels.length > 0}
      <div class="section">
        <span class="section-title">Channel</span>
        <div class="custom-select">
          <button class="select-trigger" onclick={() => { channelOpen = !channelOpen; commandOpen = false; }}>
            <span class="select-value">
              {#if selectedChannelObj}
                <span class="select-icon">{@html telegramIcon}</span>
                <span>{selectedChannelObj.title}</span>
              {:else}
                <span class="select-placeholder">None</span>
              {/if}
            </span>
            <svg class="chevron" class:open={channelOpen} width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2.22 4.47a.75.75 0 0 1 1.06 0L6 7.19l2.72-2.72a.75.75 0 0 1 1.06 1.06L6.53 8.78a.75.75 0 0 1-1.06 0L2.22 5.53a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
          {#if channelOpen}
            <div class="select-dropdown" data-dropdown>
              <button class="select-option" class:active={!selectedChannel} onclick={() => selectChannel('')}>
                <span class="select-placeholder">None</span>
              </button>
              {#if dmChannels.length > 0}
                <span class="optgroup-label">DMs</span>
                {#each dmChannels as ch (ch.chatId)}
                  <button class="select-option" class:active={selectedChannelTitle === ch.title} onclick={() => selectChannel(ch.title)}>
                    <span class="select-icon">{@html telegramIcon}</span>
                    <span>{ch.title}</span>
                  </button>
                {/each}
              {/if}
              {#if groupChannels.length > 0}
                <span class="optgroup-label">Groups</span>
                {#each groupChannels as ch (ch.chatId)}
                  <button class="select-option" class:active={selectedChannelTitle === ch.title} onclick={() => selectChannel(ch.title)}>
                    <span class="select-icon">{@html telegramIcon}</span>
                    <span>{ch.title}</span>
                  </button>
                {/each}
              {/if}
              <div class="dropdown-hint">
                <span>Send <code>/link</code> in a group or topic to add it</span>
                <button class="hint-refresh" aria-busy={refreshing} data-spinner="small" onclick={async (e) => {
                  e.stopPropagation();
                  refreshing = true;
                  await loadRuntimeChannels();
                  setTimeout(() => { refreshing = false; }, 500);
                }}>
                  {#if !refreshing}
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 1 1 2.25 9.25a.5.5 0 0 1 .958.292A5 5 0 1 0 8 3Z"/>
                      <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466Z"/>
                    </svg>
                  {/if}
                  refresh
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if activeTab === 'new'}
      <div class="section">
        <span class="section-title">Command</span>
        <div class="custom-select">
          <button class="select-trigger" onclick={() => { commandOpen = !commandOpen; channelOpen = false; }}>
            <span class="select-value">
              {#if selectedPreset && !customCommand.trim()}
                <span class="select-icon">{@html commandIcon(selectedPreset.command)}</span>
                <span class="select-command">{selectedPreset.command}</span>
              {:else if customCommand.trim()}
                <span class="select-icon">{@html commandIcon(customCommand)}</span>
                <span class="select-command">{customCommand}</span>
              {:else}
                <span class="select-placeholder">Select command...</span>
              {/if}
            </span>
            <svg class="chevron" class:open={commandOpen} width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2.22 4.47a.75.75 0 0 1 1.06 0L6 7.19l2.72-2.72a.75.75 0 0 1 1.06 1.06L6.53 8.78a.75.75 0 0 1-1.06 0L2.22 5.53a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
          {#if commandOpen}
            <div class="select-dropdown" data-dropdown>
              {#each enabledPresets as preset (preset.id)}
                <button
                  class="select-option"
                  class:active={selectedPresetId === preset.id && !customCommand.trim()}
                  onclick={() => selectPreset(preset.id)}
                >
                  <span class="select-icon">{@html commandIcon(preset.command)}</span>
                  <span class="select-command">{preset.command}</span>
                </button>
              {/each}
              <div class="dropdown-divider"></div>
              <button class="select-option manage-link" onclick={() => { commandOpen = false; onManagePresets(); }}>
                Manage presets...
              </button>
            </div>
          {/if}
        </div>
        <input
          class="field-input"
          type="text"
          placeholder="or custom command..."
          bind:value={customCommand}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleStart();
          }}
          onfocus={() => { channelOpen = false; commandOpen = false; }}
        />
      </div>

      <div class="actions">
        <button class="start-btn" onclick={handleStart}>Start</button>
      </div>

    {:else}
      <div class="section">
        <span class="section-title">Tool</span>
        <div class="tool-pills">
          {#each toolOptions as opt (opt.value)}
            <button
              class="tool-pill"
              class:active={resumeTool === opt.value}
              onclick={() => handleToolChange(opt.value)}
            >
              <span class="tool-pill-icon">{@html commandIcon(opt.value)}</span>
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="section session-list-section">
        <span class="section-title">Recent Sessions</span>
        {#if loadingSessions}
          <div class="session-loading" aria-busy="true" data-spinner="small">Loading...</div>
        {:else if recentSessions.length === 0}
          <div class="session-empty">No recent sessions found</div>
        {:else}
          <div class="session-list">
            {#each recentSessions as session (session.sessionRef)}
              <button class="session-item" onclick={() => handleResumeSession(session)}>
                <span class="session-time">{relativeAge(session.mtimeMs)}</span>
                <span class="session-text">{stripTimePrefix(session.label)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .popover :global([role="tab"]) {
    flex: 1;
  }

  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .popover {
    position: absolute;
    top: calc(var(--titlebar-height, 38px) + var(--tab-height, 36px) + 4px);
    right: 8px;
    width: 320px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }


  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
  }

  /* Tool pills */
  .tool-pills {
    display: flex;
    gap: 4px;
  }

  .tool-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 12px;
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: 16px;
    color: var(--muted-foreground);
    cursor: pointer;
    transition: all 0.1s;
  }

  .tool-pill:hover {
    border-color: var(--muted-foreground);
    color: var(--foreground);
  }

  .tool-pill.active {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }

  .tool-pill-icon {
    display: flex;
    align-items: center;
  }

  /* Session list */
  .session-list-section {
    min-height: 60px;
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow-y: auto;
  }

  .session-item {
    display: flex;
    align-items: baseline;
    justify-content: start;
    gap: 0;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.1s;
  }

  .session-item:hover {
    background: var(--muted);
  }

  .session-time {
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-size: 11px;
    width: 58px;
    text-align: left;
  }

  .session-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--foreground);
    opacity: 0.5;
  }

  .session-item:hover .session-text {
    opacity: 0.8;
  }

  .session-loading {
    font-size: 12px;
    color: var(--muted-foreground);
    padding: 8px 0;
  }

  .session-empty {
    font-size: 12px;
    color: var(--muted-foreground);
    padding: 8px 0;
  }

  /* Custom select */
  .custom-select {
    position: relative;
  }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 8px;
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--foreground);
    font-size: 13px;
    text-align: left;
  }

  .select-trigger:hover {
    border-color: var(--muted-foreground);
  }

  .select-value {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .select-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .select-command {
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .select-placeholder {
    color: var(--muted-foreground);
  }

  .chevron {
    flex-shrink: 0;
    color: var(--muted-foreground);
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .select-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 10;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: 4px;
    max-height: 200px;
    overflow-y: auto;
  }

  .select-option {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--foreground);
    font-size: 13px;
  }

  .select-option:hover {
    background: var(--muted);
  }

  .select-option.active {
    background: var(--secondary);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px -4px;
  }

  .manage-link {
    color: var(--muted-foreground);
    font-size: 12px;
  }

  .optgroup-label {
    display: block;
    text-align: left;
    padding: 4px 8px 2px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
  }

  .dropdown-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px 4px;
    border-top: 1px solid var(--border);
    margin: 4px -4px 0;
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .dropdown-hint code {
    font-family: var(--font-mono);
    font-size: 10px;
    background: var(--secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .hint-refresh {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    color: var(--muted-foreground);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .hint-refresh:hover {
    color: var(--foreground);
    background: var(--muted);
  }

  .field-input {
    width: 100%;
    padding: 6px 8px;
    font-size: 13px;
    font-family: var(--font-mono);
    background: var(--secondary);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: none;
    box-sizing: border-box;
  }

  .field-input::placeholder {
    color: var(--muted-foreground);
  }

  .field-input:focus {
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .start-btn {
    padding: 6px 20px;
    font-size: 13px;
    font-weight: 600;
    background: var(--primary);
    color: var(--primary-foreground);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .start-btn:hover {
    opacity: 0.9;
  }
</style>
