<script lang="ts">
  import { onMount } from 'svelte';
  import { PointerRecorder, strokeCenterlinePath, strokeOutlinePath, type Stroke, type StrokeBuilder } from '@signflow/core';
  import { editor } from '../stores/editor.svelte';

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let live: StrokeBuilder | null = null;
  let drawing = $state(false);

  // Finished strokes live on an offscreen layer that is repainted only when they, or how they look, change.
  let layer: HTMLCanvasElement | null = null;
  let layerDirty = true;
  let frame = 0;

  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  $effect(() => {
    void [editor.processed, editor.width, editor.variable, editor.ink];
    layerDirty = true;
  });

  $effect(() => {
    void [editor.processed, editor.width, editor.variable, editor.ink, editor.showRaw, editor.showFit, editor.canvas.width, editor.canvas.height, editor.theme];
    requestRender();
  });

  function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, quality: 'final' | 'live' = 'final') {
    if (!s.segments.length) return;
    if (editor.variable) ctx.fill(new Path2D(strokeOutlinePath(s, editor.width, quality === 'live' ? 1 : 2, quality)));
    else ctx.stroke(new Path2D(strokeCenterlinePath(s)));
  }

  function styleInk(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = editor.ink;
    ctx.strokeStyle = editor.ink;
    ctx.lineWidth = editor.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function render() {
    const { width: W, height: H } = editor.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(W * dpr));
    const ch = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      layerDirty = true;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    if (layerDirty || !layer) {
      layer ??= document.createElement('canvas');
      layer.width = cw;
      layer.height = ch;
      const lctx = layer.getContext('2d')!;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      styleInk(lctx);
      for (const s of editor.processed) paintStroke(lctx, s);
      layerDirty = false;
    }
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (live) {
      const t0 = performance.now();
      styleInk(ctx);
      paintStroke(ctx, live.preview(), 'live');
      editor.stats.previewMs = performance.now() - t0;
    }

    if (editor.showRaw || editor.showFit) {
      const accent = getComputedStyle(canvas).getPropertyValue('--focus').trim() || '#2f54d6';
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      if (editor.showRaw) {
        ctx.lineWidth = 0.75;
        ctx.globalAlpha = 0.85;
        const all = live ? [...editor.strokes, live.raw()] : editor.strokes;
        for (const r of all) {
          ctx.beginPath();
          r.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.stroke();
          for (const p of r.points) ctx.fillRect(p.x - 1.25, p.y - 1.25, 2.5, 2.5);
        }
        ctx.globalAlpha = 1;
      }
      if (editor.showFit) {
        ctx.lineWidth = 1;
        for (const s of editor.processed) for (const seg of s.segments) ctx.strokeRect(seg.p0.x - 3, seg.p0.y - 3, 6, 6);
      }
    }
  }

  onMount(() => {
    const measure = () => {
      const r = stage.getBoundingClientRect();
      editor.canvas = { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);

    const rec = new PointerRecorder({
      element: canvas,
      getOptions: () => editor.engineOptions,
      onStrokeStart: (b) => {
        live = b;
        drawing = true;
      },
      onStrokeUpdate: requestRender,
      onStrokeEnd: (raw) => {
        live = null;
        drawing = false;
        editor.addStroke(raw);
      },
      onStrokeCancel: () => {
        live = null;
        drawing = false;
        requestRender();
      },
    });
    requestRender();
    return () => {
      rec.destroy();
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  });
</script>

<!-- A long-press must not open a context menu halfway through a stroke. -->
<div class="stage" class:grid={editor.showGrid} bind:this={stage} oncontextmenu={(e) => e.preventDefault()} role="presentation">
  <canvas bind:this={canvas} aria-label="Drawing canvas. Draw with a mouse, finger or stylus."></canvas>
  {#if editor.isEmpty && !drawing}
    <p class="hint">
      Draw your signature anywhere
      <span>Mouse, touch or stylus</span>
    </p>
  {/if}
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    background-color: var(--canvas);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: crosshair;
  }
  /* Dot grid: 20px pitch, drawn in CSS so it stays crisp and never reaches the export. */
  .stage.grid {
    background-image: radial-gradient(circle, var(--dot) 0.9px, transparent 1.3px);
    background-size: 20px 20px;
    background-position: 10px 10px;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .hint {
    position: absolute;
    left: 50%;
    top: 46%;
    margin: 0;
    transform: translate(-50%, -50%);
    display: grid;
    gap: 4px;
    justify-items: center;
    font-size: 18px;
    line-height: 28px;
    color: var(--text-2);
    pointer-events: none;
    text-align: center;
  }
  .hint span {
    font-size: 13px;
    line-height: 20px;
    color: var(--muted);
  }
</style>
