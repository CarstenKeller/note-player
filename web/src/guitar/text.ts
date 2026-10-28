// Text on a sheet (from a PDF's text layer, pasted text or text recognition), as lines of
// characters with their positions on the page. Chord names and text tabs are read from it.

export interface TextChar {
  c: string;
  x0: number;
  x1: number;
}

export interface TextLine {
  y0: number;
  y1: number;
  chars: TextChar[];
}

export interface Token {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Index of the first character in the line. */
  start: number;
}

/** A piece of text with its box (one PDF text item, one recognized word, ...). */
export interface TextPiece {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Box of each character, if known (else spread evenly over the piece). */
  chars?: { x0: number; x1: number }[];
}

/**
 * Groups pieces into lines: pieces overlapping vertically by at least half of the smaller one
 * belong to one line (raised parts like the "7" of "G7" too); between pieces with a gap a
 * space is put in.
 */
export function linesFromPieces(pieces: TextPiece[]): TextLine[] {
  const sorted = pieces.filter((p) => p.str.length > 0 && p.y1 > p.y0).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const groups: TextPiece[][] = [];
  for (const p of sorted) {
    const g = groups.find((gr) => gr.some((q) => {
      const overlap = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
      return overlap >= 0.5 * Math.min(p.y1 - p.y0, q.y1 - q.y0);
    }));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const lines = groups.map((g) => {
    g.sort((a, b) => a.x0 - b.x0);
    const height = Math.max(...g.map((p) => p.y1 - p.y0));
    const chars: TextChar[] = [];
    let lastX1 = -Infinity;
    for (const p of g) {
      if (chars.length > 0 && p.x0 - lastX1 > 0.25 * height && chars[chars.length - 1].c !== ' ') {
        chars.push({ c: ' ', x0: lastX1, x1: p.x0 });
      }
      const n = p.str.length;
      for (let i = 0; i < n; i++) {
        const box = p.chars?.[i] ?? { x0: p.x0 + ((p.x1 - p.x0) * i) / n, x1: p.x0 + ((p.x1 - p.x0) * (i + 1)) / n };
        chars.push({ c: p.str[i], ...box });
      }
      lastX1 = Math.max(lastX1, p.x1);
    }
    return { y0: Math.min(...g.map((p) => p.y0)), y1: Math.max(...g.map((p) => p.y1)), chars };
  });
  return lines.sort((a, b) => a.y0 - b.y0);
}

/** Lines of plain (pasted) text drawn in a monospaced font: each character in its cell. */
export function linesFromPlain(text: string, geometry: { left: number; top: number; charWidth: number; lineHeight: number }): TextLine[] {
  return text.split(/\r?\n/).map((line, i) => ({
    y0: geometry.top + i * geometry.lineHeight,
    y1: geometry.top + (i + 1) * geometry.lineHeight,
    chars: [...line.replace(/\t/g, '    ')].map((c, k) => ({
      c,
      x0: geometry.left + k * geometry.charWidth,
      x1: geometry.left + (k + 1) * geometry.charWidth,
    })),
  }));
}

export function lineText(l: TextLine): string {
  return l.chars.map((c) => c.c).join('');
}

/** The words of a line (separated by spaces). */
export function tokens(l: TextLine): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < l.chars.length) {
    if (/\s/.test(l.chars[i].c)) { i++; continue; }
    const start = i;
    while (i < l.chars.length && !/\s/.test(l.chars[i].c)) i++;
    out.push({
      text: l.chars.slice(start, i).map((c) => c.c).join(''),
      x0: l.chars[start].x0,
      x1: l.chars[i - 1].x1,
      y0: l.y0,
      y1: l.y1,
      start,
    });
  }
  return out;
}

/** Scales all positions (the page shown can be smaller than the picture the text came from). */
export function scaleLines(lines: TextLine[], f: number): TextLine[] {
  if (Math.abs(f - 1) < 1e-6) return lines;
  return lines.map((l) => ({ y0: l.y0 * f, y1: l.y1 * f, chars: l.chars.map((c) => ({ c: c.c, x0: c.x0 * f, x1: c.x1 * f })) }));
}
