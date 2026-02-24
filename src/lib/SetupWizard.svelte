<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import SetupTerminal from './SetupTerminal.svelte';

  interface DepStatus {
    name: string;
    installed: boolean;
    path: string | null;
  }

  interface DependencyReport {
    tg: DepStatus;
    ai_tools: DepStatus[];
    any_ai_installed: boolean;
  }

  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  let report = $state<DependencyReport | null>(null);
  let checking = $state(true);
  let view = $state<'check' | 'install'>('check');
  let installTarget = $state<string>('');
  let installPtyId = $state<string>('');
  let installExited = $state(false);

  const installCommands: Record<string, { label: string; command: string }> = {
    tg: { label: 'touchgrass CLI', command: 'curl -fsSL https://touchgrass.sh/install.sh | bash' },
    claude: { label: 'Claude Code', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
    codex: { label: 'Codex', command: 'npm i -g @openai/codex' },
    kimi: { label: 'Kimi', command: 'curl -L code.kimi.com/install.sh | bash' },
    pi: { label: 'Pi', command: 'npm install -g @mariozechner/pi-coding-agent' },
  };

  async function checkDeps() {
    checking = true;
    try {
      report = await invoke<DependencyReport>('check_dependencies');
    } catch (e) {
      console.error('Failed to check dependencies:', e);
    }
    checking = false;
  }

  function startInstall(name: string) {
    installTarget = name;
    installPtyId = `setup-${name}-${Date.now()}`;
    installExited = false;
    view = 'install';

    const cmd = installCommands[name];
    if (cmd) {
      invoke('spawn_setup_pty', {
        command: cmd.command,
        ptyId: installPtyId,
      }).catch((e) => console.error('Failed to spawn setup PTY:', e));
    }
  }

  function handleInstallExit() {
    installExited = true;
  }

  function backToCheck() {
    view = 'check';
    installTarget = '';
    installPtyId = '';
    installExited = false;
    checkDeps();
  }

  // Initial check
  checkDeps();
</script>

<div class="setup-wizard">
  {#if view === 'check'}
    <div class="check-view">
      <div class="header">
        <h1>Setup</h1>
        <p>touchgrass needs a few tools to work.</p>
      </div>

      {#if checking}
        <div class="loading">Checking dependencies...</div>
      {:else if report}
        <div class="deps-list">
          <!-- tg (required) -->
          <div class="dep-item" class:installed={report.tg.installed}>
            <div class="dep-info">
              <span class="dep-name">touchgrass CLI</span>
              <span class="dep-badge required">Required</span>
              {#if report.tg.installed}
                <span class="dep-status installed">Installed</span>
              {:else}
                <span class="dep-status missing">Not found</span>
              {/if}
            </div>
            {#if !report.tg.installed}
              <button class="install-btn" onclick={() => startInstall('tg')}>Install</button>
            {/if}
          </div>

          <!-- AI tools -->
          <div class="section-label">AI Tools</div>
          {#each report.ai_tools as tool}
            <div class="dep-item" class:installed={tool.installed}>
              <div class="dep-info">
                <span class="dep-name">{installCommands[tool.name]?.label ?? tool.name}</span>
                {#if tool.installed}
                  <span class="dep-status installed">Installed</span>
                {:else}
                  <span class="dep-status missing">Not found</span>
                {/if}
              </div>
              {#if !tool.installed}
                <button class="install-btn outline" onclick={() => startInstall(tool.name)}>Install</button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="actions">
          <button
            class="continue-btn"
            disabled={!report.tg.installed}
            onclick={onComplete}
          >
            {report.tg.installed ? 'Continue' : 'Install touchgrass CLI to continue'}
          </button>
        </div>
      {/if}
    </div>

  {:else if view === 'install'}
    <div class="install-view">
      <div class="install-header">
        <button class="ghost back-btn" onclick={backToCheck}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 12L6 8l4-4"/>
          </svg>
          Back
        </button>
        <span class="install-title">Installing {installCommands[installTarget]?.label ?? installTarget}</span>
        {#if installExited}
          <button class="recheck-btn" onclick={backToCheck}>Re-check</button>
        {/if}
      </div>
      <div class="install-terminal">
        <SetupTerminal
          ptyId={installPtyId}
          visible={true}
          onExit={handleInstallExit}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .setup-wizard {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--background);
  }

  /* Check view */
  .check-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 32px;
    gap: 24px;
  }

  .header {
    text-align: center;
  }

  .header h1 {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .header p {
    color: var(--muted-foreground);
    font-size: 14px;
  }

  .loading {
    color: var(--muted-foreground);
    font-size: 14px;
  }

  .deps-list {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
    margin-top: 16px;
    margin-bottom: 4px;
  }

  .dep-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--card);
    border: 1px solid var(--border);
  }

  .dep-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dep-name {
    font-size: 14px;
    font-weight: 500;
  }

  .dep-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .dep-badge.required {
    background: var(--destructive, #ef4444);
    color: white;
  }

  .dep-status {
    font-size: 12px;
  }

  .dep-status.installed {
    color: var(--success, #22c55e);
  }

  .dep-status.missing {
    color: var(--muted-foreground);
  }

  .install-btn {
    flex-shrink: 0;
    font-size: 13px;
    padding: 4px 12px;
  }

  .actions {
    margin-top: 8px;
  }

  .continue-btn {
    min-width: 200px;
    font-size: 14px;
    padding: 8px 24px;
  }

  .continue-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Install view */
  .install-view {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .install-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    min-height: 40px;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--muted-foreground);
    padding: 4px 8px;
  }

  .back-btn:hover {
    color: var(--foreground);
  }

  .install-title {
    font-size: 13px;
    font-weight: 500;
    flex: 1;
  }

  .recheck-btn {
    font-size: 13px;
    padding: 4px 12px;
  }

  .install-terminal {
    flex: 1;
    min-height: 0;
  }
</style>
