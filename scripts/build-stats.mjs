#!/usr/bin/env node
// Builds profile/stats-dark.svg and profile/stats-light.svg.
//
//   node scripts/build-stats.mjs            # scan ~/Documents/GitHub
//   node scripts/build-stats.mjs <dir> ...  # scan other folders of clones
//
// Contributions and streaks come from GitHub (through the `gh` CLI, so private
// contributions are included). Lines of code come from the local clones: every
// non-merge commit authored by one of AUTHORS, on any branch, counted once
// across clones, with lockfiles, build output and generated files left out.
// No dependencies.

import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN_DIRS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [join(homedir(), 'Documents', 'GitHub')];

// Author emails that are me. Matched as substrings of the commit author email.
const AUTHORS = [
  'nickadian@users.noreply.github.com',
  'sales@rentaltide.com',
  'nick@rentaltide.com',
  'nick@nickadian.com',
];

// Not code somebody wrote: lockfiles, dependencies, build output, generated
// files, snapshots, and data (JSON, CSV, text dumps).
const SKIP = new RegExp(
  [
    '(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Podfile\\.lock|Cargo\\.lock|Gemfile\\.lock|composer\\.lock|poetry\\.lock|bun\\.lockb?)$',
    '(^|/)(node_modules|dist|dist-[^/]+|build|out|coverage|vendor|Pods|cdk\\.out|\\.nx|\\.next|\\.expo|\\.cache|__snapshots__|DerivedData)/',
    '\\.(min\\.(js|css)|map|snap|svg|csv|tsv|json|geojson|ld|txt|ipynb|pbxproj|xcworkspacedata|lock)$',
    '(\\.generated\\.|\\.gen\\.|-suppressions\\.json|\\.gitleaks-baseline)',
  ].join('|'),
);

// Commits that move lines without writing them: reverts, formatter runs,
// upstream template merges, and a first commit that imports a whole tree.
const SKIP_SUBJECT = /^(revert\b|formatting\b|prettyfy|prettify|prettier|chore\(upstream\))/i;
const IMPORT_LINES = 20000;

const LANGUAGES = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.sql': 'SQL', '.md': 'Markdown', '.mdx': 'Markdown',
  '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML',
  '.yml': 'YAML', '.yaml': 'YAML',
  '.swift': 'Swift', '.kt': 'Kotlin', '.java': 'Java', '.py': 'Python',
  '.rs': 'Rust', '.go': 'Go', '.rb': 'Ruby', '.sh': 'Shell', '.tf': 'Terraform',
};
const LANGUAGE_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', SQL: '#e38c00', Markdown: '#8b949e',
  CSS: '#563d7c', HTML: '#e34c26', JSON: '#6e7681', YAML: '#cb171e', Swift: '#f05138',
  Kotlin: '#a97bff', Java: '#b07219', Python: '#3572a5', Rust: '#dea584', Go: '#00add8',
  Ruby: '#701516', Shell: '#89e051', Terraform: '#844fba', Other: '#484f58',
};

// ───────────────────────────── contributions ─────────────────────────────

function gh(query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push('-f', `${k}=${v}`);
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 })).data;
}

function contributions() {
  const { viewer } = gh(
    '{viewer{login createdAt contributionsCollection{contributionYears}}}',
  );
  const days = [];
  for (const year of [...viewer.contributionsCollection.contributionYears].sort()) {
    const data = gh(
      'query($from:DateTime!,$to:DateTime!){viewer{contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}',
      { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const week of data.viewer.contributionsCollection.contributionCalendar.weeks)
      for (const day of week.contributionDays)
        days.push({ date: day.date, count: day.contributionCount });
  }
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const past = days.filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));

  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null, end: null };
  for (const day of past) {
    if (day.count > 0) {
      run = { length: run.length + 1, start: run.start ?? day.date, end: day.date };
      if (run.length > longest.length) longest = run;
    } else if (day.date !== today) {
      // A day with nothing ends the run, except today, which is not over yet.
      run = { length: 0, start: null, end: null };
    }
  }
  // Days with at least one contribution in the last 365 finished days (today
  // joins the window only once it has a contribution, so it never counts against).
  const finished = past.filter((d) => d.date !== today || d.count > 0).slice(-365);
  return {
    year: { worked: finished.filter((d) => d.count > 0).length, days: finished.length },
    login: viewer.login,
    since: viewer.createdAt.slice(0, 10),
    total: past.reduce((sum, d) => sum + d.count, 0),
    current: run,
    longest,
  };
}

// ───────────────────────────── lines of code ─────────────────────────────

function repos() {
  const found = [];
  for (const dir of SCAN_DIRS) {
    if (!existsSync(dir)) continue;
    if (existsSync(join(dir, '.git'))) found.push(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && existsSync(join(path, '.git'))) found.push(path);
    }
  }
  return [...new Set(found)];
}

async function scanRepo(repo, seen, totals) {
  const args = ['-C', repo, 'log', '--all', '--no-merges', '--numstat', '--format=@%H\t%P\t%s'];
  for (const author of AUTHORS) args.push(`--author=${author}`);
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let commit = null;
  let touched = false;
  const flush = () => {
    if (!commit) return;
    const imported = commit.root && commit.added > IMPORT_LINES;
    if (!imported && !SKIP_SUBJECT.test(commit.subject)) {
      totals.commits += 1;
      totals.added += commit.added;
      totals.removed += commit.removed;
      for (const [language, lines] of Object.entries(commit.languages))
        totals.languages[language] = (totals.languages[language] ?? 0) + lines;
      touched = true;
    }
    commit = null;
  };
  for await (const line of createInterface({ input: child.stdout })) {
    if (line[0] === '@') {
      flush();
      const [sha, parents, ...subject] = line.slice(1).split('\t');
      if (seen.has(sha)) continue; // the same commit in a second clone or a fork
      seen.add(sha);
      commit = { root: !parents, subject: subject.join('\t'), added: 0, removed: 0, languages: {} };
      continue;
    }
    if (!commit || !line) continue;
    const [added, removed, ...rest] = line.split('\t');
    if (added === '-') continue; // binary
    const path = rest.join('\t').replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '');
    if (SKIP.test(path)) continue;
    const a = Number(added);
    commit.added += a;
    commit.removed += Number(removed);
    const language = LANGUAGES[extname(path).toLowerCase()] ?? 'Other';
    commit.languages[language] = (commit.languages[language] ?? 0) + a;
  }
  flush();
  if (touched) totals.repos += 1;
}

async function linesOfCode() {
  const totals = { added: 0, removed: 0, commits: 0, repos: 0, languages: {} };
  const seen = new Set();
  for (const repo of repos()) {
    const before = totals.added;
    await scanRepo(repo, seen, totals);
    console.error(`  ${basename(repo).padEnd(28)} +${(totals.added - before).toLocaleString('en-US')}`);
  }
  return totals;
}

// ───────────────────────────────── card ─────────────────────────────────

const THEMES = {
  dark: {
    bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    accent: '#f0883e', add: '#3fb950', del: '#f85149', track: '#21262d',
  },
  light: {
    bg: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#656d76',
    accent: '#e8590c', add: '#1a7f37', del: '#cf222e', track: '#eaeef2',
  },
};

const n = (value) => Math.round(value).toLocaleString('en-US');
const day = (iso, withYear = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  });
const range = (streak) =>
  streak.length ? `${day(streak.start)} - ${day(streak.end)}` : 'No streak yet';
const compact = (value) =>
  value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e4 ? `${Math.round(value / 1e3)}K` : n(value);

function card(theme, stats) {
  const c = THEMES[theme];
  const W = 840;
  const H = 400;
  const font = `font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"`;

  const languages = Object.entries(stats.loc.languages).sort((a, b) => b[1] - a[1]);
  const top = languages.slice(0, 5);
  const rest = languages.slice(5).reduce((sum, [name, lines]) => sum + (name === 'Other' ? 0 : lines), 0)
    + (top.some(([name]) => name === 'Other') ? 0 : stats.loc.languages.Other ?? 0);
  const bars = (rest > 0 ? [...top.filter(([name]) => name !== 'Other'), ['Other', rest + (top.find(([name]) => name === 'Other')?.[1] ?? 0)]] : top);
  const barTotal = bars.reduce((sum, [, lines]) => sum + lines, 0) || 1;
  const barX = 40;
  const barW = W - 80;
  let x = barX;
  const segments = bars.map(([name, lines]) => {
    const width = (lines / barTotal) * barW;
    const rect = `<rect x="${x.toFixed(1)}" y="330" width="${width.toFixed(1)}" height="8" fill="${LANGUAGE_COLORS[name] ?? LANGUAGE_COLORS.Other}"/>`;
    x += width;
    return rect;
  });
  const legendStep = barW / bars.length;
  const legend = bars.map(([name, lines], i) => {
    const lx = barX + i * legendStep;
    return `<circle cx="${lx + 5}" cy="364" r="5" fill="${LANGUAGE_COLORS[name] ?? LANGUAGE_COLORS.Other}"/>` +
      `<text x="${lx + 16}" y="368" font-size="12" fill="${c.text}">${name} <tspan fill="${c.muted}">${((lines / barTotal) * 100).toFixed(1)}%</tspan></text>`;
  });

  const column = (cx, value, label, sub, color = c.text) =>
    `<text x="${cx}" y="96" text-anchor="middle" font-size="34" font-weight="700" fill="${color}">${value}</text>` +
    `<text x="${cx}" y="130" text-anchor="middle" font-size="15" fill="${c.text}">${label}</text>` +
    `<text x="${cx}" y="156" text-anchor="middle" font-size="12" fill="${c.muted}">${sub}</text>`;

  const tile = (cx, value, label, color) =>
    `<text x="${cx}" y="258" text-anchor="middle" font-size="26" font-weight="700" fill="${color}">${value}</text>` +
    `<text x="${cx}" y="282" text-anchor="middle" font-size="13" fill="${c.muted}">${label}</text>`;

  const ring = 2 * Math.PI * 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${stats.login}: ${n(stats.total)} contributions, ${stats.current.length} day streak, ${stats.year.worked} of ${stats.year.days} days worked, ${n(stats.loc.added)} lines added">
<g ${font}>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${c.bg}" stroke="${c.border}"/>
${column(135, n(stats.total), 'Total Contributions', `${day(stats.since, true)} - Present`)}
<line x1="230" y1="36" x2="230" y2="176" stroke="${c.border}"/>
<circle cx="325" cy="84" r="44" fill="none" stroke="${c.track}" stroke-width="6"/>
<circle cx="325" cy="84" r="44" fill="none" stroke="${c.accent}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(ring * 0.92).toFixed(1)} ${ring.toFixed(1)}" transform="rotate(-76 325 84)"/>
<path transform="translate(313 26) scale(1.5)" fill="${c.accent}" stroke="${c.bg}" stroke-width="2" paint-order="stroke" d="M8 16c3.3 0 6-2.5 6-5.8 0-2.3-1.2-4-2.6-5.5-.4 1.3-1 2-1.9 2.6C9.8 4.600 8.900 2.200 6.500 0c.2 2.300-.9 3.900-2.100 5.400C3.200 6.900 2 8.300 2 10.200 2 13.500 4.700 16 8 16z"/>
<text x="325" y="96" text-anchor="middle" font-size="34" font-weight="700" fill="${c.text}">${n(stats.current.length)}</text>
<text x="325" y="152" text-anchor="middle" font-size="15" font-weight="700" fill="${c.accent}">Current Streak</text>
<text x="325" y="174" text-anchor="middle" font-size="12" fill="${c.muted}">${range(stats.current)}</text>
<line x1="420" y1="36" x2="420" y2="176" stroke="${c.border}"/>
${column(515, n(stats.longest.length), 'Longest Streak', range(stats.longest))}
<line x1="610" y1="36" x2="610" y2="176" stroke="${c.border}"/>
${column(705, `${n(stats.year.worked)}<tspan font-size="16" font-weight="400" fill="${c.muted}"> of ${n(stats.year.days)}</tspan>`, 'Days Worked', 'Last 365 days')}
<line x1="40" y1="204" x2="${W - 40}" y2="204" stroke="${c.border}"/>
${tile(135, `+${n(stats.loc.added)}`, 'lines added', c.add)}
${tile(325, `-${n(stats.loc.removed)}`, 'lines removed', c.del)}
${tile(515, n(stats.loc.commits), 'commits', c.text)}
${tile(705, n(stats.loc.repos), 'repositories', c.text)}
<clipPath id="bar"><rect x="${barX}" y="330" width="${barW}" height="8" rx="4"/></clipPath>
<text x="${barX}" y="318" font-size="12" fill="${c.muted}">Lines written by language (${compact(barTotal)})</text>
<g clip-path="url(#bar)">${segments.join('')}</g>
${legend.join('\n')}
</g>
</svg>
`;
}

// ───────────────────────────────── main ─────────────────────────────────

console.error('Contributions from GitHub...');
const contribution = contributions();
console.error('Lines of code from local clones...');
const loc = await linesOfCode();
const stats = { ...contribution, loc };

mkdirSync(join(ROOT, 'profile'), { recursive: true });
for (const theme of Object.keys(THEMES))
  writeFileSync(join(ROOT, 'profile', `stats-${theme}.svg`), card(theme, stats));
writeFileSync(
  join(ROOT, 'profile', 'stats.json'),
  `${JSON.stringify(stats, null, 2)}\n`,
);
console.log(JSON.stringify(stats, null, 2));
