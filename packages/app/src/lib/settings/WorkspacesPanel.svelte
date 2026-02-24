<script lang="ts">
  import { onMount } from 'svelte';
  import {
    workspaces,
    loadWorkspaces,
    addWorkspace,
    renameWorkspace,
    removeWorkspace,
  } from '../stores/workspaces';
  import { projects } from '../stores/projects';
  import type { Workspace } from '../stores/workspaces';

  let newName = $state('');
  let error = $state<string | null>(null);

  function wsInitials(name: string): string {
    return name.split(/[\s\-_]+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
  }

  function wsColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 45%, 45%)`;
  }
  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let confirmDeleteId = $state<string | null>(null);

  onMount(() => {
    loadWorkspaces();
  });

  function projectCount(wsId: string): number {
    return $projects.filter((p) => p.workspace_id === wsId).length;
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    error = null;
    try {
      await addWorkspace(name);
      newName = '';
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to add workspace';
    }
  }

  function startEditing(ws: Workspace) {
    if (ws.id === 'personal') return;
    editingId = ws.id;
    editingName = ws.name;
  }

  async function finishEditing(ws: Workspace) {
    const name = editingName.trim();
    editingId = null;
    if (!name || name === ws.name) return;
    try {
      await renameWorkspace(ws.id, name);
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to rename workspace';
    }
  }

  async function handleDelete(wsId: string) {
    try {
      await removeWorkspace(wsId);
      confirmDeleteId = null;
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to delete workspace';
    }
  }
</script>

<div class="workspaces-panel">
  <div class="add-row">
    <input
      type="text"
      placeholder="New workspace name"
      bind:value={newName}
      onkeydown={(e) => e.key === 'Enter' && handleAdd()}
    />
    <button onclick={handleAdd} disabled={!newName.trim()}>+ Add</button>
  </div>

  {#if error}
    <div role="alert" data-variant="error">{error}</div>
  {/if}

  <div class="ws-list">
    {#each $workspaces as ws (ws.id)}
      <div class="ws-row">
        <span class="ws-avatar" style:background={wsColor(ws.name)}>{wsInitials(ws.name)}</span>

        {#if editingId === ws.id}
          <input
            type="text"
            class="name-input"
            bind:value={editingName}
            onblur={() => finishEditing(ws)}
            onkeydown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { editingId = null; }
            }}
            autofocus
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <span
            class="ws-name"
            class:editable={ws.id !== 'personal'}
            ondblclick={() => startEditing(ws)}
          >
            {ws.name}
          </span>
        {/if}

        <span class="ws-count">{projectCount(ws.id)} project{projectCount(ws.id) === 1 ? '' : 's'}</span>

        <div class="ws-actions">
          {#if ws.id !== 'personal'}
            {#if confirmDeleteId === ws.id}
              <button data-variant="danger" class="small" onclick={() => handleDelete(ws.id)}>Delete</button>
              <button class="outline small" onclick={() => (confirmDeleteId = null)}>Cancel</button>
            {:else}
              <button class="ghost small delete-btn" onclick={() => (confirmDeleteId = ws.id)} title="Delete workspace">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
                </svg>
              </button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if $workspaces.length === 0}
    <p class="empty-state">No workspaces configured.</p>
  {/if}
</div>

<style>
  .workspaces-panel {
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
  }

  .add-row button {
    white-space: nowrap;
  }

  .ws-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }

  .ws-avatar {
    width: 24px;
    height: 24px;
    min-width: 24px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    line-height: 1;
    flex-shrink: 0;
  }

  .ws-name {
    flex: 1;
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-name.editable {
    cursor: pointer;
  }

  .ws-name.editable:hover {
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .name-input {
    flex: 1;
  }

  .ws-count {
    font-size: 12px;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }

  .ws-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
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
