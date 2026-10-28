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
  /** Tempo marks of the sheets (empty: none read). */
  tempos: TempoChange[];
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
  /** Tempo marks in ticks of the sheet. */
  tempos?: TempoChange[];
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
  const tempos: TempoChange[] = [];
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
    for (const t of part.tempos ?? []) tempos.push({ tick: t.tick + tick, bpm: t.bpm });
    for (const sy of s.systems) systems.push({ ...sy, start: sy.start + tick, end: sy.end + tick, sheet });
    for (const st of s.staves) if (st.clef === 'BASS') bassStaves.push(st.index + staffOffset);
    staffOffset += s.staves.length;
    tick += Math.max(totalTicks(s), part.length ?? 0, ...(part.extra ?? []).map((x) => x.start + x.duration));
  });
  events.sort((a, b) => a.start - b.start);
  return { tpq, events, systems, bassStaves, totalTicks: tick, tempos };
}

export const secondsOf = (ticks: number, bpm: number, tpq: number) => (ticks * 60) / (bpm * tpq);
export const ticksOf = (seconds: number, bpm: number, tpq: number) => (seconds * bpm * tpq) / 60;

/** A tempo change: from [tick] on, [bpm] quarter notes per minute. */
export interface TempoChange { tick: number; bpm: number }

/** Musical time (ticks) and seconds, with tempo changes (the first one at tick 0). */
export class TempoMap {
  constructor(readonly changes: TempoChange[], readonly tpq: number) {}

  static constant(bpm: number, tpq: number) {
    return new TempoMap([{ tick: 0, bpm }], tpq);
  }

  seconds(tick: number): number {
    let t = 0;
    this.changes.forEach((c, i) => {
      const from = i === 0 ? 0 : c.tick;
      const to = i + 1 < this.changes.length ? this.changes[i + 1].tick : Infinity;
      if (tick > from) t += ((Math.min(tick, to) - from) * 60) / (c.bpm * this.tpq);
    });
    return t;
  }

  tick(seconds: number): number {
    let t = 0;
    for (let i = 0; i < this.changes.length; i++) {
      const c = this.changes[i];
      const from = i === 0 ? 0 : c.tick;
      const to = i + 1 < this.changes.length ? this.changes[i + 1].tick : Infinity;
      const span = ((to - from) * 60) / (c.bpm * this.tpq);
      if (seconds <= t + span) return from + ((seconds - t) * c.bpm * this.tpq) / 60;
      t += span;
    }
    return 0;
  }

  /** Same changes, all faster or slower by [factor]. */
  scaled(factor: number): TempoMap {
    return new TempoMap(this.changes.map((c) => ({ tick: c.tick, bpm: Math.max(10, c.bpm * factor) })), this.tpq);
  }

  key(): string {
    return this.changes.map((c) => `${c.tick}:${c.bpm.toFixed(2)}`).join(',');
  }
}
