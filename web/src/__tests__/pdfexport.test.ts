import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { assemblePdf, pdfName } from '../pdfexport';

// a white JPEG of 8×8 pixels
const JPEG = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx' +
  'NDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF' +
  'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW' +
  'V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi' +
  '4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC' +
  'AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm' +
  'Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq' +
  '8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
), (c) => c.charCodeAt(0));

async function original(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const s of sizes) doc.addPage(s);
  return doc.save();
}

describe('PDF of the sheets', () => {
  it('takes pages of the original files and pictures, in the order of the sheets', async () => {
    const a = await original([[100, 200], [300, 400], [500, 600]]);
    const pdf = await PDFDocument.load(await assemblePdf([
      { pdf: a, page: 3 },
      { jpeg: JPEG, width: 1000, height: 1414 },
      { jpeg: JPEG, width: 2000, height: 1000 },
      { pdf: a, page: 1 },
    ]));
    expect(pdf.getPages().map((p) => p.getSize()).map(({ width, height }) => [Math.round(width), Math.round(height)]))
      .toEqual([[500, 600], [595, 842], [1191, 595], [100, 200]]);
  });

  it('makes pictures of pages it cannot copy', async () => {
    const broken = new Uint8Array([1, 2, 3]);
    const pdf = await PDFDocument.load(await assemblePdf([{ pdf: broken, page: 1 }], async () => ({ jpeg: JPEG, width: 8, height: 8 })));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('names the file after the piece', () => {
    expect(pdfName({ name: 'Love Bites', artist: 'Def Leppard' } as never)).toBe('Love Bites – Def Leppard.pdf');
    expect(pdfName({ name: 'AC/DC: Hells Bells' } as never)).toBe('AC_DC_ Hells Bells.pdf');
  });
});
