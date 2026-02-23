<script>
  import AgentFace from '$lib/AgentFace.svelte';

  const TOTAL = 12 * 12 * 24 * 8 * 8 * 12 * 12;

  const EYES_NAMES = ['normal', 'wide', 'close', 'normal-alt', 'big', 'big-close'];
  const MOUTHS_NAMES = ['smile', 'flat', 'open', 'smirk', 'grin', 'dot'];
  const HATS_NAMES = [
    'none', 'tophat', 'beanie', 'crown', 'cap', 'horns', 'mohawk', 'antenna',
    'halo', 'bandage', 'wide-brim', 'unicorn', 'ears', 'spikes', 'party-hat',
    'flat-top', 'afro', 'spiky-thin', 'side-sweep', 'tiara', 'cowboy', 'knitted',
    'clown-hair', 'stovepipe'
  ];
  const BODIES_NAMES = ['normal', 'arms-down', 'arms-out', 'stubby', 'pear', 'round', 'tapered'];
  const LEGS_NAMES = ['biped', 'quad', 'tentacles', 'hexapod', 'wheels', 'tripod', 'wide-stance', 'animal'];

  const SLOTS = { eyes: 12, mouths: 12, hats: 24, bodies: 8, legs: 8, hues: 12 };

  function randomDNA() {
    return Math.floor(Math.random() * TOTAL).toString(16).padStart(6, '0');
  }

  function decodeDNA(hex) {
    let n = parseInt(hex, 16);
    const hatHue = n % SLOTS.hues; n = Math.floor(n / SLOTS.hues);
    const faceHue = n % SLOTS.hues; n = Math.floor(n / SLOTS.hues);
    const legs = n % SLOTS.legs; n = Math.floor(n / SLOTS.legs);
    const body = n % SLOTS.bodies; n = Math.floor(n / SLOTS.bodies);
    const hat = n % SLOTS.hats; n = Math.floor(n / SLOTS.hats);
    const mouth = n % SLOTS.mouths; n = Math.floor(n / SLOTS.mouths);
    const eyes = n % SLOTS.eyes;

    const EYES_COUNT = 6, MOUTHS_COUNT = 6, HATS_COUNT = 24, BODIES_COUNT = 7, LEGS_COUNT = 8;
    return {
      eyes: eyes % EYES_COUNT,
      mouth: mouth % MOUTHS_COUNT,
      hat: hat % HATS_COUNT,
      body: body % BODIES_COUNT,
      legs: legs % LEGS_COUNT,
      faceHue: faceHue,
      hatHue: hatHue,
    };
  }

  // Encode specific traits into DNA
  function encodeDNA(traits) {
    let n = traits.hatHue;
    n += traits.faceHue * SLOTS.hues;
    n += traits.legs * SLOTS.hues * SLOTS.hues;
    n += traits.body * SLOTS.legs * SLOTS.hues * SLOTS.hues;
    n += traits.hat * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
    n += traits.mouth * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
    n += traits.eyes * SLOTS.mouths * SLOTS.hats * SLOTS.bodies * SLOTS.legs * SLOTS.hues * SLOTS.hues;
    return n.toString(16).padStart(6, '0');
  }

  // Generate DNA for each leg variant (same base traits, varying legs)
  function legVariantDNA(legIndex) {
    return encodeDNA({
      eyes: 0, mouth: 0, hat: 0, body: 0,
      legs: legIndex, faceHue: 4, hatHue: 8,
    });
  }

  // Random grid
  const randomAvatars = Array.from({ length: 60 }, () => randomDNA());

  // All 8 leg variants
  const legDNAs = Array.from({ length: 8 }, (_, i) => legVariantDNA(i));

  function traitSummary(dna) {
    const t = decodeDNA(dna);
    return `eyes:${EYES_NAMES[t.eyes]} mouth:${MOUTHS_NAMES[t.mouth]} hat:${HATS_NAMES[t.hat]} body:${BODIES_NAMES[t.body]} legs:${LEGS_NAMES[t.legs]} hue:${t.faceHue * 30}/${t.hatHue * 30}`;
  }
</script>

<svelte:head>
  <title>Avatar Test | touchgrass.sh</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="test-page">
  <h1 class="section-title">Avatar Test Page</h1>
  <p class="section-desc">Visual QA for the agent DNA avatar system. {TOTAL.toLocaleString()} possible combinations.</p>

  <!-- Idle (default) -->
  <section>
    <h2 class="section-title">Idle (default)</h2>
    <p class="section-desc">Subtle leg bounce animation. Even/odd pixels staggered for weight-shifting effect.</p>
    <div class="avatar-grid">
      {#each randomAvatars.slice(0, 20) as dna}
        <div class="avatar-card">
          <AgentFace {dna} size="lg" />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Walking -->
  <section>
    <h2 class="section-title">Walking</h2>
    <p class="section-desc">Active walk cycle toggling between leg frames.</p>
    <div class="avatar-grid">
      {#each randomAvatars.slice(20, 40) as dna}
        <div class="avatar-card">
          <AgentFace {dna} size="lg" walking />
          <code class="dna-label">{dna}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Sizes -->
  <section>
    <h2 class="section-title">Sizes</h2>
    <div class="size-row">
      <div class="avatar-card">
        <AgentFace dna={randomAvatars[0]} size="sm" />
        <code class="dna-label">sm</code>
      </div>
      <div class="avatar-card">
        <AgentFace dna={randomAvatars[0]} size="lg" />
        <code class="dna-label">lg</code>
      </div>
      <div class="avatar-card">
        <AgentFace dna={randomAvatars[0]} size="xl" />
        <code class="dna-label">xl</code>
      </div>
    </div>
  </section>

  <!-- All Leg Variants -->
  <section>
    <h2 class="section-title">All 8 Leg Variants</h2>
    <div class="avatar-grid">
      {#each legDNAs as dna, i}
        <div class="avatar-card">
          <AgentFace {dna} size="lg" />
          <code class="dna-label">{LEGS_NAMES[i]}</code>
        </div>
      {/each}
    </div>
    <h3 class="section-subtitle">Walking</h3>
    <div class="avatar-grid">
      {#each legDNAs as dna, i}
        <div class="avatar-card">
          <AgentFace {dna} size="lg" walking />
          <code class="dna-label">{LEGS_NAMES[i]}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Trait Details -->
  <section>
    <h2 class="section-title">Trait Details</h2>
    <p class="section-desc">Full decoded traits for each avatar.</p>
    <div class="avatar-grid detail-grid">
      {#each randomAvatars.slice(40, 60) as dna}
        <div class="avatar-detail-card">
          <AgentFace {dna} size="lg" />
          <div class="detail-text">
            <code class="dna-label">{dna}</code>
            <span class="trait-line">{traitSummary(dna)}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- XL Showcase -->
  <section>
    <h2 class="section-title">XL Showcase</h2>
    <div class="xl-row">
      {#each randomAvatars.slice(0, 6) as dna}
        <div class="avatar-card">
          <AgentFace {dna} size="xl" />
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

  .detail-grid {
    flex-direction: column;
    gap: 0.5rem;
  }

  .avatar-detail-card {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .detail-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .trait-line {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: rgba(209, 250, 229, 0.4);
    word-break: break-all;
  }
</style>
