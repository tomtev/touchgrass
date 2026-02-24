<script lang="ts">
  import { onMount } from 'svelte';
  import {
    presets,
    loadPresets,
    addPreset,
    removePreset,
    updatePreset,
  } from '../stores/presets';
  import type { Preset } from '../stores/presets';
  import { commandIcon } from '../icons';

  let newCommand = $state('');
  let error = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  onMount(() => {
    loadPresets();
  });

  async function handleAdd() {
    const command = newCommand.trim();
    if (!command) return;

    error = null;
    try {
      await addPreset(command, command);
      newCommand = '';
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to add preset';
    }
  }

  async function handleCommandChange(preset: Preset, newValue: string) {
    const cmd = newValue.trim();
    if (!cmd || cmd === preset.command) return;
    try {
      await updatePreset(preset.id, { command: cmd, label: cmd });
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to update preset';
    }
  }

  async function handleToggle(preset: Preset) {
    try {
      await updatePreset(preset.id, { enabled: !preset.enabled });
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to update preset';
    }
  }

  async function handleDelete(presetId: string) {
    try {
      await removePreset(presetId);
      confirmDeleteId = null;
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to delete preset';
    }
  }
</script>

<div class="presets-panel">
  <div class="add-row">
    <input
      type="text"
      placeholder="Add command (e.g. claude --plan)"
      bind:value={newCommand}
      onkeydown={(e) => e.key === 'Enter' && handleAdd()}
    />
    <button onclick={handleAdd} disabled={!newCommand.trim()}>+ Add</button>
  </div>

  {#if error}
    <div role="alert" data-variant="error">{error}</div>
  {/if}

  <div class="preset-list">
    {#each $presets as preset (preset.id)}
      <div class="preset-row" class:disabled={!preset.enabled}>
        <span class="preset-icon">{@html commandIcon(preset.command)}</span>
        <input
          type="text"
          class="command-input"
          value={preset.command}
          onblur={(e) => handleCommandChange(preset, (e.target as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <div class="preset-actions">
          <label class="toggle-label">
            <input
              type="checkbox"
              role="switch"
              checked={preset.enabled}
              onchange={() => handleToggle(preset)}
            />
          </label>
          {#if confirmDeleteId === preset.id}
            <button data-variant="danger" class="small" onclick={() => handleDelete(preset.id)}>Delete</button>
            <button class="outline small" onclick={() => (confirmDeleteId = null)}>Cancel</button>
          {:else}
            <button class="ghost small delete-btn" onclick={() => (confirmDeleteId = preset.id)} title="Delete preset">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if $presets.length === 0}
    <p class="empty-state">No presets configured. Add a command above to get started.</p>
  {/if}
</div>

<style>
  .presets-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .add-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .add-row input {
    flex: 1;
    font-family: var(--font-mono);
  }

  .add-row button {
    white-space: nowrap;
  }

  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preset-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    transition: opacity 0.15s;
  }

  .preset-row.disabled {
    opacity: 0.5;
  }

  .preset-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .command-input {
    flex: 1;
    font-family: var(--font-mono);
  }

  .preset-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .toggle-label {
    display: inline-flex;
    align-items: center;
    margin: 0;
  }

  .delete-btn {
    color: var(--muted-foreground);
    padding: 4px;
  }

  .delete-btn:hover {
    color: var(--danger);
  }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: var(--muted-foreground);
  }
</style>
