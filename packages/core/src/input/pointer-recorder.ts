import type { InputPoint, PointerKind, RawStroke } from '../types';
import type { ProcessOptions } from '../smoothing/options';
import { StrokeBuilder } from './stroke-builder';

export interface PointerRecorderOptions {
  /** Element that receives pointer input (normally the `<canvas>`). */
  element: HTMLElement;
  /**
   * Logical coordinate space the strokes are stored in. When the element is
   * displayed at a different CSS size (responsive layout, zoom) positions are
   * scaled so stored geometry is independent of the on-screen size.
   * Defaults to the element's CSS size.
   */
  logicalSize?: () => { width: number; height: number };
  /** Live smoothing options (read at the start of each stroke). */
  getOptions?: () => Partial<ProcessOptions>;
  onStrokeStart?: (builder: StrokeBuilder) => void;
  /** Called after each pointer event that added at least one sample. */
  onStrokeUpdate?: (builder: StrokeBuilder) => void;
  onStrokeEnd?: (raw: RawStroke) => void;
  onStrokeCancel?: () => void;
}

let strokeCounter = 0;
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${(strokeCounter++).toString(36)}`;

/**
 * Pointer Events adapter: one finger / pen / mouse draws at a time.
 *
 *  - `getCoalescedEvents()` recovers the 120–1000 Hz samples the browser
 *    merged into each `pointermove`, so fast strokes keep their detail.
 *  - Pointer capture keeps the stroke alive when leaving the canvas.
 *  - Additional simultaneous pointers (palm, second finger) are ignored.
 *  - `touch-action: none` is set so touch input draws instead of scrolling.
 */
export class PointerRecorder {
  private activeId: number | null = null;
  private builder: StrokeBuilder | null = null;
  private rect: DOMRect | null = null;
  private lastPoint: InputPoint | null = null;

  constructor(private readonly o: PointerRecorderOptions) {
    const el = o.element;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
  }

  destroy(): void {
    const el = this.o.element;
    el.removeEventListener('pointerdown', this.down);
    el.removeEventListener('pointermove', this.move);
    el.removeEventListener('pointerup', this.up);
    el.removeEventListener('pointercancel', this.cancel);
    el.removeEventListener('lostpointercapture', this.lost);
    this.reset();
  }

  get isDrawing(): boolean {
    return this.builder !== null;
  }

  private toPoint(e: PointerEvent): InputPoint {
    const r = this.rect!;
    const size = this.o.logicalSize?.() ?? { width: r.width, height: r.height };
    const sx = r.width > 0 ? size.width / r.width : 1;
    const sy = r.height > 0 ? size.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy, t: e.timeStamp, pressure: e.pressure };
  }

  private down = (e: PointerEvent): void => {
    if (this.activeId !== null || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen' && e.button === 5) return; // eraser tip
    e.preventDefault();
    this.activeId = e.pointerId;
    this.rect = this.o.element.getBoundingClientRect();
    try {
      this.o.element.setPointerCapture(e.pointerId);
    } catch {
      /* capture can fail for synthetic events; drawing still works inside the element */
    }
    const kind: PointerKind = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
    this.builder = new StrokeBuilder(newId(), kind, this.o.getOptions?.());
    const p = this.toPoint(e);
    this.lastPoint = p;
    this.builder.push(p);
    this.o.onStrokeStart?.(this.builder);
    this.o.onStrokeUpdate?.(this.builder);
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId || !this.builder) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    let added = false;
    for (const ev of events.length ? events : [e]) {
      const p = this.toPoint(ev);
      // Browsers occasionally give coalesced events a zero timestamp.
      if (!(p.t > 0)) p.t = e.timeStamp;
      if (this.builder.push(p)) {
        this.lastPoint = p;
        added = true;
      }
    }
    if (added) this.o.onStrokeUpdate?.(this.builder);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId || !this.builder) return;
    e.preventDefault();
    const p = this.toPoint(e);
    const last = this.lastPoint;
    if (!last || last.x !== p.x || last.y !== p.y) this.builder.push(p);
    const raw = this.builder.raw();
    this.reset();
    this.o.onStrokeEnd?.(raw);
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.reset();
    this.o.onStrokeCancel?.();
  };

  private lost = (e: PointerEvent): void => {
    // Capture is released after pointerup/cancel, which already reset us.
    if (e.pointerId === this.activeId && this.builder) this.cancel(e);
  };

  private reset(): void {
    if (this.activeId !== null) {
      try {
        this.o.element.releasePointerCapture(this.activeId);
      } catch {
        /* already released */
      }
    }
    this.activeId = null;
    this.builder = null;
    this.rect = null;
    this.lastPoint = null;
  }
}
