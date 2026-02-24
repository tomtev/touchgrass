<script lang="ts">
  import { Avatar } from 'termlings/svelte';

  interface Props {
    name?: string;
    size?: 'sm' | 'lg' | 'xl';
    dna?: string;
    animated?: boolean;
    walking?: boolean;
    talking?: boolean;
    waving?: boolean;
  }

  let { name, size = 'lg', dna, animated = false, walking = false, talking = false, waving = false }: Props = $props();
</script>

<Avatar {dna} {name} {size} {walking} {talking} {waving} />
