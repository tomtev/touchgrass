<script lang="ts">
  import { onMount } from 'svelte';
  import { agentSoul, loadAgentSoul, saveAgentSoul, type AgentSoul } from './stores/agentSoul';
  import { showToast } from './stores/toasts';

  interface Props {
    projectPath: string;
    onClose: () => void;
  }

  let { projectPath, onClose }: Props = $props();

  let name = $state('');
  let purpose = $state('');
  let owner = $state('');
  let saving = $state(false);

  const isDirty = $derived(
    $agentSoul != null && (
      name !== $agentSoul.name ||
      purpose !== $agentSoul.purpose ||
      owner !== $agentSoul.owner
    )
  );

  onMount(async () => {
    await loadAgentSoul(projectPath);
    if ($agentSoul) {
      name = $agentSoul.name;
      purpose = $agentSoul.purpose;
      owner = $agentSoul.owner;
    }
  });

  // Sync from store when it changes externally
  $effect(() => {
    const soul = $agentSoul;
    if (soul && !saving) {
      name = soul.name;
      purpose = soul.purpose;
      owner = soul.owner;
    }
  });

  async function handleSave() {
    if (!isDirty || saving) return;
    saving = true;
    try {
      await saveAgentSoul(projectPath, { name, purpose, owner, dna: $agentSoul?.dna });
      showToast('Agent soul saved', { variant: 'success' });
    } catch (e: any) {
      showToast(e?.toString() ?? 'Failed to save', { variant: 'error' });
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="soul-tab">
  <div class="soul-card">
    <div class="card-header">
      <h3>Agent Soul</h3>
      <button class="ghost small" onclick={onClose} title="Back to terminal">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    </div>

    <div class="card-body">
      <div class="field">
        <label for="soul-name">Name</label>
        <input
          id="soul-name"
          type="text"
          placeholder="Agent name"
          bind:value={name}
          disabled={saving}
        />
      </div>

      <div class="field">
        <label for="soul-purpose">Purpose</label>
        <textarea
          id="soul-purpose"
          rows="4"
          placeholder="What this agent does..."
          bind:value={purpose}
          disabled={saving}
        ></textarea>
      </div>

      <div class="field">
        <label for="soul-owner">Owner</label>
        <input
          id="soul-owner"
          type="text"
          placeholder="Owner name"
          bind:value={owner}
          disabled={saving}
        />
      </div>
    </div>

    <div class="card-footer">
      <button
        onclick={handleSave}
        disabled={!isDirty || saving}
        aria-busy={saving}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .soul-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
  }

  .soul-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-large, 12px);
    width: 440px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
  }

  .card-header h3 {
    margin: 0;
    font-size: 15px;
  }

  .card-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .card-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
  }
</style>
