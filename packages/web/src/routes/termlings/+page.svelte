<script>
  import { Avatar } from 'termlings/svelte';
  import CopyButton from '$lib/CopyButton.svelte';
  import CodeBlock from '$lib/CodeBlock.svelte';
  import { encodeDNA, decodeDNA, generateRandomDNA, traitsFromName, SLOTS, EYES, MOUTHS, HATS, BODIES, LEGS } from 'termlings';

  const installCommand = 'npm install termlings';
  const heroDNA = '0a3f201';
  const showcaseDNAs = [
    '03b8e10', '0c47a25', '0912d4f', '00f1a32', '05d4c81',
    '0a29e70', '0e8b3d4', '029f6a5', '07c1d93', '0b5e2f6',
  ];
  const TOTAL = SLOTS.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;

  // Builder state
  let builderTraits = $state({ eyes: 0, mouth: 0, hat: 2, body: 1, legs: 0, faceHue: 8, hatHue: 2 });
  let builderDna = $derived(encodeDNA(builderTraits));
  let builderWalking = $state(false);
  let builderTalking = $state(false);
  let builderWaving = $state(false);

  // Name-to-avatar
  let nameInput = $state('');
  let nameDna = $derived(nameInput ? encodeDNA(traitsFromName(nameInput)) : null);

  // Trait name arrays
  const EYES_NAMES = ['normal','wide','close','normal-alt','big','big-close','squint','squint-wide','narrow','narrow-wide','narrow-close'];
  const MOUTHS_NAMES = ['smile','smirk-left','smirk-right','narrow','wide-smile','wide-smirk-left','wide-smirk-right'];
  const HATS_NAMES = ['none','tophat','beanie','crown','cap','horns','mohawk','antenna','halo','bandage','wide-brim','unicorn','ears','spikes','party-hat','flat-top','afro','side-sweep','cowboy','knitted','clown-hair','stovepipe'];
  const BODIES_NAMES = ['normal','normal-arms','narrow','narrow-arms','tapered','tapered-arms'];
  const LEGS_NAMES = ['biped','outer','tentacles','thin-biped','wide-stance','thin-narrow'];
  const HUE_NAMES = ['red','orange','yellow','lime','green','teal','cyan','azure','blue','purple','magenta','rose'];

  // Leg demo base traits
  const legDemoBase = { eyes: 0, mouth: 0, hat: 2, body: 0, legs: 0, faceHue: 8, hatHue: 2 };

  // Mass grid (60 deterministic avatars with random animations)
  const massGrid = Array.from({ length: 60 }, (_, i) => {
    const dna = encodeDNA(traitsFromName(`agent-${i}`));
    // Use index to deterministically assign animations (~30% walking, ~20% talking, ~10% waving, rest idle)
    const mod = i % 10;
    return {
      dna,
      walking: mod === 1 || mod === 4 || mod === 7,
      talking: mod === 2 || mod === 5 || mod === 8,
      waving: mod === 3,
    };
  });


  // Code examples
  const coreExample = `import { generateRandomDNA, renderSVG } from 'termlings';

const dna = generateRandomDNA();  // "0a3f201"
const svg = renderSVG(dna);       // complete <svg> string

document.body.innerHTML = svg;`;

  const nameExample = `import { traitsFromName, encodeDNA } from 'termlings';

const traits = traitsFromName('my-agent');
const dna = encodeDNA(traits);
// Same name always produces the same avatar`;

  const decodeExample = `import { decodeDNA, encodeDNA } from 'termlings';

const traits = decodeDNA('0a3f201');
traits.hat = 3;  // switch to crown
const newDna = encodeDNA(traits);`;

  const svelteExample = `<script>
  import { Avatar } from 'termlings/svelte';
<\/script>

<!-- From DNA -->
<Avatar dna="0a3f201" />

<!-- From name (deterministic hash) -->
<Avatar name="my-agent" />

<!-- Sizes: sm (3px), lg (8px), xl (14px) -->
<Avatar dna="0a3f201" size="xl" />

<!-- Animations -->
<Avatar dna="0a3f201" walking />
<Avatar dna="0a3f201" talking />
<Avatar dna="0a3f201" waving />`;

  const reactExample = `import { Avatar } from 'termlings/react';

function App() {
  return (
    <>
      <Avatar dna="0a3f201" />
      <Avatar name="my-agent" size="xl" />
      <Avatar dna="0a3f201" walking />
      <Avatar dna="0a3f201" talking />
      <Avatar dna="0a3f201" waving />
    </>
  );
}`;

  const vueExample = `<script setup>
  import { Avatar } from 'termlings/vue';
<\/script>

<template>
  <Avatar dna="0a3f201" />
  <Avatar name="my-agent" size="xl" />
  <Avatar dna="0a3f201" walking />
  <Avatar dna="0a3f201" talking />
  <Avatar dna="0a3f201" waving />
</template>`;

  const terminalExample = `import { renderTerminal, renderTerminalSmall } from 'termlings';

// ANSI 24-bit color output
console.log(renderTerminal('0a3f201'));      // full size (██ blocks)
console.log(renderTerminalSmall('0a3f201')); // compact (▀▄ half-blocks)`;

  const inkExample = `import { render } from 'ink';
import { Avatar } from 'termlings/ink';

// Full-size (██ blocks)
render(<Avatar dna="0a3f201" />);

// Compact (▀▄ half-blocks)
render(<Avatar dna="0a3f201" compact />);

// With animations
render(<Avatar dna="0a3f201" walking />);
render(<Avatar dna="0a3f201" talking />);`;

  const svgExample = `import { renderSVG } from 'termlings';

const svg = renderSVG('0a3f201');           // 10px per pixel
const big = renderSVG('0a3f201', 20);       // 20px per pixel
const walk = renderSVG('0a3f201', 10, 1);   // walking frame 1

// Use as image source
const uri = \`data:image/svg+xml,\${encodeURIComponent(svg)}\`;`;

  let activeTab = $state('svelte');

  function randomize() {
    builderTraits = decodeDNA(generateRandomDNA());
  }
</script>

<svelte:head>
  <title>Termlings - Open Source Pixel Art Avatars | touchgrass.sh</title>
  <meta name="description" content="Open source pixel art avatar system. 32M+ unique characters from a 7-character DNA string. Svelte, React, Vue, and terminal." />
  <meta property="og:title" content="Termlings - Pixel Art Identity System" />
  <meta property="og:description" content="Open source pixel art avatars. 32M+ unique characters from a 7-char hex DNA." />
</svelte:head>

<main class="av-page">
  <div class="av-content">

    <nav class="av-top-nav">
      <a href="/" class="av-top-nav-link">touchgrass.sh</a>
      <span class="av-top-nav-sep">/</span>
      <span class="av-top-nav-current">termlings</span>
    </nav>

    <!-- Hero -->
    <article class="card">
      <div class="card-header">
        <div class="av-hero-row">
          {#each showcaseDNAs.slice(0, 7) as dna, i}
            <Avatar {dna} size="lg" walking={i % 3 === 0} talking={i % 3 === 1} waving={i % 4 === 2} />
          {/each}
        </div>
        <h1 class="card-title">Pixel art avatars for the web and terminal.</h1>
        <p class="card-subtitle">
          Open source avatar system. {TOTAL.toLocaleString()} unique characters encoded as a 7-character hex DNA string. Svelte, React, Vue, and terminal.
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
          href="https://github.com/tomtev/touchgrass/tree/main/packages/termlings"
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

    <!-- Feature cards -->
    <div class="feature-grid cols-3">
      <article class="card">
        <div class="card-body feature-card-inner">
          <Avatar dna={showcaseDNAs[0]} size="lg" />
          <div>
            <p class="feature-title">7-char DNA</p>
            <p class="feature-desc">Each avatar is a hex string like <code>0a3f201</code>. Store it, share it, render it anywhere.</p>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body feature-card-inner">
          <Avatar dna={showcaseDNAs[1]} size="lg" />
          <div>
            <p class="feature-title">32M combinations</p>
            <p class="feature-desc">7 traits: eyes, mouth, hat, body, legs, and two color hues. All deterministic.</p>
          </div>
        </div>
      </article>
      <article class="card">
        <div class="card-body feature-card-inner">
          <Avatar dna={showcaseDNAs[2]} size="lg" />
          <div>
            <p class="feature-title">Web + Terminal</p>
            <p class="feature-desc">SVG, Svelte, React, Vue, or ANSI terminal art. Same DNA everywhere.</p>
          </div>
        </div>
      </article>
    </div>

    <!-- Example Grid -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Examples</p>
        <div class="av-mass-grid">
          {#each massGrid as av}
            <Avatar dna={av.dna} size="lg" walking={av.walking} talking={av.talking} waving={av.waving} />
          {/each}
        </div>
      </div>
    </article>

    <!-- Name to Avatar -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Name to Avatar</p>
        <p class="code-section-desc">Type any string to see its deterministic avatar. Same name always produces the same result.</p>
        <div class="av-name-section">
          <input
            type="text"
            class="av-name-input"
            placeholder="type a name..."
            bind:value={nameInput}
          />
          {#if nameDna}
            <div class="av-name-result">
              <Avatar dna={nameDna} size="lg" />
              <code class="av-name-dna">{nameDna}</code>
            </div>
          {/if}
        </div>
      </div>
    </article>

    <!-- Animation Showcase -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Animations</p>
        <div class="av-anim-section">
          <div class="av-anim-group">
            <p class="av-anim-label">Idle</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(0, 3) as dna}
                <Avatar {dna} size="lg" />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Walking</p>
            <div class="av-anim-row">
              {#each Array.from({ length: LEGS.length }, (_, i) => i) as i}
                <div class="av-anim-item">
                  <Avatar dna={encodeDNA({...legDemoBase, legs: i})} size="lg" walking />
                  <span class="av-anim-item-label">{LEGS_NAMES[i]}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Talking</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(3, 6) as dna}
                <Avatar {dna} size="lg" talking />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Waving</p>
            <div class="av-anim-row">
              {#each showcaseDNAs.slice(6, 9) as dna}
                <Avatar {dna} size="lg" waving />
              {/each}
            </div>
          </div>
          <div class="av-anim-group">
            <p class="av-anim-label">Combined</p>
            <div class="av-anim-row">
              <div class="av-anim-item">
                <Avatar dna={showcaseDNAs[0]} size="lg" walking talking />
                <span class="av-anim-item-label">walk+talk</span>
              </div>
              <div class="av-anim-item">
                <Avatar dna={showcaseDNAs[1]} size="lg" walking talking />
                <span class="av-anim-item-label">walk+talk</span>
              </div>
              <div class="av-anim-item">
                <Avatar dna={showcaseDNAs[2]} size="lg" waving talking />
                <span class="av-anim-item-label">wave+talk</span>
              </div>
              <div class="av-anim-item">
                <Avatar dna={showcaseDNAs[3]} size="lg" waving talking />
                <span class="av-anim-item-label">wave+talk</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- Size Comparison -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Sizes</p>
        <div class="av-size-row">
          <div class="av-size-item">
            <Avatar dna={builderDna} size="sm" />
            <span class="av-size-label">sm (3px)</span>
          </div>
          <div class="av-size-item">
            <Avatar dna={builderDna} size="lg" />
            <span class="av-size-label">lg (8px)</span>
          </div>
          <div class="av-size-item">
            <Avatar dna={builderDna} size="xl" />
            <span class="av-size-label">xl (14px)</span>
          </div>
        </div>
      </div>
    </article>



    <!-- Quick start -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Quick start</p>
        <p class="code-section-desc">Generate a random avatar and render it as SVG.</p>
        <CodeBlock code={coreExample} lang="ts" />
      </div>
    </article>

    <!-- Name + decode -->
    <div class="feature-grid cols-2">
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">From a name</p>
          <p class="code-section-desc">Hash any string to a deterministic avatar.</p>
          <CodeBlock code={nameExample} lang="ts" />
        </div>
      </article>
      <article class="card">
        <div class="card-body-lg">
          <p class="code-section-title">Encode & decode</p>
          <p class="code-section-desc">Modify individual traits and re-encode.</p>
          <CodeBlock code={decodeExample} lang="ts" />
        </div>
      </article>
    </div>

    <!-- Framework tabs -->
    <article class="card">
      <div class="card-body-lg">
        <div class="av-tabs">
          <button class="av-tab" class:active={activeTab === 'svelte'} onclick={() => activeTab = 'svelte'}>Svelte</button>
          <button class="av-tab" class:active={activeTab === 'react'} onclick={() => activeTab = 'react'}>React</button>
          <button class="av-tab" class:active={activeTab === 'vue'} onclick={() => activeTab = 'vue'}>Vue</button>
          <button class="av-tab" class:active={activeTab === 'terminal'} onclick={() => activeTab = 'terminal'}>Terminal</button>
        </div>
        {#if activeTab === 'svelte'}
          <CodeBlock code={svelteExample} lang="svelte" />
        {:else if activeTab === 'react'}
          <CodeBlock code={reactExample} lang="jsx" />
        {:else if activeTab === 'vue'}
          <CodeBlock code={vueExample} lang="vue" />
        {:else if activeTab === 'terminal'}
          <p class="av-tab-subtitle">ANSI output (any Node.js/Bun script)</p>
          <CodeBlock code={terminalExample} lang="ts" />
          <p class="av-tab-subtitle" style="margin-top: 1rem;">Ink component (React for terminals)</p>
          <CodeBlock code={inkExample} lang="jsx" />
        {/if}
      </div>
    </article>

    <!-- SVG rendering -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">SVG rendering</p>
        <p class="code-section-desc">Scalable vector output with walking frames.</p>
        <CodeBlock code={svgExample} lang="ts" />
      </div>
    </article>

    <!-- DNA encoding table -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">DNA encoding</p>
        <p class="code-section-desc">7 traits packed into a single integer using mixed-radix encoding.</p>
        <div class="av-table-wrap">
          <table class="av-table">
            <thead>
              <tr><th>Trait</th><th>Variants</th><th>Slot</th></tr>
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
        <p class="av-table-footer">{TOTAL.toLocaleString()} total slot space. New variants added within slot limits won't break existing DNA strings.</p>
      </div>
    </article>

    <!-- Exports -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Exports</p>
        <CodeBlock code={`termlings          Core TypeScript (DNA, grid, SVG, terminal, colors)
termlings/svelte   Svelte 5 component
termlings/react    React component
termlings/vue      Vue 3 component
termlings/ink      Ink component (React for terminals)`} lang="bash" />
      </div>
    </article>

    <!-- Avatar Builder -->
    <article class="card">
      <div class="card-body-lg">
        <p class="code-section-title">Avatar Builder</p>
        <div class="av-builder">
          <div class="av-builder-preview">
            <Avatar dna={builderDna} size="xl" walking={builderWalking} talking={builderTalking} waving={builderWaving} />
            <div class="av-builder-toggles">
              <button class="av-toggle" class:active={builderWalking} onclick={() => builderWalking = !builderWalking}>walk</button>
              <button class="av-toggle" class:active={builderTalking} onclick={() => builderTalking = !builderTalking}>talk</button>
              <button class="av-toggle" class:active={builderWaving} onclick={() => builderWaving = !builderWaving}>wave</button>
            </div>
            <div class="av-builder-controls">
              <code class="av-builder-dna">{builderDna}</code>
              <CopyButton command={builderDna} />
              <button class="av-randomize" onclick={randomize}>Randomize</button>
            </div>
          </div>
          <div class="av-trait-picker">
            <!-- Face hue -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Face hue</span>
              <div class="av-trait-options">
                {#each Array.from({ length: 12 }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.faceHue === i}
                    onclick={() => builderTraits.faceHue = i}
                    title={HUE_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, faceHue: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Hat hue -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Hat hue</span>
              <div class="av-trait-options">
                {#each Array.from({ length: 12 }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.hatHue === i}
                    onclick={() => builderTraits.hatHue = i}
                    title={HUE_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, hatHue: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Eyes -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Eyes</span>
              <div class="av-trait-options">
                {#each Array.from({ length: EYES.length }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.eyes === i}
                    onclick={() => builderTraits.eyes = i}
                    title={EYES_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, eyes: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Mouths -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Mouth</span>
              <div class="av-trait-options">
                {#each Array.from({ length: MOUTHS.length }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.mouth === i}
                    onclick={() => builderTraits.mouth = i}
                    title={MOUTHS_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, mouth: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Hats -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Hat</span>
              <div class="av-trait-options">
                {#each Array.from({ length: HATS.length }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.hat === i}
                    onclick={() => builderTraits.hat = i}
                    title={HATS_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, hat: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Bodies -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Body</span>
              <div class="av-trait-options">
                {#each Array.from({ length: BODIES.length }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.body === i}
                    onclick={() => builderTraits.body = i}
                    title={BODIES_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, body: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
            <!-- Legs -->
            <div class="av-trait-row-wrap">
              <span class="av-trait-label">Legs</span>
              <div class="av-trait-options">
                {#each Array.from({ length: LEGS.length }, (_, i) => i) as i}
                  <button
                    class="av-trait-option"
                    class:selected={builderTraits.legs === i}
                    onclick={() => builderTraits.legs = i}
                    title={LEGS_NAMES[i]}
                  >
                    <Avatar dna={encodeDNA({...builderTraits, legs: i})} size="sm" />
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- Links -->
    <a
      href="https://github.com/tomtev/touchgrass/tree/main/packages/termlings"
      target="_blank"
      rel="noreferrer"
      class="docs-link"
    >
      View on GitHub
      <span aria-hidden="true">&rarr;</span>
    </a>

    <div class="agent-row">
      {#each showcaseDNAs as dna}
        <Avatar {dna} size="sm" />
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

  .av-top-nav {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .av-top-nav-link {
    color: rgba(209, 250, 229, 0.5);
    text-decoration: none;
    transition: color 0.15s;
  }

  .av-top-nav-link:hover {
    color: rgb(110, 231, 183);
  }

  .av-top-nav-sep {
    color: rgba(209, 250, 229, 0.25);
  }

  .av-top-nav-current {
    color: rgba(209, 250, 229, 0.8);
  }

  .av-hero-row {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-bottom: 0.5rem;
  }

  /* Builder */
  .av-builder {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }

  .av-builder-preview {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .av-builder-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .av-builder-dna {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: rgb(110, 231, 183);
    background: rgba(110, 231, 183, 0.1);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .av-builder-toggles {
    display: flex;
    gap: 0.375rem;
  }

  .av-toggle {
    padding: 0.2rem 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(167, 243, 208, 0.2);
    background: transparent;
    color: rgba(209, 250, 229, 0.5);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .av-toggle:hover {
    border-color: rgba(167, 243, 208, 0.4);
    color: rgba(209, 250, 229, 0.8);
  }

  .av-toggle.active {
    background: rgba(110, 231, 183, 0.15);
    border-color: rgba(110, 231, 183, 0.4);
    color: rgb(110, 231, 183);
  }

  .av-randomize {
    padding: 0.25rem 0.625rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(167, 243, 208, 0.2);
    background: transparent;
    color: rgba(209, 250, 229, 0.7);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .av-randomize:hover {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(209, 250, 229, 0.95);
    border-color: rgba(167, 243, 208, 0.4);
  }

  .av-trait-picker {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .av-trait-row-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .av-trait-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: rgba(209, 250, 229, 0.5);
    width: 5rem;
    flex-shrink: 0;
    text-align: right;
  }

  .av-trait-options {
    display: flex;
    gap: 3px;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
    scrollbar-width: thin;
    scrollbar-color: rgba(167, 243, 208, 0.15) transparent;
  }

  .av-trait-option {
    flex-shrink: 0;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .av-trait-option:hover {
    border-color: rgba(110, 231, 183, 0.4);
  }

  .av-trait-option.selected {
    border-color: rgb(110, 231, 183);
    background: rgba(110, 231, 183, 0.1);
  }

  @media (max-width: 639px) {
    .av-builder {
      flex-direction: column;
      align-items: center;
    }
    .av-trait-row-wrap {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.25rem;
    }
    .av-trait-label {
      text-align: left;
      width: auto;
    }
  }

  /* Name to Avatar */
  .av-name-section {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  .av-name-input {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgba(167, 243, 208, 0.2);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.3);
    color: rgba(209, 250, 229, 0.9);
    width: 16rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .av-name-input:focus {
    border-color: rgba(110, 231, 183, 0.5);
  }

  .av-name-input::placeholder {
    color: rgba(209, 250, 229, 0.3);
  }

  .av-name-result {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .av-name-dna {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: rgba(209, 250, 229, 0.6);
  }

  /* Animations */
  .av-anim-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
    align-items: flex-end;
  }

  .av-anim-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .av-anim-item-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: rgba(209, 250, 229, 0.35);
  }

  @media (max-width: 639px) {
    .av-anim-group {
      flex-direction: column;
      align-items: flex-start;
    }
    .av-anim-label {
      text-align: left;
      width: auto;
    }
  }

  /* Sizes */
  .av-size-row {
    display: flex;
    align-items: flex-end;
    gap: 2rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  .av-size-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .av-size-label {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: rgba(209, 250, 229, 0.45);
  }


  /* Mass Grid */
  .av-mass-grid {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 0.5rem;
    margin-top: 0.75rem;
    justify-items: center;
  }

  @media (max-width: 639px) {
    .av-mass-grid {
      grid-template-columns: repeat(5, 1fr);
    }
  }

  /* Tabs */
  .av-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .av-tab {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(167, 243, 208, 0.2);
    background: transparent;
    color: rgba(209, 250, 229, 0.6);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .av-tab:hover {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(209, 250, 229, 0.9);
  }

  .av-tab.active {
    background: rgba(110, 231, 183, 0.15);
    border-color: rgba(110, 231, 183, 0.4);
    color: rgb(110, 231, 183);
  }

  .av-tab-subtitle {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: rgba(209, 250, 229, 0.45);
    margin-bottom: 0.5rem;
  }

  /* Table */
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
