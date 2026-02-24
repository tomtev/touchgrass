<script lang="ts">
  import GeneralPanel from './settings/GeneralPanel.svelte';
  import ChannelsPanel from './settings/ChannelsPanel.svelte';
  import PresetsPanel from './settings/PresetsPanel.svelte';
  import WorkspacesPanel from './settings/WorkspacesPanel.svelte';
  import AppearancePanel from './settings/AppearancePanel.svelte';

  type SettingsTab = 'general' | 'channels' | 'presets' | 'workspaces' | 'appearance';

  interface Props {
    onClose: () => void;
    initialTab?: SettingsTab;
  }

  let { onClose, initialTab = 'general' }: Props = $props();
  let activeTab = $state<SettingsTab>(initialTab);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
<div class="modal-backdrop" data-modal-backdrop onclick={handleBackdropClick} role="presentation">
  <div class="modal" data-modal data-sidebar-layout>
    <aside data-sidebar>
      <header>Settings</header>
      <nav>
        <ul>
          <li>
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              role="button"
              onclick={() => (activeTab = 'general')}
              aria-current={activeTab === 'general' ? 'page' : undefined}
            >
              General
            </a>
          </li>
          <li>
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              role="button"
              onclick={() => (activeTab = 'channels')}
              aria-current={activeTab === 'channels' ? 'page' : undefined}
            >
              Channels
            </a>
          </li>
          <li>
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              role="button"
              onclick={() => (activeTab = 'presets')}
              aria-current={activeTab === 'presets' ? 'page' : undefined}
            >
              Presets
            </a>
          </li>
          <li>
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              role="button"
              onclick={() => (activeTab = 'workspaces')}
              aria-current={activeTab === 'workspaces' ? 'page' : undefined}
            >
              Workspaces
            </a>
          </li>
          <li>
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              role="button"
              onclick={() => (activeTab = 'appearance')}
              aria-current={activeTab === 'appearance' ? 'page' : undefined}
            >
              Appearance
            </a>
          </li>
        </ul>
      </nav>
    </aside>

    <main>
      <div class="modal-header">
        <h3>{{ general: 'General', channels: 'Channels', presets: 'Presets', workspaces: 'Workspaces', appearance: 'Appearance' }[activeTab]}</h3>
        <button class="ghost small" onclick={onClose} title="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </button>
      </div>

      <div class="panel-content">
        {#if activeTab === 'general'}
          <GeneralPanel />
        {:else if activeTab === 'channels'}
          <ChannelsPanel />
        {:else if activeTab === 'presets'}
          <PresetsPanel />
        {:else if activeTab === 'workspaces'}
          <WorkspacesPanel />
        {:else if activeTab === 'appearance'}
          <AppearancePanel />
        {/if}
      </div>
    </main>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .modal {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-large, 12px);
    width: 720px;
    max-width: 90vw;
    height: 480px;
    min-height: 0 !important;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }

  /* Override oat.ink sidebar-layout's min-height: 100dvh for modal context */
  .modal:global([data-sidebar-layout]) {
    min-height: 0;
    height: 480px;
    gap: 0;
  }

  .modal :global(aside[data-sidebar]) {
    position: relative;
    height: 100%;
    top: 0;
  }

  .modal :global(main) {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 15px;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
</style>
