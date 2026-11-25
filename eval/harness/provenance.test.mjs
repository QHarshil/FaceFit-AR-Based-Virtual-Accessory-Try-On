import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertHeadUnchanged, dirtyPaths, gitIn, startCommit } from './provenance.mjs';

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-'));
  const git = gitIn(dir);
  git('init', '-q');
  git('config', 'user.email', 'harness@example.com');
  git('config', 'user.name', 'harness');
  git('config', 'commit.gpgsign', 'false');
  const commit = (file) => {
    writeFileSync(join(dir, file), file);
    git('add', file);
    git('commit', '-q', '-m', file);
  };
  return { dir, git, commit };
};

test('a run keeps the commit it started from and refuses to write once HEAD moves', () => {
  const { dir, git, commit } = repo();
  try {
    commit('a.txt');
    const started = startCommit(git);
    assert.equal(started, git('rev-parse', 'HEAD'));
    assert.doesNotThrow(() => assertHeadUnchanged(git, started));
    commit('b.txt');
    assert.throws(() => assertHeadUnchanged(git, started), /HEAD moved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dirtyPaths ignores the result files a run writes', () => {
  const { dir, git, commit } = repo();
  try {
    mkdirSync(join(dir, 'eval', 'results'), { recursive: true });
    commit('eval/results.json');
    writeFileSync(join(dir, 'eval', 'results.json'), 'changed');
    writeFileSync(join(dir, 'eval', 'results', 'pose-filter-sweep.json'), '{}');
    assert.deepEqual(dirtyPaths(git), []);
    writeFileSync(join(dir, 'a.txt'), 'new');
    assert.deepEqual(dirtyPaths(git), ['?? a.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
