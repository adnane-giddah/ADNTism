// Local storage safety: kinds, corruption, import/export, versioning.
import { beforeEach, describe, expect, it } from 'vitest';
import { exportAll, importAll, journal, migrate, parseRecordId, pushRun, setNote, stats, STORAGE_VERSION } from '../src/core/records';

beforeEach(() => localStorage.clear());

describe('run kinds', () => {
  it('practice and challenge runs never affect best or stats', () => {
    pushRun('zero', 0.05, 'lower', { kind: 'ranked', seed: 1 });
    pushRun('zero', 0.001, 'lower', { kind: 'practice', seed: 2 });
    pushRun('zero', 0.002, 'lower', { kind: 'challenge', seed: 3 });
    const s = stats('zero', 'lower');
    expect(s.best).toBe(0.05);
    expect(s.n).toBe(1);
    expect(s.all).toBe(3);
  });
  it('daily runs count and are found by date', () => {
    pushRun('stop', 2, 'lower', { kind: 'daily', daily: '2026-10-11' });
    pushRun('stop', 1, 'lower', { kind: 'daily', daily: '2026-10-11' });
    const s = stats('stop', 'lower');
    expect(s.dailyCount('2026-10-11')).toBe(2);
    expect(s.dailyBest('2026-10-11')).toBe(1);
    expect(s.best).toBe(1);
  });
  it('invalid scores are refused, not stored', () => {
    expect(pushRun('zero', NaN, 'lower', { kind: 'ranked' }).recorded).toBe(false);
    expect(pushRun('zero', Infinity, 'lower', { kind: 'ranked' }).recorded).toBe(false);
    expect(pushRun('zero', -1, 'lower', { kind: 'ranked' }).recorded).toBe(false);
    expect(stats('zero', 'lower').all).toBe(0);
  });
});

describe('robust stats', () => {
  it('median and spread need 3 runs', () => {
    pushRun('exact', 2, 'lower', { kind: 'ranked' });
    pushRun('exact', 3, 'lower', { kind: 'ranked' });
    expect(stats('exact', 'lower').median10).toBeNull();
    pushRun('exact', 4, 'lower', { kind: 'ranked' });
    expect(stats('exact', 'lower').median10).toBe(3);
    expect(stats('exact', 'lower').spread10).toBe(1);
  });
  it('trend is undefined (null) when early runs are ~0, instead of a nonsense percentage', () => {
    for (let i = 0; i < 5; i++) pushRun('echo', 0, 'lower', { kind: 'ranked' });
    for (let i = 0; i < 5; i++) pushRun('echo', 5, 'lower', { kind: 'ranked' });
    expect(stats('echo', 'lower').trend).toBeNull();
  });
});

describe('corrupted storage', () => {
  it('never throws and drops bad runs', () => {
    localStorage.setItem('eps:rec:zero', '{not json');
    expect(stats('zero', 'lower').n).toBe(0);
    localStorage.setItem('eps:rec:zero', JSON.stringify({ runs: [{ s: 'x', t: 1 }, { s: 0.1, t: 2 }, null, { s: NaN, t: 3 }], n: 4, best: -5 }));
    const s = stats('zero', 'lower');
    expect(s.all).toBe(1);
    expect(s.best).toBe(0.1);
  });
  it('reads version-1 runs (no kind) as ranked / daily', () => {
    localStorage.setItem('eps:rec:zero', JSON.stringify({ runs: [{ s: 0.2, t: 1 }, { s: 0.1, t: 2, d: '2026-10-07' }], n: 2, best: 0.1 }));
    const s = stats('zero', 'lower');
    expect(s.n).toBe(2);
    expect(s.dailyCount('2026-10-07')).toBe(1);
    migrate();
    expect(localStorage.getItem('eps:version')).toBe(String(STORAGE_VERSION));
  });
});

describe('journal', () => {
  it('lists runs newest first with game, level and mode', () => {
    pushRun('drift.hard~net', 1.2, 'lower', { kind: 'ranked', seed: 99 });
    const j = journal();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ game: 'drift', level: 'hard', mode: 'net', seed: 99, kind: 'ranked' });
  });
  it('stores and clears notes', () => {
    const { t } = pushRun('zero', 0.03, 'lower', { kind: 'ranked' }) as { t: number };
    setNote('zero', t, '  cold hands  ');
    expect(journal()[0].note).toBe('cold hands');
    setNote('zero', t, '');
    expect(journal()[0].note).toBeUndefined();
  });
  it('parses record ids', () => {
    expect(parseRecordId('exact')).toEqual({ game: 'exact', level: 'medium', mode: undefined });
    expect(parseRecordId('exact.hard~keyboard')).toEqual({ game: 'exact', level: 'hard', mode: 'keyboard' });
  });
});

describe('backup', () => {
  it('round-trips and merges without duplicates', () => {
    pushRun('zero', 0.05, 'lower', { kind: 'ranked' });
    const dump = exportAll();
    expect(JSON.parse(dump).v).toBe(STORAGE_VERSION);
    localStorage.clear();
    expect(importAll(dump)).toBe(1);
    expect(importAll(dump)).toBe(0); // second import adds nothing
    expect(stats('zero', 'lower').best).toBe(0.05);
  });
  it('rejects foreign and future files', () => {
    expect(() => importAll('nope')).toThrow();
    expect(() => importAll(JSON.stringify({ app: 'other', data: {} }))).toThrow();
    expect(() => importAll(JSON.stringify({ app: 'epsilon', v: 99, data: {} }))).toThrow();
  });
  it('ignores keys that are not record ids', () => {
    importAll(JSON.stringify({ app: 'epsilon', v: 2, data: { 'eps:rec:../../x': { runs: [{ s: 1, t: 1 }] }, 'eps:settings': {} } }));
    expect(journal()).toHaveLength(0);
  });
});
