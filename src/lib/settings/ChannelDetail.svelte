<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadChannelDetails,
    removeUser,
    removeGroup,
    generatePairingCode,
    type ChannelDetails,
  } from '../stores/daemon';

  interface Props {
    channelName: string;
  }

  let { channelName }: Props = $props();

  let details = $state<ChannelDetails | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pairingCode = $state<string | null>(null);
  let pairingLoading = $state(false);

  onMount(() => {
    refresh();
  });

  async function refresh() {
    loading = true;
    error = null;
    try {
      details = await loadChannelDetails(channelName);
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to load details';
    } finally {
      loading = false;
    }
  }

  async function handleGenerateCode() {
    pairingLoading = true;
    try {
      pairingCode = await generatePairingCode();
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to generate code';
    } finally {
      pairingLoading = false;
    }
  }

  async function handleRemoveUser(userId: string) {
    try {
      await removeUser(channelName, userId);
      await refresh();
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to remove user';
    }
  }

  async function handleRemoveGroup(chatId: string) {
    try {
      await removeGroup(channelName, chatId);
      await refresh();
    } catch (e: any) {
      error = e?.toString() ?? 'Failed to remove group';
    }
  }
</script>

<div class="channel-detail">
  {#if loading}
    <div class="detail-loading">
      <span aria-busy="true" data-spinner="small"></span>
      Loading...
    </div>
  {:else if error}
    <div role="alert" data-variant="error" class="detail-alert">
      {error}
      <button class="ghost small" onclick={refresh}>Retry</button>
    </div>
  {:else if details}
    <!-- Paired Users -->
    <div class="section">
      <div class="section-header">
        <h4>Paired Users ({details.pairedUsers.length})</h4>
        <button class="ghost small icon-btn" onclick={refresh} title="Refresh">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 1 1 2.25 9.25a.5.5 0 0 1 .958.292A5 5 0 1 0 8 3Z"/>
            <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466Z"/>
          </svg>
        </button>
      </div>

      {#if details.pairedUsers.length === 0}
        <div class="pairing-guide">
          <div class="step">
            <span class="badge step-num">1</span>
            <div class="step-content">
              <span>Generate a pairing code</span>
              <button
                data-variant="secondary"
                class="small"
                onclick={handleGenerateCode}
                disabled={pairingLoading}
              >
                {pairingLoading ? 'Generating...' : pairingCode ? 'Regenerate' : 'Generate Code'}
              </button>
            </div>
          </div>

          {#if pairingCode}
            <div class="step">
              <span class="badge step-num">2</span>
              <div class="step-content">
                <span>Open your bot in Telegram</span>
                {#if details.botUsername}
                  <a
                    href="https://t.me/{details.botUsername}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open @{details.botUsername}
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-.22a.75.75 0 0 1 .396.22h2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.28.53l-.845-.845-4.22 4.22a.75.75 0 0 1-1.06-1.06l4.22-4.22-.845-.845a.75.75 0 0 1-.366-1Z"/>
                    </svg>
                  </a>
                {/if}
              </div>
            </div>

            <div class="step">
              <span class="badge step-num">3</span>
              <div class="step-content">
                <span>Send this to the bot:</span>
                <code class="pairing-code">/pair {pairingCode}</code>
              </div>
            </div>

            <div class="step">
              <span class="badge step-num">4</span>
              <div class="step-content">
                <span>Click refresh after pairing</span>
                <button data-variant="secondary" class="small" onclick={refresh}>Refresh</button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <ul class="item-list">
          {#each details.pairedUsers as user (user.userId)}
            <li class="item-row">
              <div class="item-info">
                <span class="item-primary">
                  {user.username ? `@${user.username}` : `User ${user.userId}`}
                </span>
                <small class="mono">{user.userId}</small>
              </div>
              <button
                class="ghost small icon-btn"
                onclick={() => handleRemoveUser(user.userId)}
                title="Remove user"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
                </svg>
              </button>
            </li>
          {/each}
        </ul>

        <div class="add-user-row">
          {#if pairingCode}
            <small>Send to bot:</small>
            <code>{pairingCode}</code>
          {:else}
            <button
              class="outline small"
              onclick={handleGenerateCode}
              disabled={pairingLoading}
            >
              {pairingLoading ? 'Generating...' : '+ Pair another user'}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Linked Groups -->
    <div class="section">
      <div class="section-header">
        <h4>Linked Groups ({details.linkedGroups.length})</h4>
      </div>
      {#if details.linkedGroups.length === 0}
        <p class="empty-text">
          Add your bot to a Telegram group and send <code>/link</code> to connect it.
        </p>
      {:else}
        <ul class="item-list">
          {#each details.linkedGroups as group (group.chatId)}
            <li class="item-row">
              <div class="item-info">
                <span class="item-primary">{group.title ?? 'Untitled Group'}</span>
                <small class="mono">{group.chatId}</small>
              </div>
              <button
                class="ghost small icon-btn"
                onclick={() => handleRemoveGroup(group.chatId)}
                title="Remove group"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
                </svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="link-hint">
        <span>Send <code>/link</code> in a group or topic to add it, then</span>
        <button class="ghost small" onclick={refresh}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 1 1 2.25 9.25a.5.5 0 0 1 .958.292A5 5 0 1 0 8 3Z"/>
            <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466Z"/>
          </svg>
          refresh
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .channel-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .detail-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted-foreground);
    font-size: 12px;
  }

  .detail-alert {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-header h4 {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .icon-btn {
    padding: 2px;
    color: var(--muted-foreground);
  }

  .icon-btn:hover {
    color: var(--danger);
  }

  .pairing-guide {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
  }

  .step-num {
    min-width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    margin-top: 1px;
  }

  .step-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  .pairing-code {
    font-size: 12px;
    font-weight: 600;
    color: var(--primary);
    letter-spacing: 1px;
    user-select: all;
  }

  .add-user-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .empty-text {
    font-size: 12px;
    color: var(--muted-foreground);
  }

  .item-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
  }

  .item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--muted);
    border-radius: 4px;
  }

  .item-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .item-primary {
    font-size: 12px;
    font-weight: 500;
  }

  .mono {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
    font-size: 11px;
  }

  .link-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--muted-foreground);
    padding-top: 4px;
    flex-wrap: wrap;
  }
</style>
