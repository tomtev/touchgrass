<script>
  import GrassHero from '$lib/GrassHero.svelte';
  import CopyButton from '$lib/CopyButton.svelte';
  import { Avatar } from 'termlings/svelte';

  const installCommand = 'curl -fsSL https://touchgrass.sh/install.sh | bash';

  // Deterministic DNAs (avoids SSR/hydration mismatch from Math.random)
  const heroDNA = '0a3f201';
  const featureDNAs = ['03b8e10', '0c47a25', '0912d4f'];
  const agentRow = [
    '00f1a32', '05d4c81', '0a29e70', '0e8b3d4', '029f6a5',
    '07c1d93', '0b5e2f6', '01a7b48', '064c9e1', '0d83f27',
    '038a1c5', '08e5d72', '0cf2a96', '0417e3b', '097b4d8',
  ];
</script>

<svelte:head>
  <title>touchgrass.sh - Remote control Claude Code, Codex, Pi and more</title>
  <meta name="description" content="Remote control Claude Code, Codex, Pi and more with Telegram. Manage sessions from your phone." />
  <meta property="og:title" content="touchgrass.sh" />
  <meta property="og:description" content="Remote control Claude Code, Codex, Pi and more with Telegram." />
  <meta property="og:image" content="https://touchgrass.sh/touchgrass-og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://touchgrass.sh/touchgrass-og.png" />
</svelte:head>

<main class="page">
  <GrassHero>
    <div class="hero-content">
      <div class="hero-inner">
        <div class="card-header">
          <div class="brand">
            <span class="brand-icon" aria-hidden="true">⛳️</span>
            <p class="brand-name">touchgrass.sh</p>
          </div>
          <h1 class="card-title">
            Remote control Claude Code, Codex, Pi and more with Telegram.
          </h1>
          <p class="card-subtitle">
            Manage your code projects and long-running sessions from your phone.
          </p>
        </div>

        <div class="feature-grid cols-3">
          <article class="card">
            <div class="card-body feature-card-inner">
              <Avatar dna={featureDNAs[0]} size="lg" />
              <div>
                <p class="feature-title">Zero config</p>
                <p class="feature-desc">Wraps your existing CLI. Just prefix with <code>tg</code> and you're live.</p>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="card-body feature-card-inner">
              <Avatar dna={featureDNAs[1]} size="lg" />
              <div>
                <p class="feature-title">Multi-tool</p>
                <p class="feature-desc">Claude Code, Codex, Pi, and Kimi supported out of the box.</p>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="card-body feature-card-inner">
              <Avatar dna={featureDNAs[2]} size="lg" />
              <div>
                <p class="feature-title">Works from anywhere</p>
                <p class="feature-desc">Send prompts, approve tools, and share files — all from your phone.</p>
              </div>
            </div>
          </article>
        </div>

        <article class="card">
          <div class="card-body-lg steps">
            <p class="code-section-title">Get started</p>

            <div class="step">
              <span class="step-num">1</span>
              <div class="step-body">
                <p class="step-title">Install</p>
                <div class="install-bar">
                  <code class="install-code">{installCommand}</code>
                  <CopyButton command={installCommand} />
                  <a
                    href="https://github.com/tomtev/touchgrass"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open touchgrass on GitHub"
                    class="btn-ghost btn-icon"
                  >
                    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.82 1.23.82.72 1.21 1.87.86 2.33.66.07-.52.28-.86.51-1.06-1.78-.2-3.65-.89-3.65-3.97 0-.88.31-1.6.82-2.17-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.64 7.64 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.57.82 1.29.82 2.17 0 3.09-1.88 3.76-3.67 3.96.29.25.54.74.54 1.49v2.2c0 .21.14.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            <div class="step">
              <span class="step-num">2</span>
              <div class="step-body">
                <p class="step-title">Setup channel</p>
                <p class="step-desc">Create a Telegram bot via <strong>@BotFather</strong> (<code>/newbot</code>), then:</p>
                <pre class="code-block"><code>tg setup --telegram &lt;bot-token&gt;</code></pre>
                <p class="step-desc">Pair from Telegram by DMing your bot: <code>/pair &lt;code&gt;</code> (the code is printed by <code>tg setup</code>).</p>
              </div>
            </div>

            <div class="step">
              <span class="step-num">3</span>
              <div class="step-body">
                <p class="step-title">Start a CLI session</p>
                <pre class="code-block"><code>tg claude         # Claude Code
tg codex          # OpenAI Codex
tg pi             # Inflection Pi
tg kimi           # Moonshot Kimi</code></pre>
                <p class="step-desc">You'll see a banner confirming the session is touchgrass-wrapped:</p>
                <pre class="code-block"><code>⛳ touchgrass · /start_remote_control to connect from Telegram</code></pre>
              </div>
            </div>

            <div class="step">
              <span class="step-num">4</span>
              <div class="step-body">
                <p class="step-title">Remote control from channel</p>
                <p class="step-desc">From any Telegram chat where your bot is present (DM or group), run <code>/start_remote_control</code> to pick a session and connect.</p>
                <p class="step-desc">For groups: add your bot and disable BotFather group privacy (<code>/setprivacy</code> &rarr; Disable) so it can see messages.</p>
              </div>
            </div>
          </div>
        </article>

        <a
          href="https://github.com/tomtev/touchgrass"
          target="_blank"
          rel="noreferrer"
          class="docs-link"
        >
          Documentation
          <span aria-hidden="true">&rarr;</span>
        </a>

        <div class="agent-row">
          {#each agentRow as dna}
            <Avatar {dna} size="sm" />
          {/each}
        </div>
      </div>
    </div>
  </GrassHero>
</main>
