<script lang="ts">
  type Props = { label: string; checked: boolean; hint?: string };
  let { label, checked = $bindable(), hint }: Props = $props();
</script>

<button class="switch" type="button" role="switch" aria-checked={checked} onclick={() => (checked = !checked)}>
  <span class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
  <span class="track" class:on={checked}><span class="thumb"></span></span>
</button>

<style>
  .switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: max(32px, var(--hit));
    padding: 0;
    text-align: left;
    background: none;
    border: 0;
  }
  .text {
    display: grid;
  }
  .label {
    color: var(--text-2);
  }
  .hint {
    font-size: 12px;
    line-height: 16px;
    color: var(--muted);
  }
  .track {
    flex: none;
    width: 32px;
    height: 20px;
    padding: 2px;
    border-radius: 10px;
    background: var(--hair-strong);
    transition: background-color var(--t-fast) var(--ease);
  }
  .track.on {
    background: var(--primary);
  }
  .thumb {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--surface);
    transition: transform var(--t-fast) var(--ease);
  }
  .on .thumb {
    transform: translateX(12px);
  }
</style>
