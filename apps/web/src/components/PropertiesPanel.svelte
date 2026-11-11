<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Slider from './ui/Slider.svelte';
  import Switch from './ui/Switch.svelte';
  import { editor } from '../stores/editor.svelte';

  const presets = $derived([
    { name: 'Default ink', value: editor.defaultInk },
    { name: 'Navy', value: '#1e3a8a' },
    { name: 'Blue', value: '#2563eb' },
    { name: 'Burgundy', value: '#7f1d1d' },
    { name: 'Forest', value: '#14532d' },
  ]);
  const isPreset = $derived(presets.some((p) => p.value.toLowerCase() === editor.ink.toLowerCase()));

  const samples = $derived(editor.strokes.reduce((n, s) => n + s.points.length, 0));
  const segments = $derived(editor.processed.reduce((n, s) => n + s.segments.length, 0));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<aside class="panel" aria-label="Pen settings" in:fly|global={{ x: 12, duration: 300, easing: cubicOut }} out:fly|global={{ x: 12, duration: 160, easing: cubicOut }}>
  <header>
    <h2>Pen</h2>
    <button class="reset" type="button" onclick={() => editor.resetPen()}><RotateCcw size={14} strokeWidth={1.5} /> Reset</button>
  </header>

  <section>
    <h3>Ink</h3>
    <div class="swatches" role="radiogroup" aria-label="Ink colour">
      {#each presets as p (p.name)}
        {@const on = p.value.toLowerCase() === editor.ink.toLowerCase()}
        <button class="swatch" class:on type="button" role="radio" aria-checked={on} aria-label={p.name} title={p.name} style="--c:{p.value}" onclick={() => editor.setInk(p.value)}></button>
      {/each}
      <label class="swatch custom" class:on={!isPreset} title="Custom colour" style="--c:{editor.ink}">
        <span class="sr-only">Custom ink colour</span>
        <input type="color" value={editor.ink} oninput={(e) => editor.setInk(e.currentTarget.value)} />
      </label>
    </div>
    <Slider label="Width" bind:value={editor.width} min={1} max={14} step={0.1} format={(v) => `${v.toFixed(1)} px`} />
  </section>

  <section>
    <h3>Smoothing</h3>
    <Slider label="Amount" bind:value={editor.smoothing} min={0} max={1} step={0.01} format={pct} />
  </section>

  <section>
    <h3>Stroke shape</h3>
    <Switch label="Variable width" hint="Taper and thin with speed, like ink" bind:checked={editor.variable} />
    <Slider label="Speed thinning" bind:value={editor.velocity} min={0} max={1} step={0.01} format={pct} disabled={!editor.variable} />
    <Slider label="Pressure" bind:value={editor.pressure} min={0} max={1} step={0.01} format={pct} disabled={!editor.variable} />
    <Slider label="Taper" bind:value={editor.taper} min={0} max={1} step={0.01} format={pct} disabled={!editor.variable} />
  </section>

  <details>
    <summary><span>Advanced</span><ChevronDown size={14} strokeWidth={1.5} /></summary>
    <div class="adv">
      <Switch label="Refine on release" hint="Sharper corners, but ink shifts when you lift" bind:checked={editor.refine} />
      <Switch label="Show raw samples" bind:checked={editor.showRaw} />
      <Switch label="Show Bézier knots" bind:checked={editor.showFit} />
      <p class="stats mono">{editor.strokes.length} strokes · {samples} samples · {segments} segments · live {editor.stats.previewMs.toFixed(1)} ms</p>
    </div>
  </details>
</aside>

<style>
  .panel {
    position: fixed;
    top: calc(var(--edge-t) + 64px);
    right: var(--edge-r);
    bottom: calc(var(--edge-b) + 64px);
    z-index: 15;
    width: 280px;
    overflow-y: auto;
    padding: 16px;
    display: grid;
    align-content: start;
    gap: 24px;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow-float);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 400;
    color: var(--muted);
  }
  section {
    display: grid;
    gap: 16px;
  }
  section h3 {
    margin-bottom: -4px;
  }
  .reset {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: max(28px, var(--hit));
    padding: 0 8px;
    font-size: 13px;
    color: var(--text-2);
    background: transparent;
    border: 0;
    border-radius: var(--r-control);
    transition: color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
  }
  .reset:hover {
    color: var(--text);
    background: var(--raised);
  }

  .swatches {
    display: flex;
    gap: 8px;
  }
  .swatch {
    position: relative;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    background: var(--c);
    border: 1px solid var(--hair-strong);
    transition: transform var(--t-fast) var(--ease);
  }
  .swatch:active {
    transform: scale(0.97);
  }
  @media (pointer: coarse) {
    .swatches {
      gap: 12px;
    }
    .swatch {
      width: 36px;
      height: 36px;
    }
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text);
  }
  .custom {
    overflow: hidden;
    cursor: pointer;
  }
  .custom input {
    position: absolute;
    inset: -8px;
    width: 48px;
    height: 48px;
    opacity: 0;
    cursor: pointer;
  }
  .custom:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  details {
    border-top: 1px solid var(--hair);
    padding-top: 12px;
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: max(28px, var(--hit));
    color: var(--text-2);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(svg) {
    transition: transform var(--t-fast) var(--ease);
  }
  details[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .adv {
    display: grid;
    gap: 4px;
    padding-top: 8px;
  }
  .stats {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 16px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .panel {
      top: auto;
      left: var(--edge-l);
      right: var(--edge-r);
      bottom: calc(var(--edge-b) + 64px);
      width: auto;
      max-height: 52vh;
      max-height: 52dvh;
    }
  }
</style>
