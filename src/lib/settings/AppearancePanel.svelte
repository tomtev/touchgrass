<script lang="ts">
  import {
    theme, setTheme, type Theme,
    colorScheme, setColorScheme, type ColorScheme,
  } from '../stores/theme';
</script>

<div class="appearance-panel">
  <div class="setting-group">
    <label class="setting-label">Mode</label>
    <div class="theme-options">
      <button
        class="theme-option"
        class:active={$theme === 'light'}
        onclick={() => setTheme('light')}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-1.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.06l-1.061 1.06a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0Zm-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 0 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8ZM2.75 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5H2a.75.75 0 0 1 .75.75ZM13.657 12.596a.75.75 0 0 1-1.06 0l-1.061-1.06a.75.75 0 0 1 1.06-1.061l1.061 1.06a.75.75 0 0 1 0 1.061Zm-9.193-9.193a.75.75 0 0 1-1.06 0L2.343 2.342a.75.75 0 0 1 1.06-1.06L4.464 2.34a.75.75 0 0 1 0 1.062ZM8 16a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A.75.75 0 0 1 8 16ZM8 2.25a.75.75 0 0 1-.75-.75V.75a.75.75 0 0 1 1.5 0V1.5A.75.75 0 0 1 8 2.25Z"/>
        </svg>
        <span>Light</span>
      </button>
      <button
        class="theme-option"
        class:active={$theme === 'dark'}
        onclick={() => setTheme('dark')}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.598 1.591a.749.749 0 0 1 .785-.175 7.001 7.001 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786Zm1.616 1.945a7 7 0 0 1-7.678 7.678 5.499 5.499 0 1 0 7.678-7.678Z"/>
        </svg>
        <span>Dark</span>
      </button>
    </div>
    <p class="hint">Claude Code has its own theme setting. To match, run <code>/config</code> in Claude Code and change <strong>Theme</strong> to match.</p>
  </div>

  <div class="setting-group">
    <label class="setting-label">Theme</label>
    <div class="scheme-options">
      <button
        class="scheme-option"
        class:active={$colorScheme === 'default'}
        onclick={() => setColorScheme('default')}
      >
        <div class="scheme-preview default-preview">
          <div class="preview-bar"></div>
          <div class="preview-body">
            <div class="preview-line"></div>
            <div class="preview-line short"></div>
          </div>
        </div>
        <span>Default</span>
      </button>
      <button
        class="scheme-option"
        class:active={$colorScheme === 'coffee'}
        onclick={() => setColorScheme('coffee')}
      >
        <div class="scheme-preview coffee-preview">
          <div class="preview-bar"></div>
          <div class="preview-body">
            <div class="preview-line"></div>
            <div class="preview-line short"></div>
          </div>
        </div>
        <span>Coffee</span>
      </button>
      <button
        class="scheme-option"
        class:active={$colorScheme === 'outdoor'}
        onclick={() => setColorScheme('outdoor')}
      >
        <div class="scheme-preview outdoor-preview">
          <div class="preview-bar"></div>
          <div class="preview-body">
            <div class="preview-line"></div>
            <div class="preview-line short"></div>
          </div>
        </div>
        <span>Outdoor</span>
      </button>
    </div>
  </div>
</div>

<style>
  .appearance-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .setting-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--muted-foreground);
  }

  .theme-options {
    display: flex;
    gap: 8px;
  }

  .theme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 20px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--muted-foreground);
    cursor: pointer;
    font-size: 12px;
    transition: border-color 0.15s, color 0.15s;
  }

  .theme-option:hover {
    border-color: var(--foreground);
    color: var(--foreground);
  }

  .theme-option.active {
    border-color: var(--foreground);
    color: var(--foreground);
    background: var(--secondary);
  }

  .hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted-foreground);
    line-height: 1.4;
  }

  .hint code {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 4px;
    background: var(--secondary);
    border-radius: 3px;
  }

  .scheme-options {
    display: flex;
    gap: 10px;
  }

  .scheme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--muted-foreground);
    cursor: pointer;
    font-size: 12px;
    transition: border-color 0.15s, color 0.15s;
  }

  .scheme-option:hover {
    border-color: var(--foreground);
    color: var(--foreground);
  }

  .scheme-option.active {
    border-color: var(--foreground);
    color: var(--foreground);
  }

  .scheme-preview {
    width: 80px;
    height: 52px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(128, 128, 128, 0.2);
  }

  .preview-bar {
    height: 10px;
  }

  .preview-body {
    padding: 6px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preview-line {
    height: 4px;
    border-radius: 2px;
    width: 100%;
  }

  .preview-line.short {
    width: 60%;
  }

  /* Default theme preview */
  .default-preview {
    background: #09090b;
  }
  .default-preview .preview-bar {
    background: #18181b;
  }
  .default-preview .preview-line {
    background: #27272a;
  }

  /* Coffee theme preview */
  .coffee-preview {
    background: #1a1410;
  }
  .coffee-preview .preview-bar {
    background: #231e18;
  }
  .coffee-preview .preview-line {
    background: #3a3028;
  }

  /* Outdoor theme preview */
  .outdoor-preview {
    background: #04090a;
  }
  .outdoor-preview .preview-bar {
    background: #0a1612;
  }
  .outdoor-preview .preview-line {
    background: #143026;
  }
</style>
