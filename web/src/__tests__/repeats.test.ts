import { describe, expect, it } from 'vitest';
import { offerFor, repeatsOf } from '../repeats';

describe('repeats', () => {
  // sheet 0: start before measure 1 of line 1; sheet 2: end in line 3 with a first ending,
  // sheet 3: start and end again
  const marks = [
    [{ start: true, x: 877, staff: 3, system: 1, measure: 1 }],
    [],
    [{ start: false, x: 1387, staff: 9, system: 3, measure: 2, firstEnding: 297 }],
    [{ start: true, x: 1812, staff: 0, system: 0, measure: 3 }, { start: false, x: 2219, staff: 6, system: 2, measure: 1 }],
  ];

  it('pairs each end with the start before it', () => {
    const r = repeatsOf(marks);
    expect(r.map((x) => `${x.start.sheet}/${x.start.system}/${x.start.measure} <- ${x.end.sheet}/${x.end.system}/${x.end.measure}`))
      .toEqual(['0/1/1 <- 2/3/2', '3/0/3 <- 3/2/1']);
    expect(r[0].firstEnding?.x).toBe(297);
  });

  it('an end without a start goes back to the beginning', () => {
    expect(repeatsOf([[{ start: false, x: 500, staff: 0, system: 2, measure: 3 }]])[0].start).toEqual({ sheet: 0, system: 0, x: 0, measure: 0 });
  });

  it('offers back at the end, then the second ending', () => {
    const r = repeatsOf(marks);
    const on = (sheet: number, system: number) => (s: number, y: number) => s === sheet && y === system;
    expect(offerFor(r, on(2, 3), new Set())).toEqual({ kind: 'back', repeat: 0 });
    expect(offerFor(r, on(2, 3), new Set([0]))).toEqual({ kind: 'second', repeat: 0 });
    expect(offerFor(r, on(1, 0), new Set())).toBeNull();
  });
});
