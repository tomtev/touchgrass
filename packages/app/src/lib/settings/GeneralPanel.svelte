<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  let codeEditor = $state('code');
  let saving = $state(false);

  const editorOptions = [
    { value: 'code', label: 'VS Code' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'zed', label: 'Zed' },
    { value: 'idea', label: 'IntelliJ IDEA' },
    { value: 'webstorm', label: 'WebStorm' },
  ];

  onMount(async () => {
    codeEditor = await invoke<string>('get_code_editor').catch(() => 'code');
  });

  async function handleEditorChange(value: string) {
    codeEditor = value;
    saving = true;
    await invoke('set_code_editor', { editor: value }).catch(() => {});
    saving = false;
  }
</script>

<div class="general-panel">
  <div class="setting-row">
    <div class="setting-info">
      <span class="setting-label">Code Editor</span>
      <span class="setting-desc">Used for "Open in Editor" from the project menu</span>
    </div>
    <select
      class="setting-select"
      value={codeEditor}
      onchange={(e) => handleEditorChange((e.target as HTMLSelectElement).value)}
    >
      {#each editorOptions as opt (opt.value)}
        <option value={opt.value} selected={codeEditor === opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .general-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 500;
  }

  .setting-desc {
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .setting-select {
    padding: 5px 8px;
    font-size: 13px;
    background: var(--secondary);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    min-width: 140px;
  }
</style>
