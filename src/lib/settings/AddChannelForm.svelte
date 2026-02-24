<script lang="ts">
  import { addChannel, loadChannels } from '../stores/daemon';

  interface Props {
    onSuccess: (result: { needsRestart: boolean }) => void;
    onCancel: () => void;
  }

  let { onSuccess, onCancel }: Props = $props();

  let name = $state('telegram');
  let channelType = $state('telegram');
  let botToken = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit() {
    error = null;

    if (!/^[a-z0-9_-]+$/.test(name)) {
      error = 'Name must be lowercase alphanumeric (with - or _)';
      return;
    }

    if (!botToken.trim()) {
      error = 'Bot token is required';
      return;
    }

    loading = true;
    try {
      const result = await addChannel(name, channelType, botToken.trim());
      await loadChannels();
      onSuccess({ needsRestart: result.needsRestart });
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to add channel';
    } finally {
      loading = false;
    }
  }
</script>

<article class="card add-form">
  <header>
    <h4>Add Channel</h4>
    <button class="ghost small" onclick={onCancel}>Cancel</button>
  </header>

  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
    <label data-field>
      Name
      <input type="text" bind:value={name} placeholder="telegram" disabled={loading} />
    </label>

    <div data-field>
      <label for="add-channel-type">Type</label>
      <select id="add-channel-type" bind:value={channelType} disabled={loading}>
        <option value="telegram">Telegram</option>
      </select>
    </div>

    <label data-field>
      Bot Token
      <input
        type="password"
        bind:value={botToken}
        placeholder="123456:ABC-DEF..."
        disabled={loading}
        style="font-family: var(--font-mono)"
      />
    </label>

    {#if error}
      <div role="alert" data-variant="error">{error}</div>
    {/if}

    <footer class="form-footer">
      <button type="submit" disabled={loading}>
        {#if loading}
          <span aria-busy="true" data-spinner="small"></span> Validating...
        {:else}
          Add Channel
        {/if}
      </button>
    </footer>
  </form>
</article>

<style>
  .add-form header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .add-form header h4 {
    margin: 0;
  }

  .form-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
