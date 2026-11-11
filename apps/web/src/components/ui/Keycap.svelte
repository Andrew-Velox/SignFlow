<script lang="ts">
  let { keys }: { keys: string[] } = $props();
</script>

<span class="keys">
  {#each keys as k (k)}<kbd>{k}</kbd>{/each}
</span>

<style>
  .keys {
    display: inline-flex;
    gap: 2px;
  }
  kbd {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    display: inline-grid;
    place-items: center;
    font: 400 11px/1 var(--mono);
    color: var(--text-2);
    background: var(--raised);
    border: 1px solid var(--hair-strong);
    border-bottom-width: 2px;
    border-radius: var(--r-key);
  }
</style>
