<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import { buildAnimatedSvg, buildStaticSvg } from '@signflow/svg';
  import Slider from './ui/Slider.svelte';
  import Switch from './ui/Switch.svelte';
  import Keycap from './ui/Keycap.svelte';
  import { editor } from '../stores/editor.svelte';
  import { downloadBlob, svgToBlob, svgToPngBlob } from '../export';

  let closeBtn: HTMLButtonElement;
  let replayKey = $state(0);
  let paused = $state(false);
  let exporting = $state(false);
  let error = $state('');

  const hasInk = $derived(editor.processed.some((s) => s.segments.length));
  const shared = $derived({
    strokes: editor.processed,
    width: editor.canvas.width,
    height: editor.canvas.height,
    strokeWidth: editor.width,
    color: editor.ink,
    variableWidth: editor.variable,
    crop: editor.crop,
    padding: editor.padding,
    rotation: editor.rotation,
  });
  const staticSvg = $derived(hasInk ? buildStaticSvg({ ...shared, title: 'Signature' }) : null);
  const animatedSvg = $derived(
    hasInk
      ? buildAnimatedSvg({
          ...shared,
          title: 'Signature, animated',
          duration: editor.animDuration * 1000,
          strokeDelay: editor.animStrokeDelay * 1000,
          easing: editor.animEasing,
          loop: editor.animLoop,
        })
      : null,
  );
  const staticSrc = $derived(staticSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(staticSvg.svg)}` : '');
  const seconds = $derived(animatedSvg ? animatedSvg.timeline.ends[animatedSvg.timeline.ends.length - 1] / 1000 : 0);
  const kb = (s: string) => (new Blob([s]).size / 1024).toFixed(1);

  /** Adds a quarter turn (or any step) and keeps the angle in -180..180. */
  function turn(by: number) {
    editor.rotation = ((((editor.rotation + by + 180) % 360) + 360) % 360) - 180;
  }

  function replay() {
    paused = false;
    replayKey++;
  }
  function downloadAnimated() {
    if (animatedSvg) downloadBlob(svgToBlob(animatedSvg.svg), 'signature-animated.svg');
  }
  function downloadStatic() {
    if (staticSvg) downloadBlob(svgToBlob(staticSvg.svg), 'signature.svg');
  }
  async function downloadPng() {
    if (!staticSvg) return;
    error = '';
    exporting = true;
    try {
      const { blob } = await svgToPngBlob(staticSvg.svg, staticSvg.width, staticSvg.height, editor.pngScale);
      downloadBlob(blob, 'signature.png');
    } catch (e) {
      error = e instanceof Error ? e.message : 'PNG export failed';
    } finally {
      exporting = false;
    }
  }

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.focus();
    return () => previous?.focus?.();
  });
</script>

<div class="scrim" role="presentation" onpointerdown={() => (editor.exportOpen = false)}></div>

<div class="drawer" role="dialog" aria-labelledby="export-title" in:fly|global={{ x: 16, duration: 300, easing: cubicOut }} out:fly|global={{ x: 16, duration: 160, easing: cubicOut }}>
  <header>
    <h2 id="export-title">Export</h2>
    <button bind:this={closeBtn} class="close" type="button" aria-label="Close export" onclick={() => (editor.exportOpen = false)}>
      <X size={18} strokeWidth={1.5} />
    </button>
  </header>

  <div class="body">
    <div class="tools">
      <div class="seg" role="group" aria-label="Preview type">
        <button type="button" class:on={editor.previewMode === 'animated'} aria-pressed={editor.previewMode === 'animated'} onclick={() => (editor.previewMode = 'animated')}>Animated</button>
        <button type="button" class:on={editor.previewMode === 'static'} aria-pressed={editor.previewMode === 'static'} onclick={() => (editor.previewMode = 'static')}>Static</button>
      </div>
      <select bind:value={editor.previewBg} aria-label="Preview background">
        <option value="checker">Transparent</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>

    <div class="preview bg-{editor.previewBg}" class:paused>
      {#if !hasInk}
        <p class="empty">Draw something to preview it</p>
      {:else if editor.previewMode === 'static' && staticSvg}
        <img src={staticSrc} alt="Static signature preview" />
      {:else if animatedSvg}
        <!-- The markup comes from our own generator, which sanitises colours, titles and easing. -->
        {#key `${replayKey}:${animatedSvg.svg}`}
          <div class="inline-svg">{@html animatedSvg.svg}</div>
        {/key}
      {/if}
    </div>

    {#if hasInk && editor.previewMode === 'animated'}
      <div class="player">
        <button type="button" class="ghost" onclick={replay}><RotateCcw size={14} strokeWidth={1.5} /> Replay</button>
        <button type="button" class="ghost" onclick={() => (paused = !paused)}>
          {#if paused}<Play size={14} strokeWidth={1.5} /> Resume{:else}<Pause size={14} strokeWidth={1.5} /> Pause{/if}
        </button>
        <span class="mono">{seconds.toFixed(1)} s</span>
      </div>
    {/if}

    <section>
      <h3>Rotate</h3>
      <Slider label="Angle" bind:value={editor.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} />
      <div class="turns">
        <button type="button" class="ghost" aria-label="Rotate 90 degrees counter-clockwise" onclick={() => turn(-90)}>
          <RotateCcw size={14} strokeWidth={1.5} /> 90°
        </button>
        <button type="button" class="ghost" aria-label="Rotate 90 degrees clockwise" onclick={() => turn(90)}>
          <RotateCw size={14} strokeWidth={1.5} /> 90°
        </button>
        <button type="button" class="ghost" onclick={() => (editor.rotation = 0)} disabled={editor.rotation === 0}>Reset</button>
      </div>
    </section>

    <section>
      <h3>Frame</h3>
      <Switch label="Crop to signature" bind:checked={editor.crop} />
      {#if editor.crop}
        <Slider label="Padding" bind:value={editor.padding} min={0} max={60} step={1} format={(v) => `${v} px`} />
      {/if}
    </section>

    <section>
      <h3>Animation</h3>
      <Slider label="Drawing time" bind:value={editor.animDuration} min={0.5} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`} />
      <Slider label="Delay between strokes" bind:value={editor.animStrokeDelay} min={0} max={2} step={0.05} format={(v) => `${v.toFixed(2)} s`} />
      <label class="field">
        <span>Easing</span>
        <select bind:value={editor.animEasing}>
          <option value="ease-in-out">Ease in-out</option>
          <option value="linear">Linear</option>
          <option value="ease-out">Ease out</option>
          <option value="ease-in">Ease in</option>
        </select>
      </label>
      <Switch label="Loop" bind:checked={editor.animLoop} />
    </section>
  </div>

  <footer>
    {#if hasInk && staticSvg && animatedSvg}
      <p class="note mono">
        Animated {kb(animatedSvg.svg)} KB · static {kb(staticSvg.svg)} KB · {Math.round(staticSvg.width)}×{Math.round(staticSvg.height)} · transparent
      </p>
    {/if}
    {#if error}<p class="note err" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="primary" onclick={downloadAnimated} disabled={!hasInk}>Animated SVG</button>
      <button type="button" class="secondary" onclick={downloadStatic} disabled={!hasInk}>Static SVG</button>
      <button type="button" class="secondary" onclick={downloadPng} disabled={!hasInk || exporting}>{exporting ? 'Rendering…' : 'PNG'}</button>
    </div>
    <label class="field png">
      <span>PNG scale</span>
      <select bind:value={editor.pngScale}>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={3}>3×</option>
        <option value={4}>4×</option>
      </select>
    </label>
    <p class="esc"><Keycap keys={['Esc']} /> to close</p>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .drawer {
    position: fixed;
    z-index: 31;
    top: var(--edge-t);
    right: var(--edge-r);
    bottom: var(--edge-b);
    width: 400px;
    max-width: calc(100vw - var(--edge-l) - var(--edge-r));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 12px 16px;
    border-bottom: 1px solid var(--hair);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 20px;
    font-weight: 500;
  }
  .close {
    width: max(32px, var(--hit));
    height: max(32px, var(--hit));
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--text-2);
    background: transparent;
    border: 0;
    border-radius: var(--r-control);
    transition: color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
  }
  .close:hover {
    color: var(--text);
    background: var(--raised);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: grid;
    align-content: start;
    gap: 16px;
  }
  .tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .seg {
    display: flex;
    padding: 2px;
    background: var(--raised);
    border-radius: var(--r-control);
  }
  .seg button {
    height: max(28px, calc(var(--hit) - 8px));
    padding: 0 12px;
    color: var(--text-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    transition: color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
  }
  .seg button.on {
    color: var(--text);
    background: var(--surface);
    border-color: var(--hair);
    box-shadow: var(--shadow-sm);
  }
  select {
    height: max(32px, var(--hit));
    padding: 0 8px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--hair-strong);
    border-radius: var(--r-control);
  }

  .preview {
    min-height: 200px;
    display: grid;
    place-items: center;
    padding: 16px;
    border: 1px solid var(--hair);
    border-radius: var(--r-control);
    overflow: hidden;
  }
  .bg-checker {
    background-color: #ffffff;
    background-image:
      linear-gradient(45deg, #ebebeb 25%, transparent 25%, transparent 75%, #ebebeb 75%),
      linear-gradient(45deg, #ebebeb 25%, transparent 25%, transparent 75%, #ebebeb 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .bg-light {
    background: #ffffff;
  }
  .bg-dark {
    background: #161618;
  }
  .preview img,
  .preview :global(svg) {
    display: block;
    max-width: 100%;
    max-height: 240px;
    height: auto;
  }
  .preview img {
    width: auto;
  }
  .preview.paused :global(svg *) {
    animation-play-state: paused !important;
  }
  .empty {
    margin: 0;
    padding: 2px 8px;
    color: #525252;
    background: #ffffff;
    border-radius: 6px;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: -8px;
  }
  .player .mono {
    margin-left: auto;
    font-size: 12px;
    color: var(--muted);
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: max(28px, var(--hit));
    padding: 0 8px;
    color: var(--text-2);
    background: transparent;
    border: 0;
    border-radius: var(--r-control);
    transition: color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
  }
  .turns {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .ghost:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--raised);
  }

  section {
    display: grid;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--hair);
  }
  h3 {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    font-weight: 400;
    color: var(--muted);
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--text-2);
  }

  footer {
    flex: none;
    display: grid;
    gap: 12px;
    padding: 16px;
    border-top: 1px solid var(--hair);
  }
  .note {
    margin: 0;
    font-size: 12px;
    line-height: 16px;
    color: var(--muted);
  }
  .note.err {
    color: var(--danger);
  }
  .actions {
    display: grid;
    grid-template-columns: 1.4fr 1fr 0.8fr;
    gap: 8px;
  }
  .actions button {
    height: var(--hit);
    padding: 0 8px;
    font-weight: 500;
    border-radius: var(--r-control);
    transition: opacity var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
  }
  .actions button:active:not(:disabled) {
    transform: scale(0.97);
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    color: var(--on-primary);
    background: var(--primary);
    border: 0;
  }
  .primary:hover:not(:disabled) {
    opacity: 0.88;
  }
  .secondary {
    color: var(--text);
    background: var(--raised);
    border: 1px solid var(--hair-strong);
  }
  .secondary:hover:not(:disabled) {
    background: var(--hair);
  }
  .png {
    font-size: 13px;
  }
  .esc {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .drawer {
      inset: 0;
      width: auto;
      max-width: none;
      border-radius: 0;
      border: 0;
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
</style>
