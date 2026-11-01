import { describe, expect, it } from 'vitest';
import { A4, cutSheet, layoutCuts, musicRows, type SheetGeometry } from '../sheetlayout';
import type { Box } from '../score';

/** A sheet of [height] rows with ink in the given bands [from, to). */
function sheet(height: number, rows: Box[], ink: [number, number][], staffSpace = 10, width = 1000): SheetGeometry {
  const a = new Float32Array(height);
  for (const [from, to] of ink) for (let y = from; y < to; y++) a[y] = 0.1;
  return { width, height, staffSpace, rows, ink: a };
}

describe('cutting a sheet between its systems', () => {
  // something at the very top 20–40 (running head, frame of a screenshot), a title 130–150,
  // systems at 200–240 and 400–440 with chord names 180–190 and lyrics 250–262 / 450–462,
  // footer 960–975
  const rows: Box[] = [[100, 200, 900, 240], [100, 400, 900, 440]];
  const ink: [number, number][] = [[20, 40], [130, 150], [180, 190], [200, 240], [250, 262], [380, 390], [400, 440], [450, 462], [960, 975]];
  const g = sheet(1000, rows, ink);

  it('leaves out running head and footer, keeps chord names and lyrics with their system', () => {
    const cuts = cutSheet(g, false);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].y0).toBeGreaterThan(150);
    expect(cuts[0].y0).toBeLessThanOrEqual(180);
    // the cut between the systems lies between the lyrics (262) and the next chord names (380)
    expect(cuts[0].y1).toBeGreaterThan(262);
    expect(cuts[0].y1).toBeLessThan(380);
    expect(cuts[1].y0).toBe(cuts[0].y1);
    expect(cuts[1].y1).toBeGreaterThan(462);
    expect(cuts[1].y1).toBeLessThan(960);
    // room for braces and names left of the staves
    expect(cuts[0].x0).toBe(40);
    expect(cuts[0].x1).toBe(915);
  });

  it('keeps the title on the first sheet', () => {
    const y0 = cutSheet(g, true)[0].y0;
    expect(y0).toBeLessThanOrEqual(130);
    expect(y0).toBeGreaterThan(40);
  });

  it('puts a tablature to the system above it', () => {
    expect(musicRows([[100, 200, 900, 240]], [[90, 270, 910, 330]], 10)).toEqual([[100, 200, 900, 330]]);
  });
});

describe('setting the cuts on A4 pages', () => {
  it('gives all staves one size, their left ends one above the other, and breaks between systems', () => {
    // three sheets of different resolution (staff space 10, 20 and 15 pixels), five systems each
    const make = (ss: number) => {
      const rows: Box[] = [0, 1, 2, 3, 4].map((i) => [10 * ss, (10 + 16 * i) * ss, 90 * ss, (14 + 16 * i) * ss]);
      const g = sheet(100 * ss, rows, rows.map((r) => [r[1], r[3]]), ss, 100 * ss);
      return { g, cuts: cutSheet(g, false) };
    };
    const a = make(10);
    const b = make(20);
    const c = make(15);
    const ssOf = [10, 20, 15];
    const pages = layoutCuts([a, b, c]);
    const placed = pages.flat();
    expect(placed).toHaveLength(15);
    // same size on paper: a system is 4 staff spaces high (plus the same room) everywhere
    const mmPerSpace = placed.map((p) => (p.h / (p.cut.y1 - p.cut.y0)) * ssOf[p.sheet]);
    for (const m of mmPerSpace) expect(m).toBeCloseTo(mmPerSpace[0], 6);
    // the left ends of the staves line up
    const staffX = placed.map((p) => p.x + (10 * ssOf[p.sheet] - p.cut.x0) * (p.w / (p.cut.x1 - p.cut.x0)));
    for (const x of staffX) expect(x).toBeCloseTo(staffX[0], 6);
    // all within the printable area, a page break only between cuts
    for (const page of pages) {
      for (const p of page) {
        expect(p.x).toBeGreaterThanOrEqual(A4.margin - 1e-9);
        expect(p.x + p.w).toBeLessThanOrEqual(A4.width - A4.margin + 1e-9);
        expect(p.y + p.h).toBeLessThanOrEqual(A4.height - A4.margin + 1e-9);
      }
    }
    expect(pages.length).toBeGreaterThan(1);
  });
});
