import { describe, expect, it } from 'vitest';
import { buildPdf, pdfName } from '../pdfexport';

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('PDF of the sheets', () => {
  // a stand-in for the picture data: the PDF only copies it
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

  it('puts each picture on a page of A4 width (upright) or height (wide)', () => {
    const pdf = text(buildPdf([{ jpeg, width: 1000, height: 1414 }, { jpeg, width: 2000, height: 1000 }]));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.73]');
    expect(pdf).toContain('/MediaBox [0 0 1190.56 595.28]');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('gives the right positions of the objects', () => {
    const bytes = buildPdf([{ jpeg, width: 10, height: 20 }]);
    const pdf = text(bytes);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`.slice(0, 8)));
  });

  it('names the file after the piece', () => {
    expect(pdfName({ name: 'Love Bites', artist: 'Def Leppard' } as never)).toBe('Love Bites – Def Leppard.pdf');
    expect(pdfName({ name: 'AC/DC: Hells Bells' } as never)).toBe('AC_DC_ Hells Bells.pdf');
  });
});
