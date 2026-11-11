<script lang="ts">
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import GithubIcon from './ui/GithubIcon.svelte';
  import IconButton from './ui/IconButton.svelte';
  import Keycap from './ui/Keycap.svelte';
  import { REPO_URL, editor } from '../stores/editor.svelte';
</script>

<header class="top">
  <div class="pill brand">
    <svg class="mark" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 16c2.6-7.4 5.2-9 5.2-5.2 0 2.8-2.2 5.2 0 5.2 2.6 0 4.2-8 6.3-8 1.8 0 1.2 3.6 3 3.6 1 0 1.8-.8 2.5-1.8" />
    </svg>
    <span class="name">SignFlow</span>
    <span class="tag">Handwriting to animated SVG</span>
  </div>

  <div class="pill actions">
    {#if REPO_URL}
      <IconButton label="GitHub repository" icon={GithubIcon} href={REPO_URL} tip="bottom" />
    {/if}
    <IconButton
      label={editor.theme === 'dark' ? 'Light theme' : 'Dark theme'}
      icon={editor.theme === 'dark' ? Sun : Moon}
      onclick={() => editor.toggleTheme()}
      tip="bottom"
    />
    <button class="export" type="button" onclick={() => (editor.exportOpen = true)}>
      Export
      <Keycap keys={['E']} />
    </button>
  </div>
</header>

<style>
  .top {
    position: fixed;
    top: var(--edge-t);
    left: var(--edge-l);
    right: var(--edge-r);
    z-index: 20;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    pointer-events: none; /* only the pills catch the pointer; the canvas stays drawable around them */
  }
  .pill {
    pointer-events: auto;
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 8px;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow-float);
  }
  .brand {
    gap: 8px;
    padding: 0 16px 0 12px;
  }
  .mark {
    color: var(--text);
  }
  .name {
    font-size: 16px;
    line-height: 20px;
    font-weight: 500;
  }
  .tag {
    padding-left: 12px;
    margin-left: 4px;
    border-left: 1px solid var(--hair-strong);
    font-size: 13px;
    color: var(--muted);
  }
  .actions {
    gap: 4px;
  }
  .export {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--hit);
    margin-left: 4px;
    padding: 0 8px 0 12px;
    font-weight: 500;
    color: var(--on-primary);
    background: var(--primary);
    border: 0;
    border-radius: var(--r-control);
    transition: transform var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease);
  }
  .export:hover {
    opacity: 0.88;
  }
  .export:active {
    transform: scale(0.97);
  }
  .export :global(kbd) {
    color: var(--on-primary);
    background: transparent;
    border-color: color-mix(in srgb, var(--on-primary) 35%, transparent);
  }
  /* Keep the right-hand group (theme, export) fully on screen: it never shrinks, the brand gives way first. */
  .actions {
    flex: none;
  }
  .brand {
    min-width: 0;
  }
  @media (max-width: 480px) {
    .name {
      display: none;
    }
    .brand {
      padding: 0 12px;
    }
  }
  @media (max-width: 720px) {
    .tag,
    .export :global(.keys) {
      display: none;
    }
    .export {
      padding: 0 12px;
    }
  }
</style>
