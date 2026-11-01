// Laying out photographed or scanned sheets on A4 pages: each sheet is cut between its systems
// (rows of staves, with their tablatures) and the pieces are set one after the other, all with
// staves of the same size and their left ends one above the other, as in a printed edition.

import type { Box } from './score';

/** A4 in millimetres, with the printable area inside [margin]. */
export const A4 = { width: 210, height: 297, margin: 12 };

/** Size of a staff space on paper at most (mm); 1.75–2 mm is common in printed music. */
const MAX_SPACE_MM = 1.9;
/** Room left of the staves for instrument names and braces, in staff spaces. */
const LEFT_ROOM = 6;
/** Room right of the staves, in staff spaces. */
const RIGHT_ROOM = 1.5;
/** Room before a sheet without staves that follows other sheets (mm). */
const SPACE_BEFORE_TEXT = 8;
/** A row with less dark than this share is empty. */
const EMPTY = 0.002;

/** What a sheet gives to the layout (pixels of its straightened page). */
export interface SheetGeometry {
  width: number;
  height: number;
  /** Staff space; 0 when no staves were found. */
  staffSpace: number;
  /** The systems with their tablatures, top to bottom. */
  rows: Box[];
  /** Share of dark pixels of each row of pixels (between the left and right end of the cut). */
  ink: Float32Array;
}

/** A part of a sheet: rows [y0, y1) and columns [x0, x1) of its picture. */
export interface Cut { x0: number; y0: number; x1: number; y1: number }

/** A cut placed on a page (millimetres from the top left corner of the page). */
export interface Placed { sheet: number; cut: Cut; x: number; y: number; w: number; h: number }

/** A staff as the recognition gives it: its box, its system, its clef. */
export interface StaffBox { box: Box; system: number; clef: string }

/**
 * The music rows of a sheet: systems, each with the tablatures right below it. The two staves
 * of a piano (treble above bass) always stay together, also when the recognition took them for
 * two systems (in photos the brace joining them is often not found): a treble staff and a bass
 * staff right below it, as near as the staves within the other systems (or, without such, as
 * near as piano staves are), make one row.
 */
export function musicRows(staves: StaffBox[], tabs: Box[], staffSpace: number): Box[] {
  const bySystem = new Map<number, StaffBox[]>();
  for (const st of staves) bySystem.set(st.system, [...(bySystem.get(st.system) ?? []), st]);
  const groups = [...bySystem.values()].map((g) => g.sort((a, b) => a.box[1] - b.box[1])).sort((a, b) => a[0].box[1] - b[0].box[1]);
  // distances between the staves within a system
  const inner = groups.flatMap((g) => g.slice(1).map((st, k) => st.box[1] - g[k].box[3])).sort((a, b) => a - b);
  const near = inner.length > 0 ? 1.4 * inner[Math.floor(inner.length / 2)] : 9 * staffSpace;
  const joined: StaffBox[][] = [];
  for (const g of groups) {
    const prev = joined[joined.length - 1];
    const last = prev?.[prev.length - 1];
    if (last && last.clef === 'TREBLE' && g[0].clef === 'BASS' && prev.length === 1 && g[0].box[1] - last.box[3] <= near) prev.push(...g);
    else joined.push([...g]);
  }
  const rows = joined.map((g): Box => [
    Math.min(...g.map((s) => s.box[0])), Math.min(...g.map((s) => s.box[1])),
    Math.max(...g.map((s) => s.box[2])), Math.max(...g.map((s) => s.box[3])),
  ]);
  for (const t of tabs) {
    const above = rows.filter((r) => r[1] < t[1] && t[1] - r[3] < 16 * staffSpace).sort((a, b) => b[1] - a[1])[0];
    if (above) {
      above[0] = Math.min(above[0], t[0] + staffSpace);
      above[2] = Math.max(above[2], t[2] - staffSpace);
      above[3] = Math.max(above[3], t[3]);
    } else {
      rows.push([t[0] + staffSpace, t[1], t[2] - staffSpace, t[3]]);
    }
  }
  return rows.sort((a, b) => a[1] - b[1]);
}

/** The columns of the cuts of a sheet: the staves with room left and right of them. */
export function columnsOf(rows: Box[], staffSpace: number, width: number): [number, number] {
  if (rows.length === 0 || staffSpace <= 0) return [0, width];
  return [
    Math.max(0, Math.min(...rows.map((r) => r[0])) - LEFT_ROOM * staffSpace),
    Math.min(width, Math.max(...rows.map((r) => r[2])) + RIGHT_ROOM * staffSpace),
  ];
}

/** Runs of empty rows of pixels in [from, to): [start, end) each. */
function emptyRuns(ink: Float32Array, from: number, to: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let y = Math.max(0, Math.floor(from)); y < Math.min(ink.length, Math.ceil(to)); y++) {
    if (ink[y] < EMPTY) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      runs.push([start, y]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, Math.min(ink.length, Math.ceil(to))]);
  return runs;
}

const firstInk = (ink: Float32Array) => Math.max(0, ink.findIndex((v) => v >= EMPTY));
const lastInk = (ink: Float32Array) => {
  for (let y = ink.length - 1; y >= 0; y--) if (ink[y] >= EMPTY) return y + 1;
  return ink.length;
};

/**
 * Cuts a sheet into pieces of one system each. [keepHead]: the first piece starts at the top
 * of the printed area (title); else above the first system, without a running head. Footers
 * (page numbers, copyright) are left out.
 */
export function cutSheet(g: SheetGeometry, keepHead: boolean): Cut[] {
  const ss = g.staffSpace;
  const rows = g.rows;
  if (rows.length === 0 || ss <= 0) {
    // no staves (song sheet, text): the printed area as it is
    return [{ x0: 0, y0: Math.max(0, firstInk(g.ink) - 8), x1: g.width, y1: Math.min(g.height, lastInk(g.ink) + 8) }];
  }
  const [x0, x1] = columnsOf(rows, ss, g.width);

  // between two systems: in the middle of the widest empty band (chord names above and lyrics
  // below a system stay with it); without one, where there is least ink
  const between: number[] = [];
  // what belongs to a system, learnt from the gaps between systems: how far its chord names and
  // lyrics reach above and below it, and how wide the empty bands within are
  let reachAbove = 0;
  let reachBelow = 0;
  let innerGap = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    const from = rows[i][3] + 0.5 * ss;
    const to = rows[i + 1][1] - 0.5 * ss;
    if (to <= from) {
      between.push(Math.round((rows[i][3] + rows[i + 1][1]) / 2));
      continue;
    }
    const runs = emptyRuns(g.ink, from, to);
    if (runs.length > 0) {
      const widest = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      between.push(Math.round((widest[0] + widest[1]) / 2));
      reachBelow = Math.max(reachBelow, widest[0] - rows[i][3]);
      reachAbove = Math.max(reachAbove, rows[i + 1][1] - widest[1]);
      for (const r of runs) if (r !== widest) innerGap = Math.max(innerGap, r[1] - r[0]);
    } else {
      let best = Math.round(from);
      for (let y = Math.round(from); y < to; y++) if (g.ink[y] < g.ink[best]) best = y;
      between.push(best);
    }
  }

  // above the first and below the last system: what is as near as chord names and lyrics are
  // to the other systems; what is farther or after a wider gap is a running head or a footer
  // (title, page number, copyright). Without other systems: common distances.
  if (rows.length < 2) {
    reachAbove = 6 * ss;
    reachBelow = 6 * ss;
    innerGap = 1.5 * ss;
  }
  const maxGap = Math.max(1.25 * innerGap + 0.3 * ss, 1.5 * ss);
  const first = rows[0];
  const last = rows[rows.length - 1];
  // upwards from the first system: bands of ink as long as the empty band before them is not
  // wider than [gapLimit] and they are not farther than [reach]; what touches the system
  // belongs to it, but not beyond [reach] (the dark table around a photographed page)
  const walkUp = (gapLimit: number, reach: number) => {
    const runs = emptyRuns(g.ink, 0, first[1]).reverse();
    let edge = Math.max(runs[0]?.[1] ?? firstInk(g.ink), first[1] - Math.max(reach, 6 * ss));
    let gap = ss;
    for (const [k, r] of runs.entries()) {
      gap = r[1] - r[0];
      const bandTop = runs[k + 1]?.[1] ?? firstInk(g.ink);
      if (r[0] === 0 || gap > gapLimit || first[1] - bandTop > reach) break;
      edge = bandTop;
    }
    return Math.max(0, Math.round(edge - Math.min(ss, gap / 2)));
  };
  // the first sheet keeps its title (separated from it only by a wide empty band: the frame
  // of a screenshot, the edge of a photo)
  const top = keepHead ? walkUp(Math.max(maxGap, 8 * ss), 30 * ss) : walkUp(maxGap, reachAbove + ss);
  // downwards from the last system, in the same way
  const runs = emptyRuns(g.ink, last[3], g.height);
  const reach = reachBelow + ss;
  let edge = Math.min(runs[0]?.[0] ?? lastInk(g.ink), last[3] + Math.max(reach, 6 * ss));
  let gap = ss;
  for (const [k, r] of runs.entries()) {
    gap = r[1] - r[0];
    const bandEnd = runs[k + 1]?.[0] ?? lastInk(g.ink);
    if (r[1] >= g.height || gap > maxGap || bandEnd - last[3] > reach) break;
    edge = bandEnd;
  }
  const bottom = Math.min(g.height, Math.round(edge + Math.min(ss, gap / 2)));

  const edges = [top, ...between, Math.max(bottom, top + 1)];
  const cuts: Cut[] = [];
  for (let i = 0; i + 1 < edges.length; i++) if (edges[i + 1] > edges[i]) cuts.push({ x0, y0: edges[i], x1, y1: edges[i + 1] });
  return cuts;
}

/**
 * Sets the cuts of the sheets on A4 pages, one below the other; a page ends before a cut that
 * does not fit. All staves get the same size (as large as the widest system allows, at most a
 * common print size) and their left ends stand one above the other.
 */
export function layoutCuts(sheets: { g: SheetGeometry; cuts: Cut[] }[], page = A4): Placed[][] {
  const width = page.width - 2 * page.margin;
  const height = page.height - 2 * page.margin;
  // size of a staff space on paper
  let space = MAX_SPACE_MM;
  for (const { g } of sheets) {
    if (g.rows.length === 0 || g.staffSpace <= 0) continue;
    const staffWidth = (Math.max(...g.rows.map((r) => r[2])) - Math.min(...g.rows.map((r) => r[0]))) / g.staffSpace;
    space = Math.min(space, width / (staffWidth + LEFT_ROOM + RIGHT_ROOM));
  }
  const staffX = page.margin + LEFT_ROOM * space;

  const pages: Placed[][] = [[]];
  let y = 0;
  sheets.forEach(({ g, cuts }, sheet) => {
    const music = g.rows.length > 0 && g.staffSpace > 0;
    const left = music ? Math.min(...g.rows.map((r) => r[0])) : 0;
    // a sheet of text (no staves) is set apart from the music before it
    if (!music && y > 0) y += SPACE_BEFORE_TEXT;
    for (const cut of cuts) {
      // millimetres per pixel: same staff size; a sheet without staves as wide as the page
      let f = music ? space / g.staffSpace : width / (cut.x1 - cut.x0);
      let h = (cut.y1 - cut.y0) * f;
      if (h > height) {
        f *= height / h;
        h = height;
      }
      const w = (cut.x1 - cut.x0) * f;
      const x = music ? staffX - (left - cut.x0) * f : page.margin;
      if (y + h > height && pages[pages.length - 1].length > 0) {
        pages.push([]);
        y = 0;
      }
      pages[pages.length - 1].push({ sheet, cut, x, y: page.margin + y, w, h });
      y += h;
    }
  });
  return pages.filter((p) => p.length > 0);
}
