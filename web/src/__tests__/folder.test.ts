import { describe, expect, it } from 'vitest';
import { importOrder, isSheetFile, sortedByName } from '../folder';

describe('sheets of a folder', () => {
  it('sorts names as people count', () => {
    const names = ['Seite 10.jpg', 'Seite 2.jpg', 'seite 1.jpg', 'Seite 1a.jpg', 'Anhang.pdf'];
    expect(sortedByName(names.map((name) => ({ name }))).map((f) => f.name)).toEqual(['Anhang.pdf', 'seite 1.jpg', 'Seite 1a.jpg', 'Seite 2.jpg', 'Seite 10.jpg']);
  });

  it('takes pictures and PDFs only', () => {
    expect(['a.JPG', 'b.pdf', 'c.heic', 'notes.txt', '.DS_Store', 'd.png'].filter((name) => isSheetFile({ name }))).toEqual(['a.JPG', 'b.pdf', 'c.heic', 'd.png']);
  });
});

describe('the order of chosen files', () => {
  const file = (name: string) => new File([], name);
  it('sorts files with names of their own', () => {
    expect(importOrder([file('S 3.png'), file('S 1.png'), file('S 2.png')]).map((f) => f.name)).toEqual(['S 1.png', 'S 2.png', 'S 3.png']);
  });
  it('keeps the order of photos from the photo library', () => {
    expect(importOrder([file('image.jpg'), file('image.jpg')]).length).toBe(2);
    expect(importOrder([file('IMG_0012.jpg'), file('IMG_0003.jpg')]).map((f) => f.name)).toEqual(['IMG_0012.jpg', 'IMG_0003.jpg']);
  });
});
