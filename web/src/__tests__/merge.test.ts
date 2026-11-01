import { describe, expect, it } from 'vitest';
import { planMerge } from '../backup';

const p = (id: string, created: number, modified?: number) => ({ id, created, modified });

describe('taking over the library of another device', () => {
  it('adds new pieces and takes the newer change', () => {
    const plan = planMerge(
      { pieces: [p('a', 1, 5), p('b', 1, 9)], deleted: {} },
      { pieces: [p('a', 1, 7), p('b', 1, 8), p('c', 3)], deleted: {} },
    );
    expect(plan.take.sort()).toEqual(['a', 'c']);
    expect(plan.remove).toEqual([]);
  });

  it('deletes what was deleted there after its last change here', () => {
    const plan = planMerge(
      { pieces: [p('a', 1, 5), p('b', 1, 9)], deleted: {} },
      { pieces: [], deleted: { a: 6, b: 7 } },
    );
    // b was changed here after it was deleted there: it stays
    expect(plan.remove).toEqual([{ id: 'a', time: 6 }]);
    expect(plan.deleted).toEqual({ a: 6, b: 7 });
  });

  it('does not bring back what was deleted here', () => {
    const plan = planMerge(
      { pieces: [], deleted: { a: 6 } },
      { pieces: [p('a', 1, 5), p('b', 1, 8)], deleted: {} },
    );
    expect(plan.take).toEqual(['b']);
    // ... unless it was changed there after it was deleted here
    expect(planMerge({ pieces: [], deleted: { a: 6 } }, { pieces: [p('a', 1, 7)], deleted: {} }).take).toEqual(['a']);
  });

  it('pieces of older backups (without change time) count from when they were made', () => {
    expect(planMerge({ pieces: [p('a', 4)], deleted: {} }, { pieces: [p('a', 2)], deleted: {} }).take).toEqual([]);
  });
});
