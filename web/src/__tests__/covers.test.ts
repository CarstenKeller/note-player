import { describe, expect, it } from 'vitest';
import { norm, pickItunes, pickWikipedia } from '../covers';

describe('cover search', () => {
  it('compares names without case, accents and additions', () => {
    expect(norm('Love Bites (Remastered 2017)')).toBe('love bites');
    expect(norm('Jeanny – Teil 1')).toBe('jeanny teil 1');
    expect(norm('Café Größe')).toBe('cafe große');
  });

  it('takes the song with the same title and performer from iTunes, larger', () => {
    const results = [
      { trackName: 'Love Bites (So Do I)', artistName: 'Halestorm', artworkUrl100: 'https://x/a/100x100bb.jpg' },
      { trackName: 'Love Bites', artistName: 'Def Leppard', artworkUrl100: 'https://x/b/100x100bb.jpg' },
    ];
    expect(pickItunes(results, 'Love Bites', 'Def Leppard')).toBe('https://x/b/600x600bb.jpg');
    expect(pickItunes(results, 'Love Bites', 'Queen')).toBeNull();
    expect(pickItunes(results, 'Hysteria', 'Def Leppard')).toBeNull();
  });

  it('takes a Wikipedia page about the song, or about the performer', () => {
    const pages = [
      { title: 'Hysteria (Def Leppard album)', index: 1, thumbnail: { source: 'album.jpg' } },
      { title: 'Love Bites (Def Leppard song)', index: 2, thumbnail: { source: 'song.jpg' } },
      { title: 'Def Leppard', index: 3, thumbnail: { source: 'band.jpg' } },
    ];
    expect(pickWikipedia(pages, 'Love Bites', 'Def Leppard')).toBe('song.jpg');
    expect(pickWikipedia(pages, 'Bites', 'Def Leppard')).toBe('song.jpg');
    expect(pickWikipedia(pages, 'Rocket', 'Def Leppard')).toBeNull();
    expect(pickWikipedia(pages, 'Rocket', 'Def Leppard', true)).toBe('band.jpg');
    // without performer: only a page of that very name
    expect(pickWikipedia(pages, 'Bites', '')).toBeNull();
    expect(pickWikipedia(pages, 'Love Bites', '')).toBe('song.jpg');
  });
});
