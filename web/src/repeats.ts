// Repeats of a piece: where each repeat ends, where it starts again, and where its second ending
// is (for jumping there while scrolling).

import type { PieceEvent, PieceScore, PieceSystem, RepeatJ, TempoChange } from './score';
import type { Navigation } from './navigation';

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
export type JumpOffer =
  | { kind: 'back'; repeat: number }
  | { kind: 'second'; repeat: number }
  | { kind: 'nav'; nav: number }
  | { kind: 'coda'; nav: number }
  | null;

/** What has been done while scrolling: repeats jumped back, D.C./D.S. jumped back. */
export interface JumpState { repeated: Set<number>; navigated: Set<number> }

/**
 * The button for the lines on the screen: at the end of a repeat not yet repeated, back to its
 * start; once repeated, at its first ending, on to the second; at a D.C./D.S., back; after it,
 * at "To Coda", on to the coda. After a D.C./D.S. repeats are not repeated again (the usual
 * way), their first endings are left out.
 * [visible] tells whether a line (sheet, system) is on the screen.
 */
export function offerFor(repeats: Repeat[], navs: Navigation[], visible: (sheet: number, system: number) => boolean, st: JumpState): JumpOffer {
  const back = st.navigated.size > 0;
  for (const [i, n] of navs.entries()) {
    if (st.navigated.has(i) && n.toCoda && n.coda && visible(n.toCoda.sheet, n.toCoda.system)) return { kind: 'coda', nav: i };
  }
  for (const [i, r] of repeats.entries()) {
    if (!back && !st.repeated.has(i) && visible(r.end.sheet, r.end.system)) return { kind: 'back', repeat: i };
    if ((st.repeated.has(i) || back) && r.firstEnding && visible(r.firstEnding.sheet, r.firstEnding.system)) return { kind: 'second', repeat: i };
  }
  for (const [i, n] of navs.entries()) {
    if (!st.navigated.has(i) && visible(n.at.sheet, n.at.system)) return { kind: 'nav', nav: i };
  }
  return null;
}

/**
 * The piece as it is played: with its repeats (the repeated part again; the second time without
 * its first ending) and its D.C./D.S. (back, then to "Fine" or on to the coda; repeats are not
 * repeated again then). The events keep their place on the page, so the music is shown where it
 * is printed.
 */
export function unfoldRepeats(s: PieceScore, repeats: Repeat[], navs: Navigation[] = []): PieceScore {
  if ((repeats.length === 0 && navs.length === 0) || s.events.length === 0) return s;
  // the time each measure begins
  const measureStart = new Map<string, number>();
  for (const e of s.events) {
    if (e.system < 0) continue;
    const key = `${e.sheet}/${e.system}/${e.measure}`;
    measureStart.set(key, Math.min(measureStart.get(key) ?? Infinity, e.start));
  }
  const line = (sheet: number, system: number) => s.systems.find((y) => y.sheet === sheet && y.index === system);
  const begin = (p: Spot) =>
    p.sheet === 0 && p.system === 0 && p.x === 0 && p.measure === 0 ? 0 : measureStart.get(`${p.sheet}/${p.system}/${p.measure}`) ?? line(p.sheet, p.system)?.start;
  const after = (p: Spot) => measureStart.get(`${p.sheet}/${p.system}/${p.measure + 1}`) ?? line(p.sheet, p.system)?.end;
  /** Where the first ending begins: the first note of its line from there on. */
  const firstEnding = (p: Spot) => {
    const notes = s.events.filter((e) => e.sheet === p.sheet && e.system === p.system && (e.box[0] + e.box[2]) / 2 >= p.x);
    return notes.length > 0 ? Math.min(...notes.map((e) => e.start)) : undefined;
  };

  // what may happen while playing: at a time, when it applies, and where it goes on (null: the end)
  interface State { repeated: Set<number>; navigated: boolean }
  interface Trigger { at: number; when: (st: State) => boolean; then: (st: State) => number | null }
  const triggers: Trigger[] = [];
  repeats.forEach((r, i) => {
    const from = begin(r.start);
    const to = after(r.end);
    if (from === undefined || to === undefined || to <= from) return;
    triggers.push({ at: to, when: (st) => !st.repeated.has(i) && !st.navigated, then: (st) => { st.repeated.add(i); return from; } });
    const skip = r.firstEnding ? firstEnding(r.firstEnding) : undefined;
    if (skip !== undefined && skip > from && skip < to) triggers.push({ at: skip, when: (st) => st.repeated.has(i) || st.navigated, then: () => to });
  });
  navs.forEach((n) => {
    const at = after(n.at);
    const to = begin(n.to);
    if (at === undefined || to === undefined || to >= at) return;
    triggers.push({ at, when: (st) => !st.navigated, then: (st) => { st.navigated = true; return to; } });
    const fine = n.fine && after(n.fine);
    if (fine !== undefined) triggers.push({ at: fine, when: (st) => st.navigated, then: () => null });
    const leave = n.toCoda && after(n.toCoda);
    const coda = n.coda && begin(n.coda);
    if (leave !== undefined && coda !== undefined && coda > leave) triggers.push({ at: leave, when: (st) => st.navigated, then: () => coda });
  });
  if (triggers.length === 0) return s;

  // the parts in the order they are played: [from, to) in the written time
  const parts: [number, number][] = [];
  const st: State = { repeated: new Set(), navigated: false };
  let at = 0;
  for (let guard = 0; guard < 200; guard++) {
    const next = triggers.filter((t) => t.at > at && t.when(st)).sort((a, b) => a.at - b.at)[0];
    if (!next) {
      parts.push([at, s.totalTicks]);
      break;
    }
    parts.push([at, next.at]);
    const goOn = next.then(st);
    if (goOn === null) break;
    at = goOn;
  }

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
