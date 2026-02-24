<script lang="ts">
  import type { Project } from './stores/projects';
  import { loadProjects } from './stores/projects';
  import type { SessionState } from './stores/sessionState';
  import { tooltip } from './actions/tooltip';
  import { Menu, MenuItem, Submenu, PredefinedMenuItem } from '@tauri-apps/api/menu';
  import { invoke } from '@tauri-apps/api/core';
  import { workspaces, moveProjectToWorkspace } from './stores/workspaces';
  import { get } from 'svelte/store';
  import AgentFace from './AgentFace.svelte';

  interface Props {
    project: Project;
    isActive: boolean;
    collapsed: boolean;
    aggregateState: SessionState | null;
    agentName?: string | null;
    agentDna?: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onShowSettings?: () => void;
  }

  let { project, isActive, collapsed, aggregateState, agentName, agentDna, onSelect, onRemove, onShowSettings }: Props = $props();

  const initials = $derived(
    project.name
      .split(/[\s\-_]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || project.name[0]?.toUpperCase() || '?'
  );

  const avatarColor = $derived.by(() => {
    let hash = 0;
    for (let i = 0; i < project.name.length; i++) {
      hash = project.name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 45%, 45%)`;
  });

  const shortPath = $derived.by(() => {
    const p = project.path;
    // macOS: /Users/<name>/... → ~/...
    const mac = p.match(/^\/Users\/[^/]+(.*)$/);
    if (mac) return '~' + mac[1];
    // Linux: /home/<name>/... → ~/...
    const linux = p.match(/^\/home\/[^/]+(.*)$/);
    if (linux) return '~' + linux[1];
    return p;
  });

  async function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const editor = await invoke<string>('get_code_editor').catch(() => 'code');
    const editorLabel: Record<string, string> = { code: 'VS Code', cursor: 'Cursor', zed: 'Zed', idea: 'IntelliJ', webstorm: 'WebStorm' };
    const label = editorLabel[editor] ?? editor;

    const allWorkspaces = get(workspaces);
    const otherWorkspaces = allWorkspaces.filter((w) => w.id !== project.workspace_id);

    const items: any[] = [];

    if (agentName && onShowSettings) {
      items.push(await MenuItem.new({ id: 'settings', text: 'Settings', action: () => { onSelect(project.id); onShowSettings(); } }));
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    }

    items.push(await MenuItem.new({ id: 'reveal', text: 'Reveal in Finder', action: () => { invoke('reveal_in_finder', { path: project.path }); } }));
    items.push(await MenuItem.new({ id: 'open-editor', text: `Open in ${label}`, action: () => { invoke('open_in_editor', { path: project.path }); } }));

    if (otherWorkspaces.length > 0) {
      const moveItems = await Promise.all(
        otherWorkspaces.map((ws) =>
          MenuItem.new({
            id: `move-${ws.id}`,
            text: ws.name,
            action: async () => {
              await moveProjectToWorkspace(project.id, ws.id);
              await loadProjects();
            },
          })
        )
      );
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
      items.push(await Submenu.new({ id: 'move-ws', text: 'Move to workspace', items: moveItems }));
    }

    items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    items.push(await MenuItem.new({ id: 'remove', text: 'Remove', action: () => onRemove(project.id) }));

    const menu = await Menu.new({ items });
    await menu.popup();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="project-item"
  class:active={isActive}
  class:collapsed
  onclick={() => onSelect(project.id)}
  onkeydown={(e) => { if (e.key === 'Enter') onSelect(project.id); }}
  oncontextmenu={showContextMenu}
  role="option"
  aria-selected={isActive}
  tabindex="0"
  use:tooltip={collapsed ? project.name : undefined}
>
  <span class="avatar-wrapper" class:inactive={!aggregateState}>
    {#if agentName || agentDna}
      <AgentFace name={project.name} size="sm" dna={agentDna ?? undefined} talking={aggregateState === 'busy'} />
    {:else}
      <span class="avatar" style:background={avatarColor}>{initials}</span>
    {/if}
    {#if aggregateState === 'attention'}
      <span class="project-state-dot attention"></span>
    {/if}
  </span>
  {#if !collapsed}
    <span class="project-info">
      <span class="project-name" class:shimmer={aggregateState === 'busy'}>{agentName || project.name}</span>
      <span class="project-path">{shortPath}</span>
    </span>
    <button
      class="ghost small dots-btn"
      onclick={(e: MouseEvent) => {
        e.stopPropagation();
        showContextMenu(e);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .project-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--radius-small, 4px);
    text-align: left;
    color: var(--muted-foreground);
    cursor: pointer;
    transition: background 0.1s;
    position: relative;
  }

  .project-item:hover {
    background: var(--muted);
    color: var(--foreground);
  }

  .project-item.active {
    background: var(--secondary);
    color: var(--foreground);
  }

  .project-item.collapsed {
    justify-content: center;
    padding: 6px;
  }

  .avatar-wrapper {
    position: relative;
    flex-shrink: 0;
    transition: filter 0.2s;
  }

  .avatar-wrapper.inactive {
    filter: grayscale(1);
    opacity: 0.5;
  }

  .avatar {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    line-height: 1;
  }

  .project-state-dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--card);
  }

  .project-state-dot.attention {
    background: #eab308;
    animation: project-pulse 0.8s ease-in-out infinite;
  }

  @keyframes project-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .project-name.shimmer {
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
    animation: project-shimmer 2s ease-in-out infinite;
  }

  @keyframes project-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  .project-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .project-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .project-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: var(--muted-foreground);
    opacity: 0.7;
  }

  .dots-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    color: var(--muted-foreground);
  }

  .project-item:hover .dots-btn {
    opacity: 1;
  }

  .dots-btn:hover {
    color: var(--foreground);
  }

</style>
