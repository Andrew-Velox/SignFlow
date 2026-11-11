import { processStroke, type ProcessOptions, type RawStroke, type Stroke } from '@signflow/core';

export type Theme = 'light' | 'dark';
export type PreviewMode = 'animated' | 'static';
export type PreviewBg = 'checker' | 'light' | 'dark';

/** Set to the project's repository URL to show the GitHub link in the top bar. */
export const REPO_URL = '';

const INK_DEFAULT: Record<Theme, string> = { light: '#171717', dark: '#f2f2f2' };
const PEN_DEFAULTS = { width: 4.5, smoothing: 0.5, velocity: 0.35, pressure: 0.7, taper: 0.5, variable: true, refine: false } as const;
const MAX_HISTORY = 100;

class Editor {
  // Drawing: raw strokes are the source of truth, everything else is derived from them.
  strokes = $state.raw<RawStroke[]>([]);
  private past = $state.raw<RawStroke[][]>([]);
  private future = $state.raw<RawStroke[][]>([]);

  // Pen
  width = $state<number>(PEN_DEFAULTS.width);
  smoothing = $state<number>(PEN_DEFAULTS.smoothing);
  velocity = $state<number>(PEN_DEFAULTS.velocity);
  pressure = $state<number>(PEN_DEFAULTS.pressure);
  taper = $state<number>(PEN_DEFAULTS.taper);
  variable = $state<boolean>(PEN_DEFAULTS.variable);
  refine = $state<boolean>(PEN_DEFAULTS.refine);
  ink = $state(INK_DEFAULT.light);
  private inkIsDefault = true;

  // Workspace
  theme = $state<Theme>('light');
  showGrid = $state(true);
  panelOpen = $state(true);
  exportOpen = $state(false);
  showRaw = $state(false);
  showFit = $state(false);
  canvas = $state({ width: 960, height: 420 });
  stats = $state({ previewMs: 0 });

  // Export
  crop = $state(true);
  padding = $state(12);
  pngScale = $state(2);
  previewMode = $state<PreviewMode>('animated');
  previewBg = $state<PreviewBg>('checker');
  animDuration = $state(2.5); // seconds spent drawing
  animStrokeDelay = $state(0.25); // seconds between strokes
  animEasing = $state('ease-in-out');
  animLoop = $state(false);

  canUndo = $derived(this.past.length > 0);
  canRedo = $derived(this.future.length > 0);
  isEmpty = $derived(this.strokes.length === 0);

  engineOptions = $derived<ProcessOptions>({
    smoothing: this.smoothing,
    cornerAngle: 62,
    pressureSensitivity: this.pressure,
    velocitySensitivity: this.velocity,
    taper: this.taper,
    refine: this.refine,
  });

  private cache = new Map<string, { raw: RawStroke; sig: string; stroke: Stroke }>();

  /** Vector strokes. Only strokes whose raw data or options changed are re-processed. */
  processed = $derived.by(() => {
    const options = this.engineOptions;
    const sig = JSON.stringify(options);
    const next = new Map<string, { raw: RawStroke; sig: string; stroke: Stroke }>();
    const out: Stroke[] = [];
    for (const raw of this.strokes) {
      const hit = this.cache.get(raw.id);
      const entry = hit && hit.raw === raw && hit.sig === sig ? hit : { raw, sig, stroke: processStroke(raw, options) };
      next.set(raw.id, entry);
      out.push(entry.stroke);
    }
    this.cache = next;
    return out;
  });

  // --- history ---------------------------------------------------------
  private commit(next: RawStroke[]): void {
    this.past = [...this.past, this.strokes].slice(-MAX_HISTORY);
    this.future = [];
    this.strokes = next;
  }
  addStroke(raw: RawStroke): void {
    this.commit([...this.strokes, raw]);
  }
  undo(): void {
    if (!this.past.length) return;
    this.future = [...this.future, this.strokes];
    this.strokes = this.past[this.past.length - 1];
    this.past = this.past.slice(0, -1);
  }
  redo(): void {
    if (!this.future.length) return;
    this.past = [...this.past, this.strokes];
    this.strokes = this.future[this.future.length - 1];
    this.future = this.future.slice(0, -1);
  }
  clear(): void {
    if (this.strokes.length) this.commit([]);
  }

  // --- pen -------------------------------------------------------------
  setInk(color: string): void {
    this.ink = color;
    this.inkIsDefault = false;
  }
  resetPen(): void {
    Object.assign(this, PEN_DEFAULTS);
    this.ink = INK_DEFAULT[this.theme];
    this.inkIsDefault = true;
  }

  // --- workspace ---------------------------------------------------------
  /** Reads the theme chosen before first paint (see index.html). */
  init(): void {
    const t = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    this.theme = t;
    this.ink = INK_DEFAULT[t];
    // On a phone the panel would cover half the canvas, so it starts closed there.
    if (matchMedia('(max-width: 720px)').matches) this.panelOpen = false;
  }
  setTheme(t: Theme): void {
    this.theme = t;
    if (this.inkIsDefault) this.ink = INK_DEFAULT[t];
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('signflow-theme', t);
    } catch {
      /* storage can be blocked; the theme still applies for this session */
    }
  }
  toggleTheme(): void {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }
  get defaultInk(): string {
    return INK_DEFAULT[this.theme];
  }
}

export const editor = new Editor();
