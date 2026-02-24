<script>
  import { AgentFace } from '@touchgrass/avatar/svelte';

  let { dna, size = 'lg', walking = false, talking = false, waving = false } = $props();
</script>

<AgentFace {dna} {size} {walking} {talking} {waving} />
