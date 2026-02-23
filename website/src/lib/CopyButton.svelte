<script>
  let { command } = $props();
  let label = $state('Copy');

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      label = 'Copied';
      setTimeout(() => (label = 'Copy'), 1300);
    } catch {
      label = 'Failed';
      setTimeout(() => (label = 'Copy'), 1300);
    }
  }
</script>

<button class="btn-ghost" onclick={copy}>{label}</button>
