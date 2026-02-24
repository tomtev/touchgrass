<script>
  import { Avatar } from 'termlings/svelte';
  import { encodeDNA, SLOTS, EYES, MOUTHS, HATS, BODIES, LEGS } from 'termlings';

  const EYES_NAMES = [
    'normal', 'wide', 'close', 'normal-alt', 'big', 'big-close',
    'squint', 'squint-wide', 'narrow', 'narrow-wide', 'narrow-close'
  ];
  const MOUTHS_NAMES = [
    'smile', 'smirk-left', 'smirk-right', 'narrow',
    'wide-smile', 'wide-smirk-left', 'wide-smirk-right'
  ];
  const HATS_NAMES = [
    'none', 'tophat', 'beanie', 'crown', 'cap', 'horns', 'mohawk', 'antenna',
    'halo', 'bandage', 'wide-brim', 'unicorn', 'ears', 'spikes', 'party-hat',
    'flat-top', 'afro', 'spiky-thin', 'side-sweep', 'tiara', 'cowboy', 'knitted',
    'clown-hair', 'stovepipe'
  ];
  const BODIES_NAMES = [
    'normal', 'normal-arms', 'narrow', 'narrow-arms', 'tapered', 'tapered-arms'
  ];
  const LEGS_NAMES = [
    'biped', 'quad', 'tentacles', 'thin-biped', 'wide-stance', 'thin-narrow'
  ];

  const TOTAL = SLOTS.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;

  const base = { eyes: 0, mouth: 0, hat: 0, body: 0, legs: 0, faceHue: 8, hatHue: 16 };

  function variantDNA(trait, index) {
    return encodeDNA({ ...base, [trait]: index });
  }

  // Deterministic random-looking avatars (seeded from index)
  function seededDNA(i) {
    const h = (i * 2654435761) >>> 0; // Knuth multiplicative hash
    return encodeDNA({
      eyes: h % EYES_NAMES.length,
      mouth: (h >>> 4) % MOUTHS_NAMES.length,
      hat: (h >>> 8) % HATS_NAMES.length,
      body: (h >>> 13) % BODIES_NAMES.length,
      legs: (h >>> 16) % LEGS_NAMES.length,
      faceHue: (h >>> 19) % 12,
      hatHue: (h >>> 23) % 12,
    });
  }

  const randomAvatars = Array.from({ length: 60 }, (_, i) => seededDNA(i));
</script>

<svelte:head>
  <title>Avatar Test | touchgrass.sh</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="test-page">
  <h1 class="section-title">Avatar Test Page</h1>
  <p class="section-desc">{TOTAL.toLocaleString()} possible DNA combinations. Eyes: {EYES_NAMES.length}, Mouths: {MOUTHS_NAMES.length}, Hats: {HATS_NAMES.length}, Bodies: {BODIES_NAMES.length}, Legs: {LEGS_NAMES.length}, Hues: {SLOTS.hues}x{SLOTS.hues}</p>

  <!-- Eyes -->
  <section>
    <h2 class="section-title">Eyes ({EYES_NAMES.length})</h2>
    <div class="avatar-grid">
      {#each EYES_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('eyes', i)} size="xl" />
          <code class="dna-label">{i}: {name}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Mouths -->
  <section>
    <h2 class="section-title">Mouths ({MOUTHS_NAMES.length})</h2>
    <div class="avatar-grid">
      {#each MOUTHS_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('mouth', i)} size="xl" />
          <code class="dna-label">{i}: {name}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Hats -->
  <section>
    <h2 class="section-title">Hats ({HATS_NAMES.length})</h2>
    <div class="avatar-grid">
      {#each HATS_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('hat', i)} size="lg" />
          <code class="dna-label">{i}: {name}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Bodies -->
  <section>
    <h2 class="section-title">Bodies ({BODIES_NAMES.length})</h2>
    <div class="avatar-grid">
      {#each BODIES_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('body', i)} size="xl" />
          <code class="dna-label">{i}: {name}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Legs -->
  <section>
    <h2 class="section-title">Legs ({LEGS_NAMES.length})</h2>
    <div class="avatar-grid">
      {#each LEGS_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('legs', i)} size="xl" />
          <code class="dna-label">{i}: {name}</code>
        </div>
      {/each}
    </div>
    <h3 class="section-subtitle">Walking</h3>
    <div class="avatar-grid">
      {#each LEGS_NAMES as name, i}
        <div class="avatar-card">
          <Avatar dna={variantDNA('legs', i)} size="xl" walking />
          <code class="dna-label">{name}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Hue wheel -->
  <section>
    <h2 class="section-title">Hue Wheel (12 face hues)</h2>
    <div class="avatar-grid">
      {#each Array.from({ length: 12 }, (_, i) => i) as hue}
        <div class="avatar-card">
          <Avatar dna={encodeDNA({ ...base, faceHue: hue, hatHue: (hue + 6) % 12, hat: 2 })} size="lg" />
          <code class="dna-label">{hue * 30}&deg;</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Sizes -->
  <section>
    <h2 class="section-title">Sizes</h2>
    <div class="size-row">
      <div class="avatar-card">
        <Avatar dna={randomAvatars[0]} size="sm" />
        <code class="dna-label">sm</code>
      </div>
      <div class="avatar-card">
        <Avatar dna={randomAvatars[0]} size="lg" />
        <code class="dna-label">lg</code>
      </div>
      <div class="avatar-card">
        <Avatar dna={randomAvatars[0]} size="xl" />
        <code class="dna-label">xl</code>
      </div>
    </div>
  </section>

  <!-- Waving -->
  <section>
    <h2 class="section-title">Waving</h2>
    <div class="avatar-grid">
      {#each Array.from({ length: 8 }, (_, i) => encodeDNA({ ...base, body: 1, legs: i })) as dna}
        <div class="avatar-card">
          <Avatar {dna} size="lg" waving />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Talking -->
  <section>
    <h2 class="section-title">Talking</h2>
    <div class="avatar-grid">
      {#each randomAvatars.slice(0, 8) as dna}
        <div class="avatar-card">
          <Avatar {dna} size="lg" talking />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Idle -->
  <section>
    <h2 class="section-title">Idle (default)</h2>
    <p class="section-desc">Subtle body bounce animation.</p>
    <div class="avatar-grid">
      {#each randomAvatars.slice(0, 20) as dna}
        <div class="avatar-card">
          <Avatar {dna} size="lg" />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Walking -->
  <section>
    <h2 class="section-title">Walking</h2>
    <div class="avatar-grid">
      {#each randomAvatars.slice(20, 40) as dna}
        <div class="avatar-card">
          <Avatar {dna} size="lg" walking />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- XL Showcase -->
  <section>
    <h2 class="section-title">XL Showcase</h2>
    <div class="xl-row">
      {#each randomAvatars.slice(0, 8) as dna}
        <div class="avatar-card">
          <Avatar {dna} size="xl" walking />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>
</main>

<style>
  .test-page {
    min-height: 100vh;
    background: var(--background);
    color: var(--foreground);
    padding: 2rem 1.5rem;
    max-width: 80rem;
    margin: 0 auto;
  }

  section {
    margin-top: 2.5rem;
  }

  .section-title {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    color: rgb(110, 231, 183);
    margin: 0 0 0.25rem;
  }

  .section-subtitle {
    font-family: var(--font-mono);
    font-size: 1rem;
    color: rgb(110, 231, 183);
    margin: 1.25rem 0 0.25rem;
  }

  .section-desc {
    font-size: 0.875rem;
    color: rgba(209, 250, 229, 0.7);
    margin: 0 0 1rem;
  }

  .avatar-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .avatar-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
  }

  .dna-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: rgba(209, 250, 229, 0.5);
    background: none;
    padding: 0;
    border: none;
  }

  .size-row {
    display: flex;
    align-items: flex-end;
    gap: 2rem;
  }

  .xl-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-end;
  }
</style>
