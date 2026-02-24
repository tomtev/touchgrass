<script lang="ts">
  import { encodeDNA, traitsFromName, renderLayeredSVG, getAvatarCSS } from '../index.js';

  interface Props {
    dna?: string;
    name?: string;
    size?: 'sm' | 'lg' | 'xl';
    walking?: boolean;
    talking?: boolean;
    waving?: boolean;
  }

  let { dna, name, size = 'lg', walking = false, talking = false, waving = false }: Props = $props();

  const resolvedDna = $derived(dna ?? encodeDNA(traitsFromName(name ?? 'agent')));
  const rendered = $derived(renderLayeredSVG(resolvedDna, size === 'xl' ? 14 : size === 'sm' ? 3 : 8));
  const idle = $derived(!walking && !talking && !waving);
  const idleDelay = Math.random() * 3;
</script>

<svelte:head>{@html `<style>${getAvatarCSS()}</style>`}</svelte:head>

<div
  class="tg-avatar"
  class:idle
  class:walking
  class:talking
  class:waving
  class:walk-3f={rendered.legFrames === 3}
  class:walk-4f={rendered.legFrames === 4}
  class:sm={size === 'sm'}
  style:--tg-idle-delay="{idleDelay}s"
>
  {@html rendered.svg}
</div>

<style>
  .tg-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tg-avatar.sm {
    width: 27px;
    height: 27px;
    overflow: hidden;
  }
  .tg-avatar.sm :global(svg) {
    width: 27px;
    height: 27px;
  }
</style>
