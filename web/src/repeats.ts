// Repeats of a piece: where each repeat ends, where it starts again, and where its second ending
// is (for jumping there while scrolling).

import type { PieceEvent, PieceScore, PieceSystem, RepeatJ, TempoChange } from './score';

/** A place in the piece: sheet, line (system of that sheet), x on the page, measure of the line. */
export interface Spot { sheet: number; system: number; x: number; measure: number }

export interface Repeat {
  /** The repeat sign at its end. */
  end: Spot;
  /** Where it starts again (the start sign before it, or the beginning of the piece). */
  start: Spot;
  /** Where the "1." bracket begins (to skip it the second time), if there is one. */
  firstEnding?: Spot;
}

/** The repeats of the sheets (repeat signs of each sheet, in reading order). */
export function repeatsOf(sheets: (RepeatJ[] | undefined)[]): Repeat[] {
  const out: Repeat[] = [];
  let start: Spot = { sheet: 0, system: 0, x: 0, measure: 0 };
  sheets.forEach((marks, sheet) => {
    for (const m of [...(marks ?? [])].sort((a, b) => a.system - b.system || a.x - b.x)) {
      const spot = { sheet, system: m.system, x: m.x, measure: m.measure };
      if (m.start) {
        start = spot;
        continue;
      }
      out.push({ end: spot, start, firstEnding: m.firstEnding !== undefined ? { sheet, system: m.system, x: m.firstEnding, measure: -1 } : undefined });
      // after an end the next repeat starts there (unless a start sign comes)
      start = { ...spot, measure: spot.measure + 1 };
    }
  });
  return out;
}

/** What the jump button offers while scrolling. */
export type JumpOffer = { kind: 'back'; repeat: number } | { kind: 'second'; repeat: number } | null;

/**
 * The button for the lines on the screen: at the end of a repeat not yet repeated, back to its
 * start; once repeated, at its first ending, on to the second.
 * [visible] tells whether a line (sheet, system) is on the screen; [done] the repeats jumped back.
 */
export function offerFor(repeats: Repeat[], visible: (sheet: number, system: number) => boolean, done: Set<number>): JumpOffer {
  for (const [i, r] of repeats.entries()) {
    if (!done.has(i) && visible(r.end.sheet, r.end.system)) return { kind: 'back', repeat: i };
    if (done.has(i) && r.firstEnding && visible(r.firstEnding.sheet, r.firstEnding.system)) return { kind: 'second', repeat: i };
  }
  return null;
}

/**
 * The piece as it is played: with its repeats (the repeated part again; the second time without
 * its first ending). The events keep their place on the page, so the music is shown where it is
 * printed.
 */
export function unfoldRepeats(s: PieceScore, repeats: Repeat[]): PieceScore {
  if (repeats.length === 0 || s.events.length === 0) return s;
  // the time each measure begins
  const measureStart = new Map<string, number>();
  for (const e of s.events) {
    if (e.system < 0) continue;
    const key = `${e.sheet}/${e.system}/${e.measure}`;
    measureStart.set(key, Math.min(measureStart.get(key) ?? Infinity, e.start));
  }
  const line = (sheet: number, system: number) => s.systems.find((y) => y.sheet === sheet && y.index === system);
  const begin = (p: Spot) =>
    p.sheet === 0 && p.system === 0 && p.x === 0 ? 0 : measureStart.get(`${p.sheet}/${p.system}/${p.measure}`) ?? line(p.sheet, p.system)?.start;
  const after = (p: Spot) => measureStart.get(`${p.sheet}/${p.system}/${p.measure + 1}`) ?? line(p.sheet, p.system)?.end;
  /** Where the first ending begins: the first note of its line from there on. */
  const firstEnding = (p: Spot) => {
    const notes = s.events.filter((e) => e.sheet === p.sheet && e.system === p.system && (e.box[0] + e.box[2]) / 2 >= p.x);
    return notes.length > 0 ? Math.min(...notes.map((e) => e.start)) : undefined;
  };

  // the parts in the order they are played: [from, to) in the written time
  const parts: [number, number][] = [];
  let at = 0;
  for (const r of repeats) {
    const from = begin(r.start);
    const to = after(r.end);
    if (from === undefined || to === undefined || to <= from || to <= at || from < 0) continue;
    const skip = r.firstEnding ? firstEnding(r.firstEnding) : undefined;
    parts.push([at, to]);
    parts.push([from, skip !== undefined && skip > from && skip < to ? skip : to]);
    at = to;
  }
  if (parts.length === 0) return s;
  parts.push([at, s.totalTicks]);

  const events: PieceEvent[] = [];
  const systems: PieceSystem[] = [];
  const tempos: TempoChange[] = [];
  let offset = 0;
  for (const [from, to] of parts) {
    if (to <= from) continue;
    for (const e of s.events) {
      if (e.start < from || e.start >= to) continue;
      events.push({
        ...e,
        start: e.start - from + offset,
        duration: Math.min(e.duration, to - e.start),
        // after a jump nothing is held over: the first notes are struck
        holds: e.start === from ? [] : e.holds,
      });
    }
    for (const y of s.systems) {
      if (y.end <= from || y.start >= to) continue;
      systems.push({ ...y, start: Math.max(y.start, from) - from + offset, end: Math.min(y.end, to) - from + offset });
    }
    // the tempo in force at the start of the part, and its changes within
    const before = s.tempos.filter((t) => t.tick <= from).at(-1);
    if (before) tempos.push({ tick: offset, bpm: before.bpm });
    for (const t of s.tempos) if (t.tick > from && t.tick < to) tempos.push({ tick: t.tick - from + offset, bpm: t.bpm });
    offset += to - from;
  }
  events.sort((a, b) => a.start - b.start);
  return { ...s, events, systems, tempos, totalTicks: offset };
}
