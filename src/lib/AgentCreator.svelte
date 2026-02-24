<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { homeDir } from '@tauri-apps/api/path';
  import { onMount } from 'svelte';
  import { presets, loadPresets } from './stores/presets';
  import type { Preset } from './stores/presets';
  import {
    runtimeChannels,
    loadRuntimeChannels,
    checkDaemonHealth,
  } from './stores/daemon';
  import { commandIcon, telegramIcon } from './icons';
  import type { Project } from './stores/projects';
  import { setDefaultChannel } from './stores/projects';
  import AgentFace from './AgentFace.svelte';

  interface Props {
    onCreated: (project: Project, command?: string, channel?: string) => void;
    onClose: () => void;
    onManageChannels?: () => void;
  }

  let { onCreated, onClose, onManageChannels }: Props = $props();

  let title = $state('');
  let purpose = $state('');
  let baseDir = $state('');
  let creating = $state(false);
  let error = $state('');
  let selectedPresetId = $state<string>(localStorage.getItem('tg-agent-preset') || '');
  let commandOpen = $state(false);
  let showHelp = $state(false);
  let selectedChannel = $state<string>('');
  let channelOpen = $state(false);
  let previewDna = $state<string>(randomDna());

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

  function randomDna(): string {
    // Generate a random 7-char hex DNA (0 to 150,994,943)
    const max = 8 * 8 * 64 * 16 * 16 * 12 * 12; // 150,994,944
    const n = Math.floor(Math.random() * max);
    return n.toString(16).padStart(7, '0');
  }

  const slug = $derived(
    title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  );
  const fullPath = $derived(
    baseDir && slug ? `${baseDir}/${slug}` : baseDir || ''
  );
  const canCreate = $derived(title.trim().length > 0 && fullPath.length > 0);

  onMount(async () => {
    try {
      const home = await homeDir();
      baseDir = home.endsWith('/') ? `${home}Dev` : `${home}/Dev`;
    } catch {
      baseDir = '';
    }
    await loadPresets();
    const enabled = $presets.filter((p) => p.enabled !== false);
    // Restore saved selection or default to first preset
    if (selectedPresetId && enabled.some((p) => p.id === selectedPresetId)) {
      // Already set from localStorage
    } else if (enabled.length > 0) {
      selectedPresetId = enabled[0].id;
    }
    try {
      const healthy = await checkDaemonHealth();
      if (healthy) {
        await loadRuntimeChannels();
      }
    } catch {
      // Daemon not running
    }
  });

  function selectPreset(id: string) {
    selectedPresetId = id;
    commandOpen = false;
    localStorage.setItem('tg-agent-preset', id);
  }

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select parent directory',
    });
    if (selected) {
      const dir = selected as string;
      baseDir = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    }
  }

  function selectChannel(title: string) {
    selectedChannel = title ? `telegram:${title}` : '';
    channelOpen = false;
  }

  async function handleCreate() {
    const path = fullPath;
    if (!path || !title.trim()) return;

    creating = true;
    error = '';

    try {
      const project = await invoke<Project>('create_agent', {
        title: title.trim(),
        purpose: purpose.trim() || 'A personal agent.',
        path,
      });
      // Save default channel if one was selected
      const channel = selectedChannel || undefined;
      if (channel) {
        await setDefaultChannel(project.id, channel);
      }
      const cmd = selectedPreset?.command;
      onCreated(project, cmd, channel);
    } catch (e) {
      error = (e as Error).message || String(e);
    } finally {
      creating = false;
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
    } else if (e.key === 'Enter' && canCreate && !creating) {
      handleCreate();
    }
  }


</script>

<svelte:window onkeydown={handleKeydown} />

<div class="page">
  <div class="page-header">
    <button class="ghost small" onclick={onClose} title="Back">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.56 7.25h7.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 0 1 0 1.06Z"/>
      </svg>
    </button>
    <h3>Create Agent</h3>
  </div>

  <div class="page-body">
    <div class="two-col">
    <div class="form-col">
    <div class="field">
      <label for="agent-title">Title</label>
      <input
        id="agent-title"
        type="text"
        placeholder="My Research Agent"
        bind:value={title}
        disabled={creating}
      />
    </div>

    <div class="field">
      <label for="agent-purpose">Purpose</label>
      <textarea
        id="agent-purpose"
        rows="3"
        placeholder="Helps me research topics and summarize findings"
        bind:value={purpose}
        disabled={creating}
      ></textarea>
    </div>

    <div class="field">
      <label for="agent-loc">Location</label>
      <div class="input-group">
        <input
          id="agent-loc"
          type="text"
          placeholder="~/Dev"
          bind:value={baseDir}
          disabled={creating}
        />
        <button class="outline small" onclick={handleBrowse} disabled={creating}>
          Browse
        </button>
      </div>
      {#if fullPath}
        <small class="path-preview">{fullPath}</small>
      {/if}
    </div>

    <div class="field">
      <label>Command</label>
      <div class="custom-select">
        <button class="select-trigger" onclick={() => { commandOpen = !commandOpen; channelOpen = false; }} disabled={creating}>
          <span class="select-value">
            {#if selectedPreset}
              <span class="select-icon">{@html commandIcon(selectedPreset.command)}</span>
              <span class="select-command">{selectedPreset.command}</span>
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
                class:active={selectedPresetId === preset.id}
                onclick={() => selectPreset(preset.id)}
              >
                <span class="select-icon">{@html commandIcon(preset.command)}</span>
                <span class="select-command">{preset.command}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if $runtimeChannels.length > 0}
      <div class="field">
        <label>Channel</label>
        <div class="custom-select">
          <button class="select-trigger" onclick={() => { channelOpen = !channelOpen; commandOpen = false; }} disabled={creating}>
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
              {#if onManageChannels}
                <div class="dropdown-divider"></div>
                <button class="select-option manage-link" onclick={() => { channelOpen = false; onManageChannels(); }}>
                  Manage channels...
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if error}
      <div role="alert" data-variant="danger">
        <p>{error}</p>
      </div>
    {/if}
    </div>

    <div class="avatar-col">
      <div class="avatar-box">
        <AgentFace name={title || 'Agent'} size="xl" dna={previewDna} />
      </div>
      <button class="ghost small regenerate-btn" onclick={() => (previewDna = randomDna())} title="Regenerate appearance">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 1 1 2.25 9.25a.5.5 0 0 1 .958.292A5 5 0 1 0 8 3Z"/>
          <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466Z"/>
        </svg>
        Randomize
      </button>
    </div>
    </div>
  </div>

  <div class="page-footer">
    <button class="ghost small help-btn" onclick={() => (showHelp = true)} title="What are agents?">
      ?
    </button>
    <div class="footer-spacer"></div>
    <button class="outline" onclick={onClose} disabled={creating}>Cancel</button>
    <button
      onclick={handleCreate}
      disabled={!canCreate || creating}
      aria-busy={creating}
    >
      {creating ? 'Creating...' : 'Create Agent'}
    </button>
  </div>

  {#if showHelp}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="help-overlay" onclick={() => (showHelp = false)} onkeydown={(e) => { if (e.key === 'Escape') showHelp = false; }}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="help-dialog" onclick={(e) => e.stopPropagation()}>
      <p>An <strong>agent</strong> is a project folder with an <code>AGENTS.md</code> file that defines its behavior and personality.</p>
      <p>When you create an agent, touchgrass:</p>
      <ul>
        <li>Creates a new folder at the specified location</li>
        <li>Writes an <code>AGENTS.md</code> file with your title and purpose</li>
        <li>Adds it as a project in the sidebar</li>
      </ul>
      <p>The CLI tool you select (Claude, Codex, etc.) reads <code>AGENTS.md</code> on startup and follows the instructions inside it. You can edit this file at any time to change the agent's behavior.</p>
      <p>Connect a Telegram channel to let the agent receive and respond to messages remotely.</p>
    </div>
  </div>
  {/if}
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    top: var(--titlebar-height, 38px);
    background: var(--background);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  .page-header h3 {
    margin: 0;
    font-size: 15px;
  }

  .page-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    justify-content: center;
  }

  .two-col {
    display: flex;
    gap: 40px;
    max-width: 640px;
    width: 100%;
  }

  .form-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .avatar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    flex-shrink: 0;
  }

  .avatar-box {
    width: 140px;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .regenerate-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--muted-foreground);
  }

  .regenerate-btn:hover {
    color: var(--foreground);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted-foreground);
  }

  .input-group {
    display: flex;
    gap: 6px;
  }

  .input-group input {
    flex: 1;
  }

  .path-preview {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-top: 2px;
  }

  .page-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    background: var(--card);
  }

  .footer-spacer {
    flex: 1;
  }

  .help-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-foreground);
    border: 1px solid var(--border);
  }

  .help-btn:hover {
    color: var(--foreground);
    border-color: var(--foreground);
  }

  .help-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .help-dialog {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-large, 12px);
    padding: 24px;
    max-width: 460px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--foreground);
  }

  .help-dialog p {
    margin: 0 0 10px;
  }

  .help-dialog p:last-child {
    margin-bottom: 0;
  }

  .help-dialog ul {
    margin: 0 0 10px;
    padding-left: 20px;
  }

  .help-dialog li {
    margin-bottom: 4px;
  }

  .help-dialog code {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 4px;
    background: var(--secondary);
    border-radius: 3px;
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
    bottom: calc(100% + 4px);
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

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px -4px;
  }

  .manage-link {
    color: var(--muted-foreground);
    font-size: 12px;
  }
</style>
