<script lang="ts">
  import type { Component } from 'svelte';
  import Keycap from './Keycap.svelte';

  type Props = {
    label: string;
    icon: Component<{ size?: number; strokeWidth?: number }>;
    onclick: () => void;
    keys?: string[];
    active?: boolean;
    disabled?: boolean;
    /** Where the tooltip opens. */
    tip?: 'top' | 'bottom';
  };
  let { label, icon: Icon, onclick, keys, active, disabled, tip = 'top' }: Props = $props();
</script>

<span class="wrap">
  <button class="btn" class:active type="button" aria-label={label} aria-pressed={active} {disabled} {onclick}>
    <Icon size={18} strokeWidth={1.5} />
  </button>
  <span class="tip {tip}" role="tooltip" aria-hidden="true">
    {label}
    {#if keys}<Keycap {keys} />{/if}
  </span>
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .btn {
    width: var(--hit);
    height: var(--hit);
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--text-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-control);
    transition:
      color var(--t-fast) var(--ease),
      background-color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }
  .btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--raised);
  }
  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .btn.active {
    color: var(--text);
    background: var(--raised);
    border-color: var(--hair-strong);
  }
  .btn:disabled {
    color: var(--muted);
    opacity: 0.45;
    cursor: default;
  }
  .tip {
    position: absolute;
    left: 50%;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    white-space: nowrap;
    font-size: 12px;
    line-height: 16px;
    color: var(--on-primary);
    background: var(--primary);
    border-radius: 6px;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--t-pop) var(--ease),
      transform var(--t-pop) var(--ease);
  }
  .tip.top {
    bottom: calc(100% + 8px);
    transform: translate(-50%, 4px);
  }
  .tip.bottom {
    top: calc(100% + 8px);
    transform: translate(-50%, -4px);
  }
  .wrap:hover .tip,
  .wrap:has(.btn:focus-visible) .tip {
    opacity: 1;
    transform: translate(-50%, 0);
    transition-delay: 350ms;
  }
  .btn:disabled ~ .tip {
    display: none;
  }
  /* Keycaps inside the tooltip sit on the dark chip. */
  .tip :global(kbd) {
    color: var(--on-primary);
    background: transparent;
    border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  }
  @media (hover: none) {
    .tip {
      display: none;
    }
  }
</style>
