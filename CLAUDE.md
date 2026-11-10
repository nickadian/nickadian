# CLAUDE.md

GitHub profile repo for `nickadian`. `readme.md` is the profile page.

## Stats card

The card in `readme.md` (contributions, streak, lines of code, languages) is
generated, not a third-party service.

| Piece     | Where                                                                    |
| --------- | ------------------------------------------------------------------------ |
| Generator | `scripts/build-stats.mjs` (no dependencies; needs `gh` and local clones) |
| Runner    | `scripts/refresh.mjs` (rebuild, commit, push)                            |
| Output    | `profile/stats-dark.svg`, `profile/stats-light.svg`, `profile/stats.json` |
| Schedule  | launchd `com.nickadian.profile-stats`, daily 09:00 on Nick's Mac         |
| Plist     | `~/Library/LaunchAgents/com.nickadian.profile-stats.plist` (not in repo) |
| Log       | `~/Library/Logs/profile-stats.log`                                       |

```bash
node scripts/build-stats.mjs                                  # rebuild only
node scripts/build-stats.mjs <dir> ...                        # scan other folders of clones
launchctl kickstart gui/$(id -u)/com.nickadian.profile-stats  # run the daily job now
launchctl bootout gui/$(id -u)/com.nickadian.profile-stats    # stop it
```

Do not edit the SVGs or `stats.json` by hand; the next run overwrites them.

### Where the numbers come from

- **Contributions and streaks:** GitHub GraphQL through `gh`, every year since
  the account was created, private contributions included. A day with nothing
  ends a streak, except today, which is not over yet.
- **Days worked:** days with at least one contribution among the last 365
  finished days. Today joins the window only once it has a contribution.
- **Lines of code:** `git log --all --no-merges --numstat` over every clone in
  `~/Documents/GitHub`, commits authored by the emails in `AUTHORS`, each sha
  counted once across clones and forks.
- **Left out of the line count** (`SKIP`, `SKIP_SUBJECT`, `IMPORT_LINES`):
  lockfiles, `node_modules`, `dist`, `cdk.out`, `.nx`, JSON / CSV / txt data,
  SVG, binaries, reverts, formatter-only commits, upstream template merges, and
  a first commit that imports more than 20,000 lines. Without these the count
  was 15.3M instead of 8.9M (one repo had 3.9M lines of CDK output).
- A repo that is not cloned in a scanned folder is not counted, and clones are
  not pulled by the job.

### Rules

- **launchd runs node directly, never a shell script.** macOS refuses launchd's
  `/bin/bash` access to `~/Documents` ("Operation not permitted"). The plist
  points `~/.fnm/aliases/default/bin/node` at `scripts/refresh.mjs`.
- **Refresh commits use `profile-stats@localhost.invalid`,** an email that is
  not on the GitHub account, so a refresh never counts as a contribution and
  cannot keep a streak alive. Do not change it to a real address.
- **The job pushes only when a number changed** and skips the run when the
  working tree is dirty. Do not add a date or timestamp to the output: it would
  force a commit every day.
- **The repo is public.** Only totals are published; never write repo names,
  file paths or commit subjects from private repos into the output.
- New author email: add it to `AUTHORS`. New kind of generated file inflating
  the count: add it to `SKIP`.
