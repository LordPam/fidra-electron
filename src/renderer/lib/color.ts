/**
 * Extract the dominant non-white/non-black color from an image via canvas sampling.
 * Returns a hex string or null if extraction fails.
 */
export function extractDominantColor(dataUri: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 64; // sample at small size for speed
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Count colors, ignoring near-white, near-black, and transparent pixels
        const colorCounts = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue; // skip transparent
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luma > 230 || luma < 25) continue; // skip near-white/near-black
          // Quantize to reduce noise (bucket into 8-value steps)
          const qr = (r >> 3) << 3, qg = (g >> 3) << 3, qb = (b >> 3) << 3;
          const key = `${qr},${qg},${qb}`;
          colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }

        if (colorCounts.size === 0) { resolve(null); return; }

        // Find the most common color
        let maxCount = 0;
        let dominant = '';
        for (const [key, count] of colorCounts) {
          if (count > maxCount) { maxCount = count; dominant = key; }
        }

        const [r, g, b] = dominant.split(',').map(Number);
        const hex = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}
