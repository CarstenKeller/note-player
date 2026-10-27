// Playback: the piece is rendered as a whole (in the worker, with the recorded piano notes) and
// played with Web Audio; the musical position follows from the playback time.

import { render, sendSamples } from './engine';
import { secondsOf, ticksOf, type PieceScore } from './score';

export const INSTRUMENTS: { id: string; label: string }[] = [
  { id: 'GRAND_PIANO', label: 'Flügel' },
  { id: 'ELECTRIC_PIANO', label: 'E-Piano' },
  { id: 'ORGAN', label: 'Orgel' },
  { id: 'HARP', label: 'Harfe' },
];

// recorded notes: C, D#, F#, A of each octave
const SAMPLE_NAMES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4',
  'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];

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
    out.push(e.start, e.start + e.duration, e.staff, e.pitches.length, ...e.pitches, e.holds.length, ...e.holds);
  }
  return Int32Array.from(out);
}

export class Player {
  private ctx: AudioContext | null = null;
  private samplesLoaded: Promise<void> | null = null;
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
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private loadSamples(): Promise<void> {
    if (!this.samplesLoaded) {
      this.samplesLoaded = (async () => {
        const ctx = this.ctx!;
        const decoded = await Promise.all(SAMPLE_NAMES.map(async (n) => {
          const res = await fetch(`./piano/${n}.mp3`);
          if (!res.ok) throw new Error('Die Klavierklänge konnten nicht geladen werden.');
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          return { pitch: pitchOf(n), data: buf.getChannelData(0).slice(), rate: buf.sampleRate };
        }));
        // decodeAudioData gives the rate of the audio context; all samples share it
        await sendSamples(decoded.map((d) => d.pitch), decoded.map((d) => d.data), decoded[0].rate);
      })();
      this.samplesLoaded.catch(() => (this.samplesLoaded = null));
    }
    return this.samplesLoaded;
  }

  /** Renders the sound for [score] (a few seconds for a long piece); nothing if it is ready. */
  async prepare(score: PieceScore, bpm: number, instrument: string): Promise<void> {
    const p = this.preparedFor;
    if (p && p.score === score && p.bpm === bpm && p.instrument === instrument && this.buffer) return;
    this.unlock();
    await this.loadSamples();
    const { audio, rate } = await render(encode(score), score.bassStaves, score.tpq, bpm, instrument);
    const buffer = this.ctx!.createBuffer(1, Math.max(1, audio.length), rate);
    buffer.copyToChannel(audio, 0);
    this.buffer = buffer;
    this.preparedFor = { score, bpm, instrument };
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
