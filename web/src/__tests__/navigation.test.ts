import { describe, expect, it } from 'vitest';
import { navigationOf, readJumpWords } from '../navigation';
import { linesFromPlain } from '../guitar/text';

const plain = (text: string) => linesFromPlain(text, { left: 0, top: 0, charWidth: 10, lineHeight: 20 });

describe('jump words', () => {
  it('reads D.S./D.C. with "al Coda"/"al Fine", To Coda, Coda and Fine', () => {
    const words = readJumpWords(plain('To Coda    D.S. al Coda\nCoda\nFine   D.C. al Fine\nDal Segno   Da Capo'));
    expect(words.map((w) => w.word + (w.al ? ' al ' + w.al : ''))).toEqual(['TOCODA', 'DS al coda', 'CODA', 'FINE', 'DC al fine', 'DS', 'DC']);
  });

  it('takes no other words', () => {
    expect(readJumpWords(plain('Words and Music by D. Smith\nfinely sung'))).toEqual([]);
  });
});

describe('jumps from words and signs', () => {
  const at = (system: number, measure: number, x = 100 + measure * 200) => ({ sheet: 0, system, x, measure });
  it('D.S. al Coda goes to the segno before it, leaves at "To Coda" for the coda after it', () => {
    const nav = navigationOf(
      [
        { word: 'TOCODA', box: [0, 0, 0, 0], spot: at(1, 1) },
        { word: 'DS', al: 'coda', box: [0, 0, 0, 0], spot: at(1, 3) },
      ],
      [{ kind: 'segno', spot: at(1, 0, 50) }, { kind: 'coda', spot: at(1, 1, 290) }, { kind: 'coda', spot: at(2, 0, 50) }],
    );
    expect(nav).toEqual([{ kind: 'DS', at: at(1, 3), to: at(1, 0, 50), toCoda: at(1, 1), coda: at(2, 0, 50) }]);
  });
  it('without "To Coda" the coda sign before the D.S. marks where to leave', () => {
    const nav = navigationOf([{ word: 'DS', al: 'coda', box: [0, 0, 0, 0], spot: at(1, 3) }], [
      { kind: 'segno', spot: at(0, 1, 50) }, { kind: 'coda', spot: at(1, 1, 290) }, { kind: 'coda', spot: at(2, 0, 50) },
    ]);
    expect(nav[0].toCoda).toEqual(at(1, 1, 290));
  });
});
