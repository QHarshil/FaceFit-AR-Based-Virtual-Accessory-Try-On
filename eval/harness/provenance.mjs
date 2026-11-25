// The commit a measurement belongs to. A run reads it when it starts and
// checks it again before writing, so a commit made during a run of several
// minutes cannot label results built from the commit before it.
import { execFileSync } from 'node:child_process';

// What the harness and the sweep write; a dirty tree is allowed to differ here.
const RESULT_PATHS = ['eval/results.json', 'eval/results/'];

export const gitIn = (dir) => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

/** Lines of `git status --porcelain` outside the result files. */
export const dirtyPaths = (git) => git('status', '--porcelain').split('\n')
  // The status letters, then the path; trimming the output can drop the first line's leading space.
  .filter((line) => line && !RESULT_PATHS.some((path) => line.replace(/^\s*\S+\s+/, '').startsWith(path)));

export const startCommit = (git) => git('rev-parse', 'HEAD');

/** Throws when HEAD is no longer `commit`, the one the run started from. */
export const assertHeadUnchanged = (git, commit) => {
  const head = git('rev-parse', 'HEAD');
  if (head !== commit) throw new Error(`HEAD moved from ${commit} to ${head} during the run`);
};
