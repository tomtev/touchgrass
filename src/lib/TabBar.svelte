<script lang="ts">
  import type { SessionInfo } from './stores/sessions';
  import { isLiveSession } from './stores/sessions';
  import { sessionStates } from './stores/sessionState';
  import { commandIcon } from './icons';

  import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
  import { tick } from 'svelte';

  interface Props {
    sessions: SessionInfo[];
    activeSessionId: string | null;
    onSelectTab: (sessionId: string) => void;
    onCloseTab: (sessionId: string) => void;
    onRenameTab: (sessionId: string, newLabel: string) => void;
    onNewTab: () => void;
  }

  let {
    sessions,
    activeSessionId,
    onSelectTab,
    onCloseTab,
    onRenameTab,
    onNewTab,
  }: Props = $props();

  let editingTabId = $state<string | null>(null);
  let originalLabel = '';
  let tabsEl: HTMLDivElement;

  // Auto-scroll active tab into view (centered)
  $effect(() => {
    if (!activeSessionId || !tabsEl) return;
    const tabEl = tabsEl.querySelector(`[data-tab-id="${activeSessionId}"]`) as HTMLElement | null;
    if (tabEl) {
      const containerRect = tabsEl.getBoundingClientRect();
      const tabRect = tabEl.getBoundingClientRect();
      const scrollLeft = tabsEl.scrollLeft + (tabRect.left - containerRect.left) - (containerRect.width / 2) + (tabRect.width / 2);
      tabsEl.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  });

  async function startEditing(session: SessionInfo, el?: HTMLElement) {
    editingTabId = session.id;
    originalLabel = session.label;
    // Wait for Svelte to apply contenteditable before focusing
    await tick();
    const target = el ?? document.querySelector(`[data-sid="${session.id}"]`) as HTMLElement | null;
    if (target) selectAllAndFocus(target);
  }

  function selectAllAndFocus(el: HTMLElement) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function commitEdit(sessionId: string, el: HTMLElement) {
    const trimmed = (el.textContent ?? '').trim();
    if (trimmed && trimmed !== originalLabel) {
      onRenameTab(sessionId, trimmed);
    } else {
      // Revert to original text if empty or unchanged
      el.textContent = originalLabel;
    }
    editingTabId = null;
  }

  function cancelEdit(el: HTMLElement) {
    el.textContent = originalLabel;
    editingTabId = null;
    el.blur();
  }

  function handleEditKeydown(e: KeyboardEvent, sessionId: string) {
    const el = e.currentTarget as HTMLElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(sessionId, el);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit(el);
    }
  }

  async function showTabMenu(e: MouseEvent, session: SessionInfo) {
    e.preventDefault();
    e.stopPropagation();

    const items = [
      await MenuItem.new({ id: 'rename', text: 'Rename', action: () => startEditing(session) }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({ id: 'close', text: 'Close', action: () => onCloseTab(session.id) }),
    ];

    const menu = await Menu.new({ items });
    await menu.popup();
  }
</script>

<div class="tab-bar">
  <div class="tabs" bind:this={tabsEl}>
    {#each sessions as session (session.id)}
      {@const stateInfo = $sessionStates.get(session.id)}
      {@const state = stateInfo?.state ?? 'idle'}
      {@const isDead = !isLiveSession(session.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={session.id === activeSessionId}
        class:dead={isDead}
        data-tab-id={session.id}
        onclick={() => onSelectTab(session.id)}
        oncontextmenu={(e) => showTabMenu(e, session)}
        onkeydown={(e) => { if (e.key === 'Enter') onSelectTab(session.id); }}
        role="tab"
        tabindex="0"
      >
        <span class="tab-icon">{@html commandIcon(session.command)}</span>
        <span
          class="tab-label"
          class:shimmer={state === 'busy' && editingTabId !== session.id}
          class:editing={editingTabId === session.id}
          data-sid={session.id}
          contenteditable={editingTabId === session.id ? 'plaintext-only' : undefined}
          ondblclick={(e) => { e.stopPropagation(); startEditing(session, e.currentTarget as HTMLElement); }}
          onblur={(e) => { if (editingTabId === session.id) commitEdit(session.id, e.currentTarget as HTMLElement); }}
          onkeydown={(e) => { if (editingTabId === session.id) handleEditKeydown(e, session.id); }}
          onclick={(e) => { if (editingTabId === session.id) e.stopPropagation(); }}
          role="textbox"
          tabindex={editingTabId === session.id ? 0 : -1}
        >{session.label}</span>
        {#if state === 'attention'}
          <span class="state-dot attention" title={state}></span>
        {/if}
        <button
          class="ghost small tab-dots"
          onclick={(e: MouseEvent) => showTabMenu(e, session)}
          title="Tab options"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>
  <button class="ghost tab-new" onclick={onNewTab} title="New session">
    +
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    height: var(--tab-height);
    background: var(--card);
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    min-width: 120px;
    max-width: 200px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    border-radius: 0;
    color: var(--muted-foreground);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .tab:hover {
    background: var(--muted);
  }

  .tab.active {
    background: var(--background);
    color: var(--foreground);
  }

  .tab-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .tab.active .tab-icon {
    opacity: 1;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .tab-label.shimmer {
    background: linear-gradient(
      90deg,
      var(--foreground) 0%,
      var(--foreground) 40%,
      var(--muted-foreground) 50%,
      var(--foreground) 60%,
      var(--foreground) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 2s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  .tab-label.editing {
    cursor: text;
    outline: none;
    -webkit-text-fill-color: var(--foreground);
    background: none;
    animation: none;
  }

  /* State indicator dot */
  .state-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    transition: background 0.2s, box-shadow 0.2s;
  }

  .state-dot.idle {
    background: var(--muted-foreground);
    opacity: 0.3;
  }

  .state-dot.busy {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .state-dot.attention {
    background: #eab308;
    box-shadow: 0 0 6px rgba(234, 179, 8, 0.6);
    animation: pulse 0.8s ease-in-out infinite;
  }

  .state-dot.exited {
    background: var(--muted-foreground);
    opacity: 0.5;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .tab.dead {
    opacity: 0.6;
  }

  .tab.dead:hover {
    opacity: 1;
  }

  .tab-dots {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    border-radius: 0;
  }

  .tab:hover .tab-dots {
    opacity: 1;
  }

  .tab-dots:hover {
    color: var(--foreground);
    opacity: 1;
  }

  .tab-new {
    flex-shrink: 0;
    width: var(--tab-height);
    font-size: 18px;
    border-radius: 0;
    border-left: 1px solid var(--border);
  }
</style>
