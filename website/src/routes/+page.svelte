<script>
  import GrassHero from '$lib/GrassHero.svelte';
  import CopyButton from '$lib/CopyButton.svelte';
  import AgentFace from '$lib/AgentFace.svelte';

  const installCommand = 'curl -fsSL https://touchgrass.sh/install.sh | bash';

  const TOTAL = 12 * 12 * 24 * 8 * 8 * 12 * 12;
  function randomDNA() {
    return Math.floor(Math.random() * TOTAL).toString(16).padStart(6, '0');
  }

  const heroDNA = randomDNA();
  const featureDNAs = [randomDNA(), randomDNA(), randomDNA()];
  const agentRow = Array.from({ length: 15 }, () => randomDNA());
</script>

<main class="page">
  <GrassHero>
    <div class="hero-content">
      <div class="hero-inner">
        <article class="card">
          <div class="card-header">
            <div class="brand">
              <span class="brand-icon" aria-hidden="true">⛳️</span>
              <p class="brand-name">touchgrass.sh</p>
            </div>
            <h1 class="card-title">
              Remote control Claude Code, Codex, Pi and more with Telegram.
            </h1>
            <p class="card-subtitle">
              Manage your code projects, build personal agents and manage long-running sessions from your phone.
            </p>
          </div>
        </article>

        <div class="install-wrap">
          <div class="install-bar">
            <span class="install-label">INSTALL:</span>
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

        <div class="feature-grid cols-3">
          <article class="card">
            <div class="card-body feature-card-inner">
              <AgentFace dna={featureDNAs[0]} size="sm" />
              <div>
                <p class="feature-title">Zero config</p>
                <p class="feature-desc">Wraps your existing CLI. Just prefix with <code>tg</code> and you're live.</p>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="card-body feature-card-inner">
              <AgentFace dna={featureDNAs[1]} size="sm" />
              <div>
                <p class="feature-title">Multi-tool</p>
                <p class="feature-desc">Claude Code, Codex, Pi, and Kimi supported out of the box.</p>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="card-body feature-card-inner">
              <AgentFace dna={featureDNAs[2]} size="sm" />
              <div>
                <p class="feature-title">Build agents</p>
                <p class="feature-desc">Scaffold personal agents with workflows, skills, and updatable core.</p>
              </div>
            </div>
          </article>
        </div>

        <article class="card video-card">
          <div class="card-body">
            <div class="video-wrap">
              <video
                src="/mov.mov"
                autoplay
                muted
                loop
                playsinline
                preload="metadata"
              >
                Your browser does not support HTML5 video.
              </video>
            </div>
          </div>
        </article>

        <div class="feature-grid cols-2">
          <article class="card">
            <div class="card-body">
              <p class="feature-title">Works from anywhere</p>
              <p class="feature-desc">Send prompts, approve tool calls, share files, and reply with context — all from Telegram on your phone.</p>
            </div>
          </article>
          <article class="card">
            <div class="card-body">
              <p class="feature-title">Lightweight</p>
              <p class="feature-desc">Just a PTY bridge and daemon. Auto-starts when you run a session, auto-stops when idle. No background services.</p>
            </div>
          </article>
        </div>

        <article class="card">
          <div class="card-body-lg">
            <p class="code-section-title">Get started in 60 seconds</p>
            <pre class="code-block"><code>curl -fsSL https://touchgrass.sh/install.sh | bash
tg setup          # connect your Telegram bot
tg pair           # pair from chat
tg claude         # start a bridged session</code></pre>
          </div>
        </article>

        <article class="card">
          <div class="card-body-lg agent-card-inner">
            <div class="agent-card-hero">
              <AgentFace dna={heroDNA} size="xl" walking />
            </div>
            <div>
              <p class="code-section-title">Build a personal agent</p>
              <p class="code-section-desc">
                Scaffold an agent with workflows and skills. The managed core updates automatically — your customizations stay untouched.
              </p>
              <pre class="code-block"><code>tg agent create my-agent --name "My Agent"
cd my-agent
tg claude</code></pre>
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
            <AgentFace {dna} size="sm" />
          {/each}
        </div>
      </div>
    </div>
  </GrassHero>
</main>
