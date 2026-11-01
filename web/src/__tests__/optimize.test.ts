import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { greyDownscaled, greyPng, workingSize } from '../optimize';

describe('photos as the recognition reads them', () => {
  it('keeps the size the recognition works in', () => {
    expect(workingSize(1080, 2340)).toEqual({ w: 1080, h: 2340 });
    // a 12 MP photo: the short side keeps 2400 pixels
    expect(workingSize(4032, 3024)).toEqual({ w: 3200, h: 2400 });
  });

  it('greys and averages like the recognition (whole numbers, rounded down)', () => {
    // 2 x 2 pixels to 1: grey 0, 255, 100, 50 -> 405 / 4 = 101.25 -> 101
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 50, 50, 50, 255]);
    expect([...greyDownscaled(rgba, 2, 2, 1, 1)]).toEqual([101]);
    // grey as in the worker: (r*299 + g*587 + b*114) / 1000, cut off
    expect([...greyDownscaled(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1, 1, 1)]).toEqual([76]);
  });

  it('writes a grey PNG whose rows give back the pixels', () => {
    const w = 5;
    const h = 3;
    const grey = Uint8ClampedArray.from({ length: w * h }, (_, i) => (i * 37) % 256);
    const png = greyPng(grey, w, h);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // undo the filters of the packed rows
    const idat = png.slice(8 + 25 + 8, png.length - 12 - 4);
    const raw = unzlibSync(idat);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (w + 1)];
      for (let x = 0; x < w; x++) {
        const v = raw[y * (w + 1) + 1 + x];
        const a = x > 0 ? out[y * w + x - 1] : 0;
        const b = y > 0 ? out[(y - 1) * w + x] : 0;
        const c = x > 0 && y > 0 ? out[(y - 1) * w + x - 1] : 0;
        const p = a + b - c;
        const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        const pred = [0, a, b, (a + b) >> 1, paeth][f];
        out[y * w + x] = (v + pred) & 255;
      }
    }
    expect([...out]).toEqual([...grey]);
  });
});
