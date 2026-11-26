# About this fork

This repository is upstream [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) plus a short stack of
`feat(fork): …` commits on top. Everything else in the repo, including `AGENTS.md` and `docs/`, is upstream's
and still applies. The MIT licence and upstream's trademark terms ([TRADEMARK.md](TRADEMARK.md)) are unchanged.

See where the fork starts and what it adds:

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git   # once
git fetch upstream
git merge-base HEAD upstream/main                                  # the upstream commit the fork sits on
git log --oneline $(git merge-base HEAD upstream/main)..HEAD       # the fork commits
```

At the time of writing the base is upstream `147384f61a` (2026-11-24).

## What is different

| Feature                                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Files that own it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled page                         | A Scheduled group in the sidebar (Pinned, user subsections, Upcoming, All tasks, Completed; each collapsible). Pinned tasks stay listed under the Scheduled header while the group is collapsed. Clicking a task opens the normal chat of its latest run; a runs panel beside that chat shows the task, its actions (Edit, Run now, Pause/Resume, Delete, Details) and its runs, and folds to a rail; below 1024px the rail's Runs button opens the same list in a sheet. The task's sidebar row stays highlighted while any of its runs' chats is open. A task without runs opens a task page. The sidebar dot means an unseen result (Mark as read/unread); a collapsed group or the collapsed Scheduled header shows the same status light as custom sections, which also reflects what the task's run chats say (a question, an approval, a failure; `scheduled/scheduledChatStates.ts`); the header's light opens a list of those tasks with "Mark all as read".                                                                                                                                                                                                       | `apps/web/src/components/scheduled/*`, `apps/web/src/routes/_chat.scheduled.tsx`, the frame around the thread view in `apps/web/src/routes/_chat.tsx`, `scheduledTasks.subscribeRuns` (by task or by thread) in `packages/contracts/src/rpc.ts`, `ScheduledTaskService.listRuns` in `apps/server/src/scheduledTasks/ScheduledTaskRuns.ts`, "Open Scheduled" in `apps/web/src/components/commandPaletteForkItems.tsx`                                                                                                                                                                                                   |
| Several run times per task             | A fixed-time schedule can have `additionalTimesOfDay` on the same days.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `packages/contracts/src/scheduledTask.ts`, `apps/server/src/scheduledTasks/Schedule.ts`, editor in `apps/web/src/components/scheduled/ScheduledTaskExtraRunTimes.tsx` and `scheduledTaskRunTimes.ts` (hooked into `settings/ScheduledTasksSettings.tsx` and `scheduledTasksSettings.logic.ts`)                                                                                                                                                                                                                                                                                                                         |
| Completed one-time tasks kept          | A one-time task is disabled after its run instead of deleted; Completed drops it 30 days later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `apps/server/src/scheduledTasks/ScheduledTaskService.ts`, `apps/web/src/components/scheduled/scheduledTaskOrganization.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Custom sidebar sections                | User-made sidebar sections with drag and drop, stored in client settings (`client-settings.json` in the T3 home) rather than browser storage. Section fields: `threadKeys` (chats placed there by hand), `projectKey` (linked project: pulls in its threads, one section per project, `excludedThreadKeys` keeps out ones moved away) and `chatProjectKey` (the project new chats from "+" start in, shared freely, pulls in nothing; a linked `projectKey` wins). A section whose project was deleted or archived shows a warning and "+" opens its folder dialog. A collapsed section shows a status light: the most urgent state among its hidden chats, in the icon and colour their rows use (`resolveSidebarRowStatus`), with a count when more than one needs the user; clicking it lists those chats and offers "Mark all as read" (a server visit, as opening the chat does; questions and approvals stay lit). An open section floats chats that need the user to the top (after pins), shows ten rows with "Show N more"/"Show less", and leaves out chats a scheduled run started (`scheduledTasks.subscribeRunThreads`) unless placed by hand, pinned or open. | `apps/web/src/components/sidebar/sidebarSections.ts`, `SidebarCustomSection.tsx`, `SidebarCustomSectionsBlock.tsx`, the status light in `SidebarSectionLamp.tsx` and `sidebarSectionLamp.logic.ts` (call sites in `Sidebar.tsx`), `sidebarSectionArrangement.logic.ts`, `useMarkThreadsRead.ts`, `scheduled/useScheduledRunThreads.ts`, `scheduledTasks.subscribeRunThreads` (`packages/contracts/src/rpc.ts`, `scheduledTask.ts`, `apps/server/src/scheduledTasks/ScheduledTaskRuns.ts`), the "Sections" palette group in `apps/web/src/components/commandPaletteForkItems.tsx`, `packages/contracts/src/settings.ts` |
| Own Electron profile, protocol opt-out | `T3CODE_DESKTOP_USER_DATA_DIR` sets the Electron userData folder; `T3CODE_DESKTOP_SKIP_PROTOCOL_REGISTRATION=1` stops the app registering `t3code://`. Without them nothing changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/desktop/src/app/DesktopConfig.ts`, `DesktopUserData.ts`, `DesktopClerk.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Branded build "T3 Code Alex"           | Build-time switch `T3CODE_FORK_BRAND=alex` (see below), for Windows and Linux.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `scripts/lib/fork-brand.ts`, `apps/desktop/src/app/DesktopForkBrand.ts`, `DesktopEnvironment.ts`, `DesktopStatePaths.ts`, `DesktopUserData.ts`, `DesktopEarlyElectronStartup.ts`, `DesktopLinuxUrlHandler.ts`, `DesktopPreReadyPlatform.ts`, `apps/desktop/src/updates/DesktopUpdates.ts`, `apps/desktop/vite.config.ts`, `scripts/build-desktop-artifact.ts`                                                                                                                                                                                                                                                          |

How a run's chat finds its task: `scheduledTasks.subscribeRuns` also takes a `threadId` and answers with the task of the latest
scheduled message in that thread, so the runs panel and the sidebar highlight work however the chat was opened. In a thread
several runs share, opening a run scrolls to its reply through upstream's quote reveal (`assistantCitationNavigation`): the
panel builds a quote from a stretch of the reply that renders verbatim. If upstream changes that reveal, only the scrolling
breaks; the chat still opens.

Beside the runs panel (or its rail) the chat behaves as if the window ended at the panel's left edge: `ScheduledThreadFrame`
wraps the thread view in two `display: contents` elements that redefine `--workspace-controls-right` and
`--workspace-native-controls-inset` for the chat, so its fixed panel toggles, header padding and details card stay off the
panel, and the panel's header owns the native window controls. If upstream renames those variables or places the chat's
titlebar controls another way, the toggles land on the panel again; `ScheduledThreadPanel.layout.browser.test.tsx` measures it.

User-facing docs for the sidebar features are in `docs/user/thread-sidebar.md` and `docs/user/project-settings.md`.

### The branded build

`T3CODE_FORK_BRAND=alex` at build time changes only the packaged desktop app:

- Name **T3 Code Alex** (executable, installer, Start menu, window title). appId and Windows AppUserModelID
  `com.t3tools.t3code.alex`, so it installs beside the official app and nightlies. Package name `t3code-alex`,
  so a per-user install goes to `%LOCALAPPDATA%\Programs\t3code-alex`.
- Own data: Electron userData `%APPDATA%\t3code-alex` (official: `t3code-v2`) and T3 home `~\.t3-alex`
  (official: `~\.t3`). Database, settings, single-instance lock and the `t3` CLI shim (`~\.t3-alex\bin`) are all
  separate. An explicit `T3CODE_HOME` or `T3CODE_DESKTOP_USER_DATA_DIR` in the environment still wins.
- **Updates permanently off**: no publish config, so no `app-update.yml` ships, and the updater reports
  "Automatic updates are turned off in this build." before any feed or managed-policy check.
- **No `t3code://` registration**, so the official app keeps the scheme. As a result, sign-in flows that return
  through `t3code://` (T3 Connect / Clerk account sign-in) do not come back to this app.
- On Linux: executable and .deb package `t3code-alex` (installs to `/opt/T3 Code Alex`, links
  `/usr/bin/t3code-alex`), desktop entry and window class `com.t3tools.t3code.alex`, no AppStream metainfo,
  and the launch-time entry in `~/.local/share/applications` claims no URL scheme. Electron userData is
  `~/.config/t3code-alex`, T3 home `~/.t3-alex`.

The brand is baked into the desktop bundle at pack time, so the installed app needs no environment variables.
A build without `T3CODE_FORK_BRAND` behaves exactly as before. To add another brand, add an entry
to `FORK_BRANDS` in `scripts/lib/fork-brand.ts`.

## Updating

Every machine runs the fork the same way: an unpacked build folder per commit, started by a small launcher, with
no installer and no password. One command in the repo builds `origin/main`, starts it once minimized against a
neutralised copy of the profile, and marks it for the next app start; it never stops or restarts the running app.

```sh
python3 fork/tools/t3update.py setup        # once per machine: config file, launcher, (Linux) app menu entry
python3 fork/tools/t3update.py update       # safe to repeat and to run unattended; --check only reports
python3 fork/tools/t3update.py status       # current, rollback target (and why), running, commits not yet taken
python3 fork/tools/t3update.py rollback     # last build that actually ran, at the next start (--restore-db for migrations)
python3 fork/tools/t3update.py prune        # delete builds that are not current, the rollback target or running
```

On Windows use `python` instead of `python3`. The per-machine settings (profile, port, brand, source checkout) live
in `t3update.json` outside the repo; on Windows the defaults are the existing setup under
`%LOCALAPPDATA%\T3CodeFork`. Builds get the public T3 Connect ids from `.env.example` when the source checkout has
no `.env` of its own. Details and the safety rules: [fork/tools/README.md](fork/tools/README.md).

`rollback` goes to the last build that was really started on the machine, not to whatever was current before the
last update: after two updates between two app starts it skips the build that never ran. The launcher records each
start; builds an older launcher started are noticed while they run (at the next `update`, `rollback` or `prune`).
`status` names the target and why, and `prune` never deletes it.

**Linux, moving from the .deb:** `git pull` in `~/src/t3code-alex`, run `setup` and then `update`, start "T3 Code
Alex" from the app menu, and once it works remove the package with `sudo apt remove t3code-alex`. The profile
(`~/.t3-alex`) and Electron data (`~/.config/t3code-alex`) are the ones the .deb used. `setup` also prints two
optional one-time `sudo` steps: an AppArmor profile that lets the builds keep Chromium's sandbox, and `xvfb` so the
smoke test runs on an invisible display.

The sections below build installers by hand; the updater does not need them.

## Build and run (Windows)

> **Not yet run end to end.** The command below is what the code supports. An earlier partial run of the same
> change produced the unpacked app and stopped at the NSIS step only because the checkout path was too deep (see
> below); no installer has been built and installed yet. Expect to fix small things on the first run.

Prerequisites: Git, [Vite+](https://viteplus.dev/guide/) (`irm https://vite.plus/ps1 | iex`; it provides the
pinned Node), and Python 3 on `PATH` (the packaging preflight checks for it). Rust and Visual Studio Build Tools
are needed only if you want the resource monitor (see below).

Clone to a **short path** with long paths enabled. NSIS (`makensis`) cannot read files past 260 characters, and
`node_modules\.pnpm\app-builder-lib@…\templates\nsis\…` is already about 160 characters below the repo root:

```powershell
git clone -c core.longpaths=true https://github.com/Alexstebb/T3alex.git C:\src\t3code-alex
cd C:\src\t3code-alex
vp i
Copy-Item .env.example .env   # enables T3 Connect; see "T3 Connect needs .env" below
```

Build the branded installer (PowerShell, from the repo root):

```powershell
$env:T3CODE_FORK_BRAND = "alex"
$env:T3CODE_DESKTOP_SKIP_RESOURCE_MONITOR = "true"   # omit if Rust + VS Build Tools are installed
vp run dist:desktop:win:x64
```

The installer lands in `release\T3-Code-Alex-<version>-x64.exe` (set `T3CODE_DESKTOP_OUTPUT_DIR` to change
the folder; `T3CODE_DESKTOP_KEEP_STAGE=true` keeps the unpacked app under `%TEMP%\t3code-desktop-win-stage-*`).

Install by running the `.exe`. It is unsigned, so Windows SmartScreen shows "Windows protected your PC";
choose **More info → Run anyway**. It is a per-user install; no admin rights needed. Uninstall from
Settings → Apps.

Does not work in a branded build:

- Automatic updates (by design). To update, use the updater (see [Updating](#updating)) or rebuild and install over it.
- `t3code://` callbacks, i.e. account sign-in that returns to the app through the browser.
- The process resource monitor (CPU/memory per process) when built with `T3CODE_DESKTOP_SKIP_RESOURCE_MONITOR`;
  the app runs without those metrics.

## Build and run (Linux)

> Built and installed end to end on Pop!_OS 24.04 (x86_64, COSMIC) on 2026-11-26 from `5e96ab7c24`: the .deb
> installs beside the official `t3code` package, keeps `t3code://` with the official app, and uses `~/.t3-alex`
> and `~/.config/t3code-alex`. No code fixes were needed.

Build on a Linux machine of the same architecture; the browser secret helper links against libsecret and cannot
be cross-built from Windows or macOS. Prerequisites are upstream's: see
[Linux AppImage prerequisites](docs/operations/00_development.md#linux-appimage-prerequisites) (Rust/Cargo, a C
toolchain, libsecret headers, ImageMagick), plus Git and Vite+ (`curl -fsSL https://vite.plus | bash`).

```sh
git clone https://github.com/Alexstebb/T3alex.git ~/src/t3code-alex
cd ~/src/t3code-alex
vp i
cp .env.example .env   # enables T3 Connect; see "T3 Connect needs .env" below
T3CODE_FORK_BRAND=alex vp run dist:desktop:linux
```

`release/` then holds `T3-Code-Alex-<version>-x86_64.AppImage` and `T3-Code-Alex-<version>-amd64.deb`.

- **.deb** (Debian, Ubuntu): `sudo apt install ./release/T3-Code-Alex-<version>-amd64.deb`; it appears as
  "T3 Code Alex" in the app menu and installs beside the official `t3code` package. Uninstall with
  `sudo apt remove t3code-alex`.
- **AppImage** (any distribution): `chmod +x` it and run it. The first launch writes its own desktop entry
  and icon under `~/.local/share`.

The same limits as on Windows apply: no automatic updates and no `t3code://` sign-in callbacks. For daily use the
updater replaces both packages (see [Updating](#updating)).

### T3 Connect needs .env

T3 Connect (account sign-in, linking this machine through the relay, guest links) is compiled in only when the
build sees the public Clerk and relay identifiers from `.env`. Without `.env` the build still succeeds and the app
starts, but Settings → Sharing & access has no T3 Connect section and nothing says why. `.env.example` holds the
same public values the official release builds use (no secrets) and `.env` is gitignored, so copy it before
`vp run dist:desktop:*`. To check a build, open Settings → Sharing & access: a "T3 Connect" row with a Sign in
button means it is on.

Sign in from the app's own dialog with **email and code**. The Apple, GitHub, Google and Microsoft buttons return
through `t3code://`, which stays with the official app, so they do not come back to the branded build.

## Getting upstream updates

```sh
git fetch upstream
git rebase upstream/main          # replays the feat(fork) commits
vp i
vp run typecheck                  # then the tests for the areas the conflicts touched
```

- **Translation catalogs conflict on almost every rebase.** Take upstream's catalogs and re-apply the fork
  commit's keys with `python fork/tools/i18n_apply.py <fork-commit>` (run mid-conflict from the repo root), then
  `vp fmt apps/web/src/i18n/translations/*.json` and `git add` them. It appends added keys, removes the ones the
  commit removed, and prints clashes.
- `apps/web/src/routeTree.gen.ts` is generated by the web build; take either side and let the next build
  regenerate it rather than hand-merging.
- **Database migrations are one-way.** Upstream adds numbered migrations constantly; a newer build migrates the
  profile database and an older build then refuses it. Back up `<T3 home>\userdata\statev2.sqlite` (with the
  app closed, or via SQLite's backup API) before running a build from a newer upstream.

## Rules that keep the fork maintainable

- **No fork-only numbered DB migrations.** The migrator refuses a database whose recorded migration ids differ
  from the build's. Create fork indexes or tables idempotently at runtime (`CREATE … IF NOT EXISTS`), as
  `ScheduledTaskService` does for its run index.
- **Prefer new files over edits to upstream files**, and keep unavoidable edits small: upstream lands a lot of
  commits a day and every edited line is a future conflict. Mark fork edits with a `Local fork:` comment. Put
  state, handlers and rendering in a fork-owned hook or component and leave the upstream file a call site, as
  `Sidebar.tsx` does with `useSidebarCustomSections`.
- **Fork state lives in `ClientSettingsSchema` fields with decoding defaults** (`packages/contracts/src/settings.ts`),
  so older and newer settings files still decode.
- **Every new UI string goes into all ten catalogs** (`apps/web/src/i18n/translations/{en,de,es,fr,ja,ko,pt-BR,ru,sv,zh}.json`).
  Never run a plain `gt generate`: it reorders every catalog. Instead copy `apps/web/gt.config.json` to a temp
  folder with `"locales": []` and `files.gt.output` pointing into that folder, run
  `node_modules/.bin/gt generate --config <temp config>` from `apps/web`, diff the generated `en.json` against the
  committed one, append only the missing keys to the end of every catalog (translated) and remove stale ones.
  All ten catalogs must end up with exactly the generated key set.
- Fork commits are titled `feat(fork): …` (code) or `docs(fork): …` (docs) so the stack stays easy to see.

## Traps

- **Agent sessions inherit the app's environment.** A coding agent running inside a T3 Code dev app inherits
  `T3CODE_DESKTOP_DEV=1`, `T3CODE_HOME` (the live profile), `NODE_ENV=development`, `NODE_PATH` and `VITE_*`.
  With those, `vp run build:desktop` relaunches Electron in a loop, a launch opens the live database, and React
  builds in development mode. Before any build, server start or Electron launch from such a session, remove
  every `T3CODE_*`, `T3_*`, `VITE_*`, `ELECTRON_*`, `NODE_*`, `VP_*`, `npm_*` and `PNPM_*` variable from that
  command's environment and set only what you mean to. Typecheck, lint and unit tests are fine as they are.
- **Never develop in the checkout a dev-mode app is running from.** Editing server or contracts files restarts
  its backend, which kills every running agent session. Use a separate `git worktree`.
- **Pre-commit hook:** `vp staged` runs format, lint and `knip:check` (fails on unused exports). Do not skip it.
- **Windows:** clone with `core.longpaths=true`; a few files under `.repos/alchemy-effect/…` can still show as
  deleted (names too long). Never commit that deletion: `git update-index --skip-worktree <paths>` before
  committing and clear it afterwards. `scripts/i18n-check.ts` does not run on Windows (it spawns `gt` without
  `.cmd`). In Git Bash, `PATH` entries must be POSIX form (`/c/…`).
