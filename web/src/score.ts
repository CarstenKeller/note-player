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
export interface SheetResult { staffSpace: number; skew: number; warnings: string[]; score: ScoreJ; withoutVocals: ScoreJ; tabs?: Box[] }

/** An event of the whole piece; [sheet] is the page it is printed on (index in the piece). */
export interface PieceEvent extends EventJ {
  sheet: number;
  /** Guitar: 1 = chord strummed down, -1 = up; 0/absent = notes struck together. */
  strum?: number;
  /** 'chord' and 'tab' come from the guitar reading (chord names, text tabs). */
  kind?: 'note' | 'chord' | 'tab';
}
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

/** Played softer, like the accompaniment in the bass clef. */
export const ACCOMPANIMENT_STAFF = 1_000_000;

/** Further events of a sheet (guitar chords and tabs), in ticks of the sheet. */
export interface ExtraEvent {
  start: number;
  duration: number;
  pitches: number[];
  box: Box;
  strum: number;
  kind: 'chord' | 'tab';
}

/** What a sheet contributes to the piece. */
export interface SheetPart {
  score: ScoreJ;
  /** Play the notes of the staves (else they only give the time). */
  notes?: boolean;
  /** Semitones added to the notes (guitar music sounds an octave lower than written). */
  transpose?: number;
  extra?: ExtraEvent[];
  /** Length when longer than the notes (a song sheet without staves). */
  length?: number;
}

export function totalTicks(s: ScoreJ): number {
  return s.events.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
}

/**
 * Joins the sheets: each starts where the one before ends. A tie does not reach over a page
 * break (as in the Android app).
 */
export function joinSheets(parts: (SheetPart | ScoreJ | null)[]): PieceScore {
  const events: PieceEvent[] = [];
  const systems: PieceSystem[] = [];
  const bassStaves: number[] = [ACCOMPANIMENT_STAFF];
  let tick = 0;
  let staffOffset = 0;
  let tpq = 480;
  parts.forEach((p, sheet) => {
    if (!p) return;
    const part: SheetPart = 'score' in p ? p : { score: p };
    const s = part.score;
    tpq = s.tpq;
    const shift = part.transpose ?? 0;
    if (part.notes !== false) {
      for (const e of s.events) {
        events.push({
          ...e,
          start: e.start + tick,
          staff: e.staff + staffOffset,
          pitches: shift ? e.pitches.map((x) => x + shift) : e.pitches,
          holds: e.start === 0 ? [] : shift ? e.holds.map((x) => x + shift) : e.holds,
          sheet,
          kind: 'note',
        });
      }
    }
    for (const x of part.extra ?? []) {
      events.push({
        start: x.start + tick, duration: x.duration, pitches: x.pitches, holds: [], box: x.box,
        staff: x.kind === 'chord' ? ACCOMPANIMENT_STAFF : staffOffset, system: -1, measure: -1,
        sheet, strum: x.strum, kind: x.kind,
      });
    }
    for (const sy of s.systems) systems.push({ ...sy, start: sy.start + tick, end: sy.end + tick, sheet });
    for (const st of s.staves) if (st.clef === 'BASS') bassStaves.push(st.index + staffOffset);
    staffOffset += s.staves.length;
    tick += Math.max(totalTicks(s), part.length ?? 0, ...(part.extra ?? []).map((x) => x.start + x.duration));
  });
  events.sort((a, b) => a.start - b.start);
  return { tpq, events, systems, bassStaves, totalTicks: tick };
}

export const secondsOf = (ticks: number, bpm: number, tpq: number) => (ticks * 60) / (bpm * tpq);
export const ticksOf = (seconds: number, bpm: number, tpq: number) => (seconds * bpm * tpq) / 60;
