<script>
  import { decodeDNA, generateGrid } from '@touchgrass/avatar';

  let { dna, size = 'lg', walking = false, talking = false, waving = false } = $props();

  let walkFrame = $state(0);
  let talkFrame = $state(0);
  let waveFrame = $state(0);

  $effect(() => {
    if (!walking) { walkFrame = 0; return; }
    const id = setInterval(() => { walkFrame = (walkFrame + 1) % 6; }, 400);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!talking) { talkFrame = 0; return; }
    let timeout;
    function tick() {
      talkFrame = (talkFrame + 1) % 2;
      timeout = setTimeout(tick, 100 + Math.random() * 200);
    }
    timeout = setTimeout(tick, 100 + Math.random() * 200);
    return () => clearTimeout(timeout);
  });

  $effect(() => {
    if (!waving) { waveFrame = 0; return; }
    waveFrame = 1;
    const id = setInterval(() => { waveFrame = waveFrame === 1 ? 2 : 1; }, 600);
    return () => clearInterval(id);
  });

  const traits = $derived(decodeDNA(dna));
  const grid   = $derived(generateGrid(traits, walkFrame, talkFrame, waveFrame));

  const hue       = $derived(traits.faceHue * 30);
  const hatHueDeg = $derived(traits.hatHue * 30);
  const faceColor = $derived(`hsl(${hue}, 50%, 50%)`);
  const darkColor = $derived(`hsl(${hue}, 50%, 28%)`);
  const hatColor  = $derived(`hsl(${hatHueDeg}, 50%, 50%)`);

  const pxSize = $derived(size === 'xl' ? 14 : size === 'sm' ? 5 : 8);
  const idleDelay = Math.random() * 3;

  function pixelColor(type) {
    if (type === 'e' || type === 'd') return darkColor;
    if (type === 'f' || type === 'q' || type === 'r') return faceColor;
    if (type === 'h' || type === 'k') return hatColor;
    if (type === 'm' || type === 's' || type === 'n') return faceColor; // bg is face, dark part via CSS
    if (type === 'l' || type === 'a') return 'transparent'; // drawn via CSS pseudo-element
    return 'transparent';
  }
</script>

<div class="avatar">
  <div class="grid" class:idle={!walking} style:--px="{pxSize}px" style:--idle-delay="{idleDelay}s">
    {#each grid as row}
      {#each row as cell}
        <span
          class="px"
          class:squint-eye={cell === 's'}
          class:narrow-eye={cell === 'n'}
          class:mouth={cell === 'm'}
          class:corner-l={cell === 'q'}
          class:corner-r={cell === 'r'}
          class:thin-leg={cell === 'l'}
          class:thin-arm={cell === 'a'}
          style:background={pixelColor(cell)}
          style:--dark={cell === 'm' || cell === 'q' || cell === 'r' || cell === 's' || cell === 'n' ? darkColor : undefined}
          style:--face={cell === 'l' || cell === 'a' ? faceColor : undefined}
        ></span>
      {/each}
    {/each}
  </div>
</div>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(9, var(--px));
    grid-auto-rows: var(--px);
    user-select: none;
  }

  .px {
    width: var(--px);
    height: var(--px);
    display: block;
  }

  /* Squint eye: dark bottom half */
  .squint-eye {
    position: relative;
    overflow: hidden;
  }
  .squint-eye::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--dark);
  }

  /* Narrow eye: dark center vertical strip */
  .narrow-eye {
    position: relative;
    overflow: hidden;
  }
  .narrow-eye::after {
    content: '';
    position: absolute;
    top: 0;
    left: 25%;
    width: 50%;
    height: 100%;
    background: var(--dark);
  }

  /* Thin mouth: dark top half */
  .mouth {
    position: relative;
    overflow: hidden;
  }
  .mouth::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--dark);
  }

  /* Smile corner left (▗): dark bottom-right quarter */
  .corner-l {
    position: relative;
    overflow: hidden;
  }
  .corner-l::after {
    content: '';
    position: absolute;
    bottom: 0;
    right: 0;
    width: 50%;
    height: 50%;
    background: var(--dark);
  }

  /* Smile corner right (▖): dark bottom-left quarter */
  .corner-r {
    position: relative;
    overflow: hidden;
  }
  .corner-r::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 50%;
    height: 50%;
    background: var(--dark);
  }

  /* Thin arm: face color bottom half only (▄) */
  .thin-arm {
    position: relative;
    overflow: hidden;
  }
  .thin-arm::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
    background: var(--face);
  }

  /* Thin leg: face color left half only (▌) */
  .thin-leg {
    position: relative;
    overflow: hidden;
  }
  .thin-leg::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 50%;
    height: 100%;
    background: var(--face);
  }

  @keyframes idle-bob {
    0%, 30%, 100% { transform: translateY(0); }
    35%, 65% { transform: translateY(1px); }
  }

  .grid.idle > :not(:nth-last-child(-n+9)) {
    animation: idle-bob 3s steps(1) infinite;
    animation-delay: var(--idle-delay, 0s);
  }
</style>
