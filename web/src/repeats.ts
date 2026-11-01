// Repeats of a piece: where each repeat ends, where it starts again, and where its second ending
// is (for jumping there while scrolling).

import type { RepeatJ } from './score';

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
