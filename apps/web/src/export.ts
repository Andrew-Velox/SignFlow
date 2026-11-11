/** Browser-side helpers for saving files. Everything stays local: Blob URLs only, no network. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function svgToBlob(svg: string): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`], { type: 'image/svg+xml;charset=utf-8' });
}

const MAX_PNG_SIDE = 8192;

/**
 * Rasterises an SVG string to a PNG with a transparent background.
 * `width`/`height` are the SVG's CSS size; `scale` multiplies it (clamped to a safe canvas size).
 */
export async function svgToPngBlob(svg: string, width: number, height: number, scale: number): Promise<{ blob: Blob; width: number; height: number }> {
  const s = Math.max(0.1, Math.min(scale, MAX_PNG_SIDE / Math.max(width, height)));
  const pw = Math.max(1, Math.round(width * s));
  const ph = Math.max(1, Math.round(height * s));

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, pw, ph); // stays transparent
    ctx.drawImage(img, 0, 0, pw, ph);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
    return { blob, width: pw, height: ph };
  } finally {
    URL.revokeObjectURL(url);
  }
}
