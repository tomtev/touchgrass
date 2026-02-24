<script lang="ts">
  import { commandIcon } from './icons';

  interface Props {
    command: string;
    size?: number;
  }

  let { command, size = 16 }: Props = $props();

  const icon = $derived(commandIcon(command));
</script>

<span class="tool-icon" style:width="{size}px" style:height="{size}px">
  {@html icon}
</span>

<style>
  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tool-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
