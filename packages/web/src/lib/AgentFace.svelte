<script>
  import { Avatar } from '@touchgrass/avatar/svelte';

  let { dna, size = 'lg', walking = false, talking = false, waving = false } = $props();
</script>

<Avatar {dna} {size} {walking} {talking} {waving} />
