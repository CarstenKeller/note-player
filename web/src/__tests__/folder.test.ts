import { describe, expect, it } from 'vitest';
import { importOrder, isSheetFile, sortedByName, sortedByTime } from '../folder';

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
  const file = (name: string, time = 0) => new File([], name, { lastModified: time });
  it('sorts files with names of their own', () => {
    expect(importOrder([file('S 3.png'), file('S 1.png'), file('S 2.png')]).map((f) => f.name)).toEqual(['S 1.png', 'S 2.png', 'S 3.png']);
  });
  it('keeps the order of photos from the photo library', () => {
    expect(importOrder([file('image.jpg'), file('image.jpg')]).length).toBe(2);
    expect(importOrder([file('IMG_0012.jpg'), file('IMG_0003.jpg')]).map((f) => f.name)).toEqual(['IMG_0012.jpg', 'IMG_0003.jpg']);
  });
});

describe('the order of saving', () => {
  const file = (name: string, time: number) => ({ name, lastModified: time });
  it('goes by the time a file was saved, then by its name', () => {
    const files = [file('Screenshot b.png', 5000), file('Screenshot a.png', 9000), file('Seite 2.png', 1000), file('Seite 10.png', 1400)];
    // 1000 and 1400 ms are the same second: by name
    expect(sortedByTime(files).map((f) => f.name)).toEqual(['Seite 2.png', 'Seite 10.png', 'Screenshot b.png', 'Screenshot a.png']);
  });

  it('chosen files with times go by them, photos of the same time keep their order', () => {
    expect(importOrder([new File([], 'image.jpg', { lastModified: 9000 }), new File([], 'image.jpg', { lastModified: 2000 })]).map((f) => f.lastModified)).toEqual([2000, 9000]);
    expect(importOrder([new File([], 'IMG_9.jpg', { lastModified: 2000 }), new File([], 'IMG_1.jpg', { lastModified: 2000 })]).map((f) => f.name)).toEqual(['IMG_9.jpg', 'IMG_1.jpg']);
  });
});
