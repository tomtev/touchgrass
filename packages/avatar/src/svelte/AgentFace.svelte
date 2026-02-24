<script lang="ts">
  import { decodeDNA, generateGrid, traitsFromName } from '../index.js';
  import type { Pixel } from '../index.js';

  interface Props {
    dna?: string;
    name?: string;
    size?: 'sm' | 'lg' | 'xl';
    walking?: boolean;
    talking?: boolean;
    waving?: boolean;
  }

  let { dna, name, size = 'lg', walking = false, talking = false, waving = false }: Props = $props();

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
    let timeout: ReturnType<typeof setTimeout>;
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

  const traits = $derived(
    dna ? decodeDNA(dna) : traitsFromName(name ?? 'agent')
  );
  const grid   = $derived(generateGrid(traits, walkFrame, talkFrame, waveFrame));
  const rows   = $derived(grid.length);

  const hue       = $derived(traits.faceHue * 30);
  const hatHueDeg = $derived(traits.hatHue * 30);
  const faceColor = $derived(`hsl(${hue}, 50%, 50%)`);
  const darkColor = $derived(`hsl(${hue}, 50%, 28%)`);
  const hatColor  = $derived(`hsl(${hatHueDeg}, 50%, 50%)`);

  const xlPx = 14;
  const lgPx = 8;
  const smPx = 3;
  const smScale = $derived(27 / Math.max(9 * smPx, rows * smPx));
  const pxSize = $derived(size === 'xl' ? xlPx : size === 'sm' ? smPx : lgPx);
  const idleDelay = Math.random() * 3;

  function pixelColor(type: Pixel): string {
    if (type === 'e' || type === 'd') return darkColor;
    if (type === 'f' || type === 'q' || type === 'r') return faceColor;
    if (type === 'h' || type === 'k') return hatColor;
    if (type === 'm' || type === 's' || type === 'n') return faceColor;
    if (type === 'l' || type === 'a') return 'transparent';
    return 'transparent';
  }
</script>

<div
  class="avatar"
  class:sm={size === 'sm'}
>
  <div
    class="grid"
    class:idle={!walking && !talking}
    style:--px="{pxSize}px"
    style:--idle-delay="{idleDelay}s"
    style:transform={size === 'sm' && smScale < 1 ? `scale(${smScale})` : undefined}
  >
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

  .avatar.sm {
    width: 27px;
    height: 27px;
    overflow: hidden;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(9, var(--px));
    grid-auto-rows: var(--px);
    user-select: none;
    transform-origin: center;
  }

  .px {
    width: var(--px);
    height: var(--px);
    display: block;
  }

  .avatar.sm .px {
    width: calc(var(--px) + 1px);
    height: calc(var(--px) + 1px);
  }

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
