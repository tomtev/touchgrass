<script lang="ts">
  import {
    filteredProjects,
    activeProjectId,
    setActiveProject,
    removeProject,
    switchToWorkspace,
  } from './stores/projects';
  import {
    workspaces,
    activeWorkspaceId,
  } from './stores/workspaces';
  import { sessionsByProject } from './stores/sessions';
  import { sessionStates, getProjectState } from './stores/sessionState';
  import type { SessionState } from './stores/sessionState';
  import { agentSoul, agentSouls, loadAllAgentSouls } from './stores/agentSoul';
  import ProjectItem from './ProjectItem.svelte';

  interface Props {
    onAddProject: () => void;
    onCreateAgent: () => void;
    onOpenSettings: (tab?: string) => void;
    onShowAgentSettings?: (projectId: string) => void;
  }

  let { onAddProject, onCreateAgent, onOpenSettings, onShowAgentSettings }: Props = $props();
  let showAddMenu = $state(false);
  let collapsed = $state(false);
  let wsOpen = $state(false);

  const activeWorkspaceName = $derived(
    $workspaces.find((w) => w.id === $activeWorkspaceId)?.name ?? 'All'
  );

  // Load agent souls for all projects so sidebar can show agent names
  $effect(() => {
    const paths = $filteredProjects.map((p) => p.path);
    if (paths.length > 0) loadAllAgentSouls(paths);
  });

  function wsColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 45%, 45%)`;
  }

  function wsInitial(name: string): string {
    return name[0]?.toUpperCase() ?? '?';
  }

  function switchWorkspace(id: string) {
    switchToWorkspace(id);
    wsOpen = false;
  }
</script>

<aside class="sidebar" class:collapsed>
  {#if $workspaces.length >= 1}
    <div class="workspace-switcher">
      <button class="select-trigger" onclick={() => (wsOpen = !wsOpen)}>
        {#if collapsed}
          <span class="ws-avatar-sm" style:background={wsColor(activeWorkspaceName)}>{wsInitial(activeWorkspaceName)}</span>
        {:else}
          <span class="select-icon">
            <span class="ws-avatar-sm" style:background={wsColor(activeWorkspaceName)}>{wsInitial(activeWorkspaceName)}</span>
          </span>
          <span class="select-value">{activeWorkspaceName}</span>
          <svg class="chevron" class:open={wsOpen} width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
          </svg>
        {/if}
      </button>
      {#if wsOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="ws-backdrop" onclick={() => (wsOpen = false)}></div>
        <div class="select-dropdown" class:collapsed-dropdown={collapsed} data-dropdown>
          {#each $workspaces as ws (ws.id)}
            <button
              class="select-option"
              class:active={ws.id === $activeWorkspaceId}
              onclick={() => switchWorkspace(ws.id)}
            >
              <span class="ws-avatar-sm" style:background={wsColor(ws.name)}>{wsInitial(ws.name)}</span>
              {ws.name}
            </button>
          {/each}
          <div class="dropdown-divider"></div>
          <button
            class="select-option manage-link"
            onclick={() => { wsOpen = false; onOpenSettings('workspaces'); }}
          >
            Manage workspaces...
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="project-list">
    {#each $filteredProjects as project (project.id)}
      {@const sessions = $sessionsByProject.get(project.id) ?? []}
      {@const projectState = getProjectState($sessionStates, sessions.map(s => s.id))}
      <ProjectItem
        {project}
        {collapsed}
        isActive={project.id === $activeProjectId}
        aggregateState={projectState}
        agentName={$agentSouls[project.path]?.name ?? null}
        agentDna={$agentSouls[project.path]?.dna ?? null}
        onSelect={setActiveProject}
        onRemove={removeProject}
        onShowSettings={$agentSouls[project.path] && onShowAgentSettings ? () => onShowAgentSettings(project.id) : undefined}
      />
    {/each}
  </div>

  <div class="sidebar-footer">
    <div class="footer-row">
      <div class="left-icons">
        <div class="add-wrapper">
          <button
            class="ghost small icon-btn"
            onclick={() => (showAddMenu = !showAddMenu)}
            title="Add"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
            </svg>
          </button>
          {#if showAddMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div class="add-backdrop" onclick={() => (showAddMenu = false)}></div>
            <menu class="add-menu" data-dropdown>
              <button
                role="menuitem"
                onclick={() => { showAddMenu = false; onAddProject(); }}
              >
                Open folder
              </button>
              <button
                role="menuitem"
                onclick={() => { showAddMenu = false; onCreateAgent(); }}
              >
                Create agent
              </button>
            </menu>
          {/if}
        </div>

        <button class="ghost small icon-btn" onclick={onOpenSettings} title="Settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.429 1.525a6.593 6.593 0 0 1 1.142 0c.036.003.108.036.137.146l.289 1.105c.147.56.55.967.997 1.189.174.086.341.183.501.29.417.278.97.423 1.53.27l1.102-.303c.11-.03.175.016.195.046.219.31.41.641.573.989.014.031.022.11-.059.19l-.815.806c-.411.406-.562.957-.53 1.456a4.588 4.588 0 0 1 0 .582c-.032.499.119 1.05.53 1.456l.815.806c.08.08.073.159.059.19a6.494 6.494 0 0 1-.573.99c-.02.029-.086.074-.195.045l-1.103-.303c-.559-.153-1.112-.008-1.529.27-.16.107-.327.204-.5.29-.449.222-.851.628-.998 1.189l-.289 1.105c-.029.11-.101.143-.137.146a6.613 6.613 0 0 1-1.142 0c-.036-.003-.108-.037-.137-.146l-.289-1.105c-.147-.56-.55-.967-.997-1.189a4.502 4.502 0 0 1-.501-.29c-.417-.278-.97-.423-1.53-.27l-1.102.303c-.11.03-.175-.016-.195-.046a6.492 6.492 0 0 1-.573-.989c-.014-.031-.022-.11.059-.19l.815-.806c.411-.406.562-.957.53-1.456a4.587 4.587 0 0 1 0-.582c.032-.499-.119-1.05-.53-1.456l-.815-.806c-.08-.08-.073-.159-.059-.19a6.44 6.44 0 0 1 .573-.99c.02-.029.086-.074.195-.045l1.103.303c.559.153 1.112.008 1.529-.27.16-.107.327-.204.5-.29.449-.222.851-.628.998-1.189l.289-1.105c.029-.11.101-.143.137-.146ZM8 0c-.236 0-.47.01-.701.03-.743.065-1.29.615-1.458 1.261l-.29 1.106c-.017.066-.078.158-.211.224a5.994 5.994 0 0 0-.668.386c-.123.082-.233.118-.3.1L3.27 2.801c-.635-.175-1.357.053-1.758.753a7.974 7.974 0 0 0-.703 1.214c-.306.678-.097 1.39.323 1.806l.815.806c.05.048.098.147.088.294a6.084 6.084 0 0 0 0 .652c.01.147-.038.246-.088.294l-.815.806c-.42.417-.629 1.128-.323 1.806.189.418.416.816.703 1.214.4.7 1.123.928 1.758.753l1.103-.303c.067-.018.177.018.3.1.216.144.44.275.668.386.133.066.194.158.212.224l.289 1.106c.169.646.715 1.196 1.458 1.26a8.094 8.094 0 0 0 1.402 0c.743-.064 1.29-.614 1.458-1.26l.29-1.106c.017-.066.078-.158.211-.224a5.98 5.98 0 0 0 .668-.386c.123-.082.233-.118.3-.1l1.102.302c.635.176 1.357-.052 1.758-.752.287-.398.514-.796.703-1.214.306-.678.097-1.39-.323-1.806l-.815-.806c-.05-.048-.098-.147-.088-.294a6.1 6.1 0 0 0 0-.652c-.01-.147.039-.246.088-.294l.815-.806c.42-.417.629-1.128.323-1.806a7.985 7.985 0 0 0-.703-1.214c-.4-.7-1.123-.928-1.758-.753l-1.103.303c-.066.018-.176-.018-.299-.1a5.98 5.98 0 0 0-.668-.386c-.133-.066-.194-.158-.212-.224L9.16 1.29C8.99.645 8.444.095 7.701.031A8.094 8.094 0 0 0 8 0Zm0 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
          </svg>
        </button>
      </div>

      <button
        class="ghost small icon-btn"
        onclick={() => (collapsed = !collapsed)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          {#if collapsed}
            <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
          {:else}
            <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/>
          {/if}
        </svg>
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    height: 100%;
    background: var(--card);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    transition: width 0.15s, min-width 0.15s;
  }

  .sidebar.collapsed {
    width: var(--sidebar-collapsed-width);
    min-width: var(--sidebar-collapsed-width);
  }

  .project-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid var(--border);
  }

  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sidebar.collapsed .footer-row {
    flex-direction: column;
    gap: 4px;
  }

  .left-icons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .sidebar.collapsed .left-icons {
    flex-direction: column;
  }

  .icon-btn {
    padding: 6px;
  }

  .add-wrapper {
    position: relative;
  }

  .add-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .add-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 51;
    list-style: none;
    padding: 4px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 140px;
  }

  .add-menu button[role="menuitem"] {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--foreground);
    font-size: 13px;
  }

  .add-menu button[role="menuitem"]:hover {
    background: var(--muted);
  }

  .workspace-switcher {
    padding: 8px;
    position: relative;
  }

  .select-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--foreground);
    font-size: 13px;
  }

  .select-trigger:hover {
    border-color: var(--muted-foreground);
  }

  .select-icon {
    flex-shrink: 0;
    display: inline-flex;
  }

  .select-value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .ws-avatar-sm {
    width: 20px;
    height: 20px;
    min-width: 20px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    line-height: 1;
    flex-shrink: 0;
  }

  .chevron {
    flex-shrink: 0;
    opacity: 0.6;
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .ws-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .select-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 8px;
    right: 8px;
    z-index: 51;
    padding: 4px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .select-option {
    display: flex;
    align-items: center;
    justify-content: start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--foreground);
    font-size: 13px;
    white-space: nowrap;
  }

  .select-option:hover {
    background: var(--muted);
  }

  .select-option.active {
    background: var(--secondary);
  }

  .manage-link {
    color: var(--muted-foreground);
    font-size: 12px;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px -4px;
  }

  .sidebar.collapsed .workspace-switcher {
    padding: 8px 4px;
  }

  .sidebar.collapsed .select-trigger {
    justify-content: center;
    padding: 4px;
    gap: 0;
  }

  .collapsed-dropdown {
    left: calc(100% + 4px);
    top: 0;
    right: auto;
    width: 200px;
  }
</style>
