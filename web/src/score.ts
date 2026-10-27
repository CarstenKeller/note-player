// The recognized music (JSON from the Kotlin recognition) and the joining of several sheets.

export type Box = [number, number, number, number]; // left, top, right, bottom (page pixels)

export interface StaffJ { index: number; system: number; box: Box; clef: 'TREBLE' | 'BASS' | 'ALTO'; key: number; vocal: boolean }
export interface SystemJ { index: number; box: Box; start: number; end: number }
export interface EventJ {
  start: number;
  duration: number;
  /** MIDI note numbers; empty for a rest. */
  pitches: number[];
  /** Pitches tied over from the note before (not struck again). */
  holds: number[];
  box: Box;
  staff: number;
  system: number;
  measure: number;
}
export interface ScoreJ { tpq: number; staves: StaffJ[]; systems: SystemJ[]; events: EventJ[] }
export interface SheetResult { staffSpace: number; skew: number; warnings: string[]; score: ScoreJ; withoutVocals: ScoreJ }

/** An event of the whole piece; [sheet] is the page it is printed on (index in the piece). */
export interface PieceEvent extends EventJ { sheet: number }
export interface PieceSystem extends SystemJ { sheet: number }

/** The music of all sheets one after the other. */
export interface PieceScore {
  tpq: number;
  events: PieceEvent[];
  systems: PieceSystem[];
  /** Staves in the bass clef (the accompaniment is played a little softer). */
  bassStaves: number[];
  totalTicks: number;
}

export function totalTicks(s: ScoreJ): number {
  return s.events.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
}

/**
 * Joins the sheets: each starts where the one before ends. A tie does not reach over a page
 * break (as in the Android app).
 */
export function joinSheets(parts: (ScoreJ | null)[]): PieceScore {
  const events: PieceEvent[] = [];
  const systems: PieceSystem[] = [];
  const bassStaves: number[] = [];
  let tick = 0;
  let staffOffset = 0;
  let tpq = 480;
  parts.forEach((s, sheet) => {
    if (!s) return;
    tpq = s.tpq;
    for (const e of s.events) {
      events.push({ ...e, start: e.start + tick, staff: e.staff + staffOffset, holds: e.start === 0 ? [] : e.holds, sheet });
    }
    for (const sy of s.systems) systems.push({ ...sy, start: sy.start + tick, end: sy.end + tick, sheet });
    for (const st of s.staves) if (st.clef === 'BASS') bassStaves.push(st.index + staffOffset);
    staffOffset += s.staves.length;
    tick += totalTicks(s);
  });
  events.sort((a, b) => a.start - b.start);
  return { tpq, events, systems, bassStaves, totalTicks: tick };
}

export const secondsOf = (ticks: number, bpm: number, tpq: number) => (ticks * 60) / (bpm * tpq);
export const ticksOf = (seconds: number, bpm: number, tpq: number) => (seconds * bpm * tpq) / 60;
