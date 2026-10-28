// Playback: the piece is rendered as a whole (in the worker, with the recorded piano or guitar
// notes) and played with Web Audio; the musical position follows from the playback time.

import { render, sendSamples, type SampleKind } from './engine';
import { secondsOf, ticksOf, type PieceScore } from './score';

export const INSTRUMENTS: { id: string; label: string }[] = [
  { id: 'GRAND_PIANO', label: 'Flügel' },
  { id: 'ELECTRIC_PIANO', label: 'E-Piano' },
  { id: 'ORGAN', label: 'Orgel' },
  { id: 'HARP', label: 'Harfe' },
];

/** The sound of the guitar mode. */
export const GUITAR = 'GUITAR';

// recorded piano notes: C, D#, F#, A of each octave
const PIANO_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4',
  'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
// recorded guitar notes: nearly every semitone from the low E to C#5
const GUITAR_NAMES = ['E2', 'F2', 'Fs2', 'G2', 'Gs2', 'A2', 'As2', 'B2', 'C3', 'Cs3', 'D2', 'D3', 'Ds2', 'Ds3', 'E3', 'F3', 'Fs3',
  'G3', 'Gs3', 'A3', 'As3', 'B3', 'C4', 'Cs4', 'D4', 'Ds4', 'E4', 'F4', 'Fs4', 'G4', 'Gs4', 'A4', 'As4', 'B4', 'C5', 'Cs5', 'D5'];

function pitchOf(name: string): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const sharp = name[1] === 's' ? 1 : 0;
  return 12 * (Number(name.slice(1 + sharp)) + 1) + base[name[0]] + sharp;
}

/** Events as numbers for the worker (see WebOmr.render in the Kotlin core). */
function encode(score: PieceScore): Int32Array {
  const out: number[] = [];
  for (const e of score.events) {
    if (e.pitches.length === 0) continue;
    out.push(e.start, e.start + e.duration, e.staff, e.strum ?? 0, e.pitches.length, ...e.pitches, e.holds.length, ...e.holds);
  }
  return Int32Array.from(out);
}

export class Player {
  private ctx: AudioContext | null = null;
  private samplesLoaded = new Map<SampleKind, Promise<void>>();
  private buffer: AudioBuffer | null = null;
  private preparedFor: { score: PieceScore; bpm: number; instrument: string } | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private startTick = 0;
  onEnded: (() => void) | null = null;

  /**
   * Must be called directly in a tap (Safari only allows sound that a tap started).
   */
  unlock(): void {
    const ctx = this.context();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  /** The audio context; it may stay paused until a tap ([unlock]). */
  private context(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      // iPadOS can interrupt the sound (another app, a notification): continue when possible
      ctx.onstatechange = () => {
        if (this.source && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
      };
      this.ctx = ctx;
    }
    return this.ctx;
  }

  private loadSamples(kind: SampleKind): Promise<void> {
    let loaded = this.samplesLoaded.get(kind);
    if (!loaded) {
      loaded = (async () => {
        const ctx = this.ctx!;
        const names = kind === 'guitar' ? GUITAR_NAMES : PIANO_NAMES;
        const decoded = await Promise.all(names.map(async (n) => {
          const res = await fetch(`./${kind}/${n}.mp3`);
          if (!res.ok) throw new Error(kind === 'guitar' ? 'Die Gitarrenklänge konnten nicht geladen werden.' : 'Die Klavierklänge konnten nicht geladen werden.');
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          return { pitch: pitchOf(n), data: buf.getChannelData(0).slice(), rate: buf.sampleRate };
        }));
        // decodeAudioData gives the rate of the audio context; all samples share it
        await sendSamples(kind, decoded.map((d) => d.pitch), decoded.map((d) => d.data), decoded[0].rate);
      })();
      this.samplesLoaded.set(kind, loaded);
      loaded.catch(() => this.samplesLoaded.delete(kind));
    }
    return loaded;
  }

  /**
   * Renders the sound for [score] (a few seconds for a long piece); nothing if it is ready. It
   * is done ahead, right after the recognition, so that nothing heavy runs when playing starts.
   */
  prepare(score: PieceScore, bpm: number, instrument: string): Promise<void> {
    const p = this.preparedFor;
    if (p && p.score === score && p.bpm === bpm && p.instrument === instrument && this.buffer) return Promise.resolve();
    const w = this.preparing;
    if (w && w.score === score && w.bpm === bpm && w.instrument === instrument) return w.done;
    const done = this.render(score, bpm, instrument);
    this.preparing = { score, bpm, instrument, done };
    done.catch(() => undefined).finally(() => {
      if (this.preparing?.done === done) this.preparing = null;
    });
    return done;
  }

  private preparing: { score: PieceScore; bpm: number; instrument: string; done: Promise<void> } | null = null;

  private async render(score: PieceScore, bpm: number, instrument: string): Promise<void> {
    this.context();
    await this.loadSamples(instrument === GUITAR ? 'guitar' : 'piano');
    const { audio, rate } = await render(encode(score), score.bassStaves, score.tpq, bpm, instrument);
    const buffer = this.ctx!.createBuffer(1, Math.max(1, audio.length), rate);
    buffer.copyToChannel(audio, 0);
    // a newer request may have finished first
    if (this.preparing && this.preparing.score === score && this.preparing.bpm === bpm && this.preparing.instrument === instrument) {
      this.buffer = buffer;
      this.preparedFor = { score, bpm, instrument };
    }
  }

  play(fromTick: number): void {
    if (!this.ctx || !this.buffer || !this.preparedFor) return;
    this.stop();
    const { bpm, score } = this.preparedFor;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.onEnded?.();
      }
    };
    this.startTick = fromTick;
    this.startedAt = this.ctx.currentTime;
    src.start(0, secondsOf(fromTick, bpm, score.tpq));
    this.source = src;
  }

  stop(): void {
    const s = this.source;
    this.source = null;
    try {
      s?.stop();
    } catch {
      // already stopped
    }
  }

  get playing(): boolean {
    return this.source !== null;
  }

  /** The musical position now, in ticks. */
  currentTick(): number {
    if (!this.ctx || !this.preparedFor || !this.source) return this.startTick;
    const { bpm, score } = this.preparedFor;
    return this.startTick + ticksOf(this.ctx.currentTime - this.startedAt, bpm, score.tpq);
  }
}
