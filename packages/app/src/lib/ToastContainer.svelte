<script lang="ts">
  import { toasts, dismissToast } from './stores/toasts';
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <output class="toast" data-variant={toast.variant ?? undefined}>
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div class="toast-body" onclick={() => dismissToast(toast.id)}>
          {#if toast.title}
            <h6 class="toast-title">{toast.title}</h6>
          {/if}
          <div class="toast-message">
            {#if toast.icon}
              <span class="toast-icon">{@html toast.icon}</span>
            {/if}
            <p>{toast.message}</p>
          </div>
        </div>
      </output>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2000;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    animation: toast-in 0.2s ease-out;
    cursor: pointer;
    max-width: 320px;
  }

  .toast-message {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .toast-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .toast-body p {
    margin: 0;
    font-size: 13px;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
