<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    daemonStatus,
    channels,
    checkDaemonHealth,
    loadChannels,
    removeChannel,
    restartDaemon,
  } from '../stores/daemon';
  import AddChannelForm from './AddChannelForm.svelte';
  import ChannelDetail from './ChannelDetail.svelte';
  import { telegramIcon } from '../icons';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let showAddForm = $state(false);
  let restarting = $state(false);

  onMount(() => {
    requestAnimationFrame(() => refresh());
  });

  async function refresh() {
    loading = true;
    error = null;
    try {
      const healthy = await checkDaemonHealth();
      if (healthy) {
        await loadChannels();
      }
    } catch (e: any) {
      error = e?.toString() ?? 'Unknown error';
    } finally {
      loading = false;
    }
  }

  async function handleRestartAndRefresh() {
    restarting = true;
    error = null;
    try {
      await restartDaemon();
      await loadChannels();
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to restart daemon';
    } finally {
      restarting = false;
    }
  }

  async function handleRemoveChannel(name: string) {
    try {
      const result = await removeChannel(name);
      if (result.needsRestart) {
        await handleRestartAndRefresh();
      }
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to remove channel';
    }
  }

  async function handleChannelAdded(result: { needsRestart: boolean }) {
    showAddForm = false;
    if (result.needsRestart) {
      await handleRestartAndRefresh();
    } else {
      await refresh();
    }
  }
</script>

<div class="channels-panel">
  {#if $daemonStatus === 'stopped'}
    <div class="centered-state">
      <p><strong>Daemon not running</strong></p>
      <p>The touchgrass daemon needs to be running to manage channels.</p>
      <button data-variant="secondary" class="small" onclick={refresh}>Retry</button>
    </div>
  {:else if loading}
    <div class="centered-state" aria-busy="true">
      Connecting to daemon...
    </div>
  {:else}
    <div class="toolbar">
      <button class="outline small" onclick={refresh}>Refresh</button>
      <button class="small" onclick={() => (showAddForm = !showAddForm)}>+ Add Channel</button>
    </div>

    {#if restarting}
      <div role="alert">
        <span aria-busy="true" data-spinner="small"></span> Restarting daemon...
      </div>
    {/if}

    {#if error}
      <div role="alert" data-variant="error">{error}</div>
    {/if}

    {#if showAddForm}
      <AddChannelForm
        onSuccess={handleChannelAdded}
        onCancel={() => (showAddForm = false)}
      />
    {/if}

    <div class="channel-list">
      {#each $channels as channel (channel.name)}
        <details class="channel-accordion">
          <summary>
            <span class="channel-summary">
              <span class="channel-icon">{@html telegramIcon}</span>
              <strong>{channel.name}</strong>
              {#if channel.botUsername}
                <small>@{channel.botUsername}</small>
              {/if}
            </span>
          </summary>
          <div class="channel-body">
            <ChannelDetail channelName={channel.name} />
            <div class="channel-footer">
              <button
                class="ghost small delete-btn"
                onclick={() => handleRemoveChannel(channel.name)}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75ZM4.997 6.178a.75.75 0 1 0-1.493.144L4.15 12.18A1.75 1.75 0 0 0 5.893 13.7h4.214a1.75 1.75 0 0 0 1.742-1.52l.646-5.858a.75.75 0 1 0-1.493-.144l-.646 5.857a.25.25 0 0 1-.249.217H5.893a.25.25 0 0 1-.249-.217l-.647-5.857Z"/>
                </svg>
                Remove channel
              </button>
            </div>
          </div>
        </details>
      {:else}
        <p class="centered-state">No channels configured. Add a Telegram bot to get started.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .channels-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .centered-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    text-align: center;
    color: var(--muted-foreground);
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .channel-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .channel-accordion {
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .channel-accordion summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
  }

  .channel-summary {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .channel-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .channel-summary small {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
  }

  .delete-btn {
    color: var(--muted-foreground);
    padding: 4px;
  }

  .delete-btn:hover {
    color: var(--danger);
  }

  .channel-body {
    padding: 0 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .channel-footer {
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
</style>
