import { describe, expect, it } from 'vitest';
import { offerFor, repeatsOf, unfoldRepeats } from '../repeats';
import type { PieceScore } from '../score';

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
    expect(offerFor(r, [], on(2, 3), { repeated: new Set(), navigated: new Set() })).toEqual({ kind: 'back', repeat: 0 });
    expect(offerFor(r, [], on(2, 3), { repeated: new Set([0]), navigated: new Set() })).toEqual({ kind: 'second', repeat: 0 });
    expect(offerFor(r, [], on(1, 0), { repeated: new Set(), navigated: new Set() })).toBeNull();
  });
});

describe('playing the repeats', () => {
  // one line of four measures, one note each (pitch 60 + measure), the third tied over from the second
  const piece = (): PieceScore => ({
    tpq: 480,
    events: [0, 1, 2, 3].map((m) => ({
      start: m * 1920, duration: 1920, pitches: [60 + m], holds: m === 1 ? [60] : [], box: [100 + m * 200, 0, 150 + m * 200, 10] as [number, number, number, number],
      staff: 0, system: 0, measure: m, sheet: 0, kind: 'note' as const,
    })),
    systems: [{ index: 0, box: [0, 0, 1000, 10], start: 0, end: 7680, sheet: 0 }],
    bassStaves: [],
    totalTicks: 7680,
    tempos: [{ tick: 0, bpm: 100 }, { tick: 3840, bpm: 80 }],
  });
  const order = (s: PieceScore) => s.events.map((e) => `${e.start / 1920}:${e.pitches[0] - 60}`).join(' ');

  it('plays the repeated measures again', () => {
    const marks = [[{ start: true, x: 290, staff: 0, system: 0, measure: 1 }, { start: false, x: 690, staff: 0, system: 0, measure: 2 }]];
    const s = unfoldRepeats(piece(), repeatsOf(marks));
    expect(order(s)).toBe('0:0 1:1 2:2 3:1 4:2 5:3');
    expect(s.totalTicks).toBe(6 * 1920);
    // after the jump back the first note is struck (not held over)
    expect(s.events[3].holds).toEqual([]);
    // the tempo: 80 from the third measure; back in the second measure it is 100 again
    expect(s.tempos).toEqual([{ tick: 0, bpm: 100 }, { tick: 3840, bpm: 80 }, { tick: 5760, bpm: 100 }, { tick: 7680, bpm: 80 }]);
  });

  it('leaves out the first ending the second time', () => {
    const marks = [[{ start: true, x: 290, staff: 0, system: 0, measure: 1 }, { start: false, x: 690, staff: 0, system: 0, measure: 2, firstEnding: 490 }]];
    expect(order(unfoldRepeats(piece(), repeatsOf(marks)))).toBe('0:0 1:1 2:2 3:1 4:3');
  });

  it('without repeat signs the piece stays as it is', () => {
    const p = piece();
    expect(unfoldRepeats(p, [])).toBe(p);
  });
});

describe('D.C. and D.S.', () => {
  // two lines of four measures (one note each, pitch 60 + number of the measure)
  const piece = (): PieceScore => ({
    tpq: 480,
    events: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
      start: n * 1920, duration: 1920, pitches: [60 + n], holds: [], box: [100 + (n % 4) * 200, 0, 150 + (n % 4) * 200, 10] as [number, number, number, number],
      staff: 0, system: Math.floor(n / 4), measure: n % 4, sheet: 0, kind: 'note' as const,
    })),
    systems: [0, 1].map((k) => ({ index: k, box: [0, k * 100, 1000, k * 100 + 50] as [number, number, number, number], start: k * 7680, end: (k + 1) * 7680, sheet: 0 })),
    bassStaves: [],
    totalTicks: 8 * 1920,
    tempos: [],
  });
  const order = (s: PieceScore) => s.events.map((e) => e.pitches[0] - 60).join(' ');
  const spot = (system: number, measure: number) => ({ sheet: 0, system, x: 100 + measure * 200, measure });

  it('D.S. al Coda: back to the segno, at "To Coda" on to the coda', () => {
    // segno at measure 2, "To Coda" after measure 3, D.S. al Coda after measure 5, coda from measure 6
    const nav = { kind: 'DS' as const, at: spot(1, 1), to: spot(0, 2), toCoda: spot(0, 3), coda: spot(1, 2) };
    expect(order(unfoldRepeats(piece(), [], [nav]))).toBe('0 1 2 3 4 5 2 3 6 7');
  });

  it('D.C. al Fine: from the beginning to "Fine"', () => {
    const nav = { kind: 'DC' as const, at: spot(1, 3), to: { sheet: 0, system: 0, x: 0, measure: 0 }, fine: spot(0, 1) };
    expect(order(unfoldRepeats(piece(), [], [nav]))).toBe('0 1 2 3 4 5 6 7 0 1');
  });

  it('after a D.C. a repeat is not repeated again', () => {
    const marks = [[{ start: true, x: 290, staff: 0, system: 0, measure: 1 }, { start: false, x: 690, staff: 0, system: 0, measure: 2 }]];
    const nav = { kind: 'DC' as const, at: spot(1, 3), to: { sheet: 0, system: 0, x: 0, measure: 0 }, fine: spot(0, 3) };
    expect(order(unfoldRepeats(piece(), repeatsOf(marks), [nav]))).toBe('0 1 2 1 2 3 4 5 6 7 0 1 2 3');
  });
});
