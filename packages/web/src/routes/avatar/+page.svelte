<script>
  import AgentFace from '$lib/AgentFace.svelte';
  import CopyButton from '$lib/CopyButton.svelte';
  import { encodeDNA, SLOTS, EYES, MOUTHS, HATS, BODIES, LEGS } from '@touchgrass/avatar';

  const installCommand = 'npm install @touchgrass/avatar';

  // Hero showcase avatars (deterministic)
  const heroDNA = '0a3f201';
  const showcaseDNAs = [
    '03b8e10', '0c47a25', '0912d4f', '00f1a32', '05d4c81',
    '0a29e70', '0e8b3d4', '029f6a5', '07c1d93', '0b5e2f6',
    '01a7b48', '064c9e1', '0d83f27', '038a1c5', '08e5d72',
    '0cf2a96', '0417e3b', '097b4d8', '02e6f1a', '0ba3c59',
  ];

  const TOTAL = SLOTS.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;

  const base = { eyes: 0, mouth: 0, hat: 0, body: 0, legs: 0, faceHue: 8, hatHue: 2 };

  // Seeded deterministic avatars
  function seededDNA(i) {
    const h = (i * 2654435761) >>> 0;
    return encodeDNA({
      eyes: h % EYES.length,
      mouth: (h >>> 4) % MOUTHS.length,
      hat: (h >>> 8) % HATS.length,
      body: (h >>> 13) % BODIES.length,
      legs: (h >>> 16) % LEGS.length,
      faceHue: (h >>> 19) % 12,
      hatHue: (h >>> 23) % 12,
    });
  }
</script>

<svelte:head>
  <title>Avatar - Open Source Pixel Art Avatars | touchgrass.sh</title>
  <meta name="description" content="Open source pixel art avatar system. 32M+ unique characters from a 7-character DNA string. Works in browsers, Svelte, React, and terminals." />
  <meta property="og:title" content="touchgrass avatar - Pixel Art Identity System" />
  <meta property="og:description" content="Open source pixel art avatars. 32M+ unique characters from a 7-char hex DNA." />
</svelte:head>

<main class="av-page">
  <div class="av-content">

    <!-- Hero -->
    <article class="card">
      <div class="card-header">
        <div class="av-hero-row">
          {#each showcaseDNAs.slice(0, 7) as dna}
            <AgentFace {dna} size="lg" />
          {/each}
        </div>
        <h1 class="card-title">Pixel art avatars for the web and terminal.</h1>
        <p class="card-subtitle">
          Open source avatar system. {TOTAL.toLocaleString()} unique characters encoded as a 7-character hex DNA string. Framework-agnostic core with Svelte components.
        </p>
      </div>
    </article>

    <!-- Install -->
    <div class="install-wrap">
      <div class="install-bar">
        <span class="install-label">INSTALL:</span>
        <code class="install-code">{installCommand}</code>
        <CopyButton command={installCommand} />
        <a
          href="https://github.com/tomtev/touchgrass/tree/main/packages/avatar"
          target="_blank"
          rel="noreferrer"
          aria-label="View on GitHub"
          class="btn-ghost btn-icon"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.82 1.23.82.72 1.21 1.87.86 2.33.66.07-.52.28-.86.51-1.06-1.78-.2-3.65-.89-3.65-3.97 0-.88.31-1.6.82-2.17-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.64 7.64 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.57.82 1.29.82 2.17 0 3.09-1.88 3.76-3.67 3.96.29.25.54.74.54 1.49v2.2c0 .21.14.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </div>

    <!-- DNA concept -->
    <div class="feature-grid cols-3">
      <article class="card">
        <div class="card-body feature-card-inner">
          <AgentFace dna={showcaseDNAs[0]} size="sm" />
          <div>
            <p class="feature-title">7-char DNA</p>
            <p class="feature-desc">Each avatar is a hex string like <code>0a3f201</code>. Store it, share it, render it anywhere.</p>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body feature-card-inner">
          <AgentFace dna={showcaseDNAs[1]} size="sm" />
          <div>
            <p class="feature-title">32M combinations</p>
            <p class="feature-desc">7 traits: eyes, mouth, hat, body, legs, and two color hues. All deterministic.</p>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body feature-card-inner">
          <AgentFace dna={showcaseDNAs[2]} size="sm" />
          <div>
            <p class="feature-title">Web + Terminal</p>
            <p class="feature-desc">Renders to SVG, Svelte components, or ANSI terminal art. Same DNA everywhere.</p>
          </div>
        </div>
      </article>
    </div>

    <!-- Big showcase -->
    <article class="card">
      <div class="card-body-lg">
        <div class="av-showcase">
          <div class="av-showcase-hero">
            <AgentFace dna={heroDNA} size="xl" waving />
          </div>
          <div class="av-showcase-grid">
            {#each showcaseDNAs.slice(0, 15) as dna}
              <AgentFace {dna} size="lg" />
            {/each}
          </div>
        </div>
      </div>
    </article>

    <!-- Quick start -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Quick start</p>
        <p class="code-section-desc">Generate a random avatar and render it as SVG.</p>
        <pre class="code-block"><code>import {'{'} generateRandomDNA, renderSVG {'}'} from '@touchgrass/avatar';

const dna = generateRandomDNA();  // "0a3f201"
const svg = renderSVG(dna);       // complete &lt;svg&gt; string

document.body.innerHTML = svg;</code></pre>
      </div>
    </article>

    <!-- Features grid -->
    <div class="feature-grid cols-2">
      <article class="card">
        <div class="card-body">
          <p class="feature-title">Deterministic from names</p>
          <p class="feature-desc">No DNA needed. Hash any string to get a consistent avatar. Same name = same face, every time.</p>
          <pre class="code-block"><code>import {'{'} traitsFromName {'}'} from '@touchgrass/avatar';

const traits = traitsFromName('my-agent');
// Always the same traits for "my-agent"</code></pre>
        </div>
      </article>
      <article class="card">
        <div class="card-body">
          <p class="feature-title">Encode & decode</p>
          <p class="feature-desc">Full control over traits. Decode a DNA string, modify traits, re-encode.</p>
          <pre class="code-block"><code>import {'{'} decodeDNA, encodeDNA {'}'} from '@touchgrass/avatar';

const traits = decodeDNA('0a3f201');
traits.hat = 3;  // crown
const newDna = encodeDNA(traits);</code></pre>
        </div>
      </article>
    </div>

    <!-- Svelte component -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Svelte component</p>
        <p class="code-section-desc">Drop-in component with animations and size presets.</p>
        <pre class="code-block"><code>&lt;script&gt;
  import {'{'} Avatar {'}'} from '@touchgrass/avatar/svelte';
&lt;/script&gt;

&lt;!-- From DNA --&gt;
&lt;Avatar dna="0a3f201" /&gt;

&lt;!-- From name (deterministic hash) --&gt;
&lt;Avatar name="my-agent" /&gt;

&lt;!-- Sizes: sm (3px), lg (8px), xl (14px) --&gt;
&lt;Avatar dna="0a3f201" size="xl" /&gt;

&lt;!-- Animations --&gt;
&lt;Avatar dna="0a3f201" walking /&gt;
&lt;Avatar dna="0a3f201" talking /&gt;
&lt;Avatar dna="0a3f201" waving /&gt;</code></pre>
      </div>
    </article>

    <!-- Animations demo -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Animations</p>
        <div class="av-anim-section">
          <div class="av-anim-group">
            <p class="av-anim-label">Idle</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(0, 5) as dna}
                <AgentFace {dna} size="lg" />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Walking</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(5, 10) as dna}
                <AgentFace {dna} size="lg" walking />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Talking</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(10, 15) as dna}
                <AgentFace {dna} size="lg" talking />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Waving</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(15, 20) as dna}
                <AgentFace {dna} size="lg" waving />
              {/each}
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- Terminal rendering -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Terminal rendering</p>
        <p class="code-section-desc">ANSI 24-bit color output for CLIs and terminal UIs.</p>
        <pre class="code-block"><code>import {'{'} renderTerminal, renderTerminalSmall {'}'} from '@touchgrass/avatar';

console.log(renderTerminal('0a3f201'));      // full size (block chars)
console.log(renderTerminalSmall('0a3f201')); // compact (half-block)</code></pre>
      </div>
    </article>

    <!-- SVG rendering -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">SVG rendering</p>
        <p class="code-section-desc">Scalable vector output. Set pixel size, walking frame, or use as data URI.</p>
        <pre class="code-block"><code>import {'{'} renderSVG {'}'} from '@touchgrass/avatar';

const svg = renderSVG('0a3f201');           // 10px per pixel
const big = renderSVG('0a3f201', 20);       // 20px per pixel
const walk = renderSVG('0a3f201', 10, 1);   // walking frame 1

// Use as image source
const dataUri = `data:image/svg+xml,${'{'}encodeURIComponent(svg){'}'}`;</code></pre>
      </div>
    </article>

    <!-- DNA encoding table -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">DNA encoding</p>
        <p class="code-section-desc">7 traits packed into a single integer using mixed-radix encoding with fixed slot sizes.</p>
        <div class="av-table-wrap">
          <table class="av-table">
            <thead>
              <tr>
                <th>Trait</th>
                <th>Variants</th>
                <th>Slot</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Eyes</td><td>{EYES.length}</td><td>{SLOTS.eyes}</td></tr>
              <tr><td>Mouths</td><td>{MOUTHS.length}</td><td>{SLOTS.mouths}</td></tr>
              <tr><td>Hats</td><td>{HATS.length}</td><td>{SLOTS.hats}</td></tr>
              <tr><td>Bodies</td><td>{BODIES.length}</td><td>{SLOTS.bodies}</td></tr>
              <tr><td>Legs</td><td>{LEGS.length}</td><td>{SLOTS.legs}</td></tr>
              <tr><td>Face hue</td><td>12</td><td>{SLOTS.hues}</td></tr>
              <tr><td>Hat hue</td><td>12</td><td>{SLOTS.hues}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="av-table-footer">Total: {TOTAL.toLocaleString()} slot space. New variants can be added within slot limits without breaking existing DNA strings.</p>
      </div>
    </article>

    <!-- Traits showcase -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Hats ({HATS.length} variants)</p>
        <div class="av-trait-row">
          {#each Array.from({ length: HATS.length }, (_, i) => i) as i}
            <AgentFace dna={encodeDNA({ ...base, hat: i })} size="sm" />
          {/each}
        </div>
      </div>
    </article>

    <div class="feature-grid cols-2">
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">Eyes ({EYES.length})</p>
          <div class="av-trait-row">
            {#each Array.from({ length: EYES.length }, (_, i) => i) as i}
              <AgentFace dna={encodeDNA({ ...base, eyes: i })} size="sm" />
            {/each}
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">Mouths ({MOUTHS.length})</p>
          <div class="av-trait-row">
            {#each Array.from({ length: MOUTHS.length }, (_, i) => i) as i}
              <AgentFace dna={encodeDNA({ ...base, mouth: i })} size="sm" />
            {/each}
          </div>
        </div>
      </article>
    </div>

    <div class="feature-grid cols-2">
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">Bodies ({BODIES.length})</p>
          <div class="av-trait-row">
            {#each Array.from({ length: BODIES.length }, (_, i) => i) as i}
              <AgentFace dna={encodeDNA({ ...base, body: i })} size="sm" />
            {/each}
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">Legs ({LEGS.length})</p>
          <div class="av-trait-row">
            {#each Array.from({ length: LEGS.length }, (_, i) => i) as i}
              <AgentFace dna={encodeDNA({ ...base, legs: i })} size="sm" />
            {/each}
          </div>
        </div>
      </article>
    </div>

    <!-- Color wheel -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">12 hues</p>
        <p class="code-section-desc">Two independent color channels: face and hat. Each cycles through 12 hues at 30-degree steps.</p>
        <div class="av-trait-row">
          {#each Array.from({ length: 12 }, (_, i) => i) as hue}
            <AgentFace dna={encodeDNA({ ...base, faceHue: hue, hatHue: (hue + 6) % 12, hat: 2 })} size="sm" />
          {/each}
        </div>
      </div>
    </article>

    <!-- Exports -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Exports</p>
        <pre class="code-block"><code>@touchgrass/avatar          Core TypeScript (DNA, grid, SVG, terminal, colors)
@touchgrass/avatar/svelte   Svelte 5 component</code></pre>
        <p class="code-section-desc" style="margin-top: 0.75rem;">React and terminal UI components coming soon.</p>
      </div>
    </article>

    <!-- Bottom row -->
    <a
      href="https://github.com/tomtev/touchgrass/tree/main/packages/avatar"
      target="_blank"
      rel="noreferrer"
      class="docs-link"
    >
      View on GitHub
      <span aria-hidden="true">&rarr;</span>
    </a>

    <div class="agent-row">
      {#each showcaseDNAs as dna}
        <AgentFace {dna} size="sm" walking />
      {/each}
    </div>

  </div>
</main>

<style>
  .av-page {
    min-height: 100vh;
    background: var(--background);
    color: var(--foreground);
  }

  .av-content {
    max-width: 72rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem 1.5rem;
  }

  @media (min-width: 1024px) {
    .av-content {
      padding: 3rem 2rem;
    }
  }

  /* Hero avatar row */
  .av-hero-row {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-bottom: 0.5rem;
  }

  /* Showcase section */
  .av-showcase {
    display: flex;
    gap: 2rem;
    align-items: center;
  }

  .av-showcase-hero {
    flex-shrink: 0;
  }

  .av-showcase-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
  }

  @media (max-width: 639px) {
    .av-showcase {
      flex-direction: column;
      align-items: center;
    }
  }

  /* Animation demo */
  .av-anim-section {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 0.75rem;
  }

  .av-anim-group {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .av-anim-label {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: rgba(209, 250, 229, 0.5);
    width: 5rem;
    flex-shrink: 0;
    text-align: right;
  }

  .av-anim-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  @media (max-width: 639px) {
    .av-anim-group {
      flex-direction: column;
      align-items: flex-start;
    }
    .av-anim-label {
      text-align: left;
    }
  }

  /* Trait rows */
  .av-trait-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  /* DNA table */
  .av-table-wrap {
    margin-top: 0.75rem;
    overflow-x: auto;
  }

  .av-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .av-table th {
    text-align: left;
    padding: 0.5rem 1rem;
    color: rgb(110, 231, 183);
    border-bottom: 1px solid rgba(167, 243, 208, 0.2);
    font-weight: 500;
  }

  .av-table td {
    padding: 0.375rem 1rem;
    color: rgba(209, 250, 229, 0.8);
    border-bottom: 1px solid rgba(167, 243, 208, 0.08);
  }

  .av-table-footer {
    margin-top: 0.75rem;
    font-size: 0.8125rem;
    color: rgba(209, 250, 229, 0.5);
  }
</style>
