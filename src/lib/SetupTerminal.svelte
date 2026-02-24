<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { resolvedTheme, colorScheme } from './stores/theme';

  interface Props {
    ptyId: string;
    visible: boolean;
    onExit?: () => void;
  }

  let { ptyId, visible, onExit }: Props = $props();

  let containerEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let unlistenOutput: UnlistenFn;
  let unlistenExit: UnlistenFn;
  let resizeObserver: ResizeObserver;

  function getTheme() {
    const isDark = $resolvedTheme === 'dark';
    return {
      background: isDark ? '#09090b' : '#ffffff',
      foreground: isDark ? '#fafafa' : '#09090b',
      cursor: isDark ? '#d4d4d8' : '#3f3f46',
      selectionBackground: isDark ? '#27272a' : '#d4d4d8',
    };
  }

  function doFit() {
    if (!fitAddon || !terminal || !containerEl) return;
    if (containerEl.offsetWidth === 0 || containerEl.offsetHeight === 0) return;
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      terminal.resize(dims.cols, Math.max(1, dims.rows - 1));
    }
    terminal.refresh(0, terminal.rows - 1);
  }

  onMount(async () => {
    terminal = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: getTheme(),
      cursorBlink: false,
      allowProposedApi: true,
      scrollback: 5000,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerEl);
    containerEl.style.background = getTheme().background ?? '';

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // Canvas fallback
    }

    requestAnimationFrame(() => doFit());

    // Send initial size
    setTimeout(async () => {
      try {
        await invoke('resize_session', {
          sessionId: ptyId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // Session may not be ready yet
      }
    }, 150);

    // Terminal input -> PTY
    terminal.onData(async (data) => {
      try {
        await invoke('write_to_session', { sessionId: ptyId, data });
      } catch {
        // Ignore write errors (process may have exited)
      }
    });

    // Terminal resize -> PTY
    terminal.onResize(async ({ cols, rows }) => {
      try {
        await invoke('resize_session', { sessionId: ptyId, cols, rows });
      } catch {
        // Ignore
      }
    });

    // PTY output -> Terminal
    unlistenOutput = await listen<number[]>(`pty-output-${ptyId}`, (event) => {
      const bytes = new Uint8Array(event.payload);
      terminal.write(bytes);
    });

    // PTY exit
    unlistenExit = await listen(`pty-exit-${ptyId}`, () => {
      terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      onExit?.();
    });

    // Resize observer
    resizeObserver = new ResizeObserver(() => {
      if (visible) doFit();
    });
    resizeObserver.observe(containerEl);
  });

  onDestroy(() => {
    unlistenOutput?.();
    unlistenExit?.();
    resizeObserver?.disconnect();
    terminal?.dispose();
    // Clean up the PTY session
    invoke('kill_session', { sessionId: ptyId }).catch(() => {});
  });

  // Re-fit when visibility changes
  $effect(() => {
    if (visible && fitAddon && terminal) {
      requestAnimationFrame(() => doFit());
    }
  });

  // Update theme
  $effect(() => {
    const _t = $resolvedTheme;
    const _cs = $colorScheme;
    if (terminal) {
      const theme = getTheme();
      terminal.options.theme = theme;
      if (containerEl) {
        containerEl.style.background = theme.background ?? '';
      }
    }
  });
</script>

<div
  class="setup-terminal"
  class:visible
  bind:this={containerEl}
></div>

<style>
  .setup-terminal {
    width: 100%;
    height: 100%;
    display: none;
  }

  .setup-terminal.visible {
    display: block;
  }

  .setup-terminal :global(.xterm) {
    height: 100%;
    padding: 8px;
    background: inherit !important;
  }

  .setup-terminal :global(.xterm-viewport) {
    background: inherit !important;
  }
</style>
