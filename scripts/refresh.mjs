#!/usr/bin/env node
// Daily refresh of the profile card (launchd: com.nickadian.profile-stats).
// Rebuilds the card and pushes only when a number changed. The commit uses an
// email that is not on the GitHub account, so the refresh itself never counts
// as a contribution and cannot keep a streak alive.
//
// launchd runs this with node directly, not through a shell: macOS lets node
// read ~/Documents and refuses /bin/bash ("Operation not permitted").

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.PATH = `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const run = (cmd, ...args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (...args) => run('git', ...args);
const log = (message) => console.log(`${new Date().toISOString().slice(0, 19)} ${message}`);

try {
  if (git('status', '--porcelain')) throw new Error('working tree not clean, skipping');
  git('pull', '-q', '--ff-only', 'origin', 'main');
  run(process.execPath, 'scripts/build-stats.mjs');
  if (!git('status', '--porcelain', 'profile')) {
    log('no change');
  } else {
    git('add', 'profile');
    git('-c', 'user.name=profile-stats', '-c', 'user.email=profile-stats@localhost.invalid',
      'commit', '-q', '--no-verify', '-m', 'Refresh stats');
    git('push', '-q', 'origin', 'main');
    log(`pushed ${git('rev-parse', '--short', 'HEAD')}`);
  }
} catch (error) {
  log(`FAILED ${String(error.stderr || error.message).trim().split('\n').pop()}`);
  process.exit(1);
}
