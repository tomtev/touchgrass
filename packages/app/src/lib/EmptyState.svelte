<script lang="ts">
  interface Props {
    onAddProject: () => void;
  }
  let { onAddProject }: Props = $props();
</script>

<div class="empty-state">
  <div class="empty-content">
    <h1>touchgrass</h1>
    <p>Add a project folder to get started.</p>
    <div class="actions">
      <button onclick={onAddProject}>Open Folder</button>
    </div>
  </div>
</div>

<style>
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
  }

  .empty-content {
    text-align: center;
  }

  h1 {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  p {
    color: var(--muted-foreground);
    margin-bottom: 24px;
    font-size: 14px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
