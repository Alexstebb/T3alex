# Fork tools

`t3update.py` updates T3 Code Alex on a machine the same way on Windows and Linux: build the fork's
`origin/main` into a new folder, start it once against a neutralised copy of the profile, and mark
it as the build to use the next time the app starts. Python 3 standard library only.

```sh
python3 fork/tools/t3update.py status [--fetch]   # current, previous, running, what is new
python3 fork/tools/t3update.py update --check     # only report
python3 fork/tools/t3update.py update             # build, smoke-test, activate for the next start
python3 fork/tools/t3update.py rollback [--restore-db FILE]
python3 fork/tools/t3update.py prune [--dry-run]
python3 fork/tools/t3update.py setup [--dry-run]  # once per machine
python3 fork/tools/t3update.py config             # the resolved per-machine paths
```

Exit codes: `0` done (with `--check`: an update is available), `3` nothing to do, `1` failed. A
failed update leaves the current build in place and says what failed; `release/logs/update-history.log`
keeps one line per run.

## Files

| File                        | What it does                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `t3update.py`               | The commands above.                                                                             |
| `t3core.py`                 | Config, pointer (`current.json`), git and migration parsing, prune selection, SQLite copies.    |
| `t3platform.py`             | What differs per OS: process table, locks, killing a tree, notifications, sandbox, Xvfb, menus. |
| `t3launch.py`               | The launcher: starts the current build with the configured profile, port and Electron profile.  |
| `t3smoke.py`                | One supervised start of a build against a profile copy (also usable by hand, with `--probe`).   |
| `scrubbed_env.py`           | Removes inherited `T3CODE_*`, `VITE_*`, `NODE_*`, ... before any build or launch.               |
| `apply_pending_settings.py` | Applies prepared client-settings edits while the app is closed (called by the launcher).        |
| `cdp_probe.mjs`             | Read-only DevTools probe used by the smoke test (`probe`, `text`, `close`).                     |
| `cdp_runs_panel.mjs`        | Optional layout probe for the runs panel: `t3smoke.py <build> <dir> --probe cdp_runs_panel.mjs` |
| `test_t3update.py`          | `python -m unittest discover -s fork/tools -p "test_*.py"`                                      |

## Per-machine config

`t3update.json` lives outside the repo, and its folder is the tooling root (builds, pointer, logs):

- Windows: `%LOCALAPPDATA%\T3CodeFork\t3update.json`. The defaults are the release setup of
  2026-11-24: profile `live`, Electron profile `release\userdata`, port `14084`, unbranded build,
  the existing `release\current.json` and `release\builds`.
- Linux: `~/.local/share/t3code-alex/t3update.json`. Profile `~/.t3-alex` and Electron profile
  `~/.config/t3code-alex` (the branded build's own folders, so the old .deb install's data carries
  over), no pinned port, brand `alex`, source checkout `~/src/t3code-alex`.

`config --defaults` shows the defaults; `--config FILE` points any command at another root (that is
how the tool is tested without touching the real one). Relative paths in the file resolve against
its folder. Write Windows paths with forward slashes or doubled backslashes; it is JSON.

## Warnings (read before changing or running these tools)

- **Stability comes first.** The app these tools update is where the user's whole working day runs:
  chats, scheduled tasks, standing agents. `update` never stops, restarts or signals the running
  app. Do not add anything that does.
- **Never touch the live profile.** Smoke tests and experiments run against a copy made with
  SQLite's backup API (`t3smoke.smoke_copy`), with scheduled tasks, providers and restart
  continuation turned off. `t3smoke.refuse_live` refuses any path overlapping the configured
  profile or Electron profile.
- **Scrub the environment.** Agent sessions inherit the live app's `T3CODE_HOME`,
  `T3CODE_DESKTOP_DEV=1`, `VITE_*` and `NODE_ENV=development`. With those a build relaunches
  Electron in a loop against the live profile and steals focus. Everything here goes through
  `scrubbed_env`; keep it that way. If something starts opening windows or taking focus, kill the
  process tree you started at once.
- **Smoke tests never pin the port.** The pinned port (Windows: 14084, which the phone uses over
  Tailscale) belongs to the real app.
- **Nothing destructive without checking current, previous and running.** `prune` and the build
  step refuse a folder that the pointer names or that a running process was started from, and
  refuse to guess when they cannot list processes.
- **Migrations are one-way.** `update` reports the migrations a build would add, backs the database
  up when there are any, and the launcher takes another backup right before the build's first
  start. Rolling back past a migration needs `rollback --restore-db`, with the app closed.
- **Rollback is remembered.** A build you rolled back from is listed under `rejected` in the pointer;
  `update` does not take it again until `origin/main` moves on (or `--allow-rejected`).
- Never skip git hooks; do not push from these tools.

## Linux notes

- Builds are unpacked folders run by the launcher, as on Windows (not AppImage or .deb), so build,
  smoke, activate and rollback are the same code on both systems and need no password.
- `setup` writes `~/.local/share/applications/t3code-alex.desktop` (it shadows the .deb's entry of
  the same name) pointing at `<root>/launcher/t3launch.py`, a copy of these tools that only `setup`
  changes. The app itself writes a hidden URL-handler entry `com.t3tools.t3code.alex.desktop` at
  every start; the launcher sets `T3CODE_DESKTOP_LAUNCHER_PATH` so it points at the launcher too.
- Electron files its safeStorage key in the keyring under the app's `package.json` name, and a bare
  `electron main.cjs` is called "Electron". So the launcher and the smoke test start a build through
  `apps/desktop/.t3launch/package.json`, named `appName` (`t3code-alex`, the .deb's name): without
  it the build cannot decrypt the saved connections and cookies the .deb wrote.
- `status` and the launcher look at Chromium's `SingletonLock` in the Electron profile, so an app
  this tool did not start (the old .deb) counts as running: the launcher then hands over to it
  without touching the database or settings, and `rollback --restore-db` refuses.
- Chromium's sandbox needs unprivileged user namespaces, which Ubuntu 24.04 (and Pop!\_OS 24.04)
  only grant to programs an AppArmor profile names. `setup` writes such a profile for the builds
  folder and prints the two `sudo` commands to install it once. Until then the builds start with
  `--no-sandbox`; `status` shows which.
- With `Xvfb` installed (`sudo apt install xvfb`) the smoke test runs on an invisible display, also
  when nobody is logged in. Without it the smoke window opens on the desktop for about a minute.
