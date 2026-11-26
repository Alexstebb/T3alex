#!/usr/bin/env python3
"""Update T3 Code Alex on this machine: build the fork's origin/main, test it, and use it at the
next app start. The same command on Windows and Linux; per-machine paths live in a config file
outside the repo (see `config`).

    python3 fork/tools/t3update.py status [--fetch]
    python3 fork/tools/t3update.py update [--check] [--ref REF] [--allow-rejected]
    python3 fork/tools/t3update.py rollback [--restore-db FILE]
    python3 fork/tools/t3update.py prune [--dry-run]
    python3 fork/tools/t3update.py setup [--dry-run] [--source-repo DIR]
    python3 fork/tools/t3update.py config [--defaults]

Every command takes --config FILE (default: %LOCALAPPDATA%\\T3CodeFork\\t3update.json on Windows,
~/.local/share/t3code-alex/t3update.json on Linux); the file's folder is the tooling root.

`update` never stops or restarts the running app. Exit codes: 0 done (update: a new build is ready;
update --check: an update is available), 3 nothing to do, 1 failed (the current build stays).
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from scrubbed_env import config_environment  # noqa: E402
import t3core  # noqa: E402
import t3launch  # noqa: E402
import t3platform  # noqa: E402
import t3smoke  # noqa: E402

EXIT_OK, EXIT_FAILED, EXIT_NOTHING = 0, 1, 3
LAUNCHER_FILES = ("t3launch.py", "t3core.py", "t3platform.py", "scrubbed_env.py", "apply_pending_settings.py")
MIN_FREE_BYTES = 8 * 1024 ** 3
REACT_DEV_MARKER = b"Each child in a list should have a unique"
REACT_PROD_MARKER = b"react.dev/errors/"
SUBJECTS_SHOWN = 25


class UpdateError(Exception):
    pass


def log(message=""):
    print(message, flush=True)


# ---------------------------------------------------------------- helpers

def git(config, *args, cwd=None, check=True):
    # .repos/alchemy-effect has paths longer than MAX_PATH below builds/<sha> on Windows.
    env = config_environment(config, {"GIT_TERMINAL_PROMPT": "0"})
    result = subprocess.run(["git", "-c", "core.longpaths=true", "-C", str(cwd or config.source_repo), *args],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
                            stdin=subprocess.DEVNULL)
    if check and result.returncode != 0:
        raise UpdateError(f"git {' '.join(args)} failed: {result.stderr.strip()[:800]}")
    return result.stdout.strip()


def require_config(config):
    if not config.exists:
        raise UpdateError(f"No config at {config.path}. Run `t3update.py setup` once on this machine first.")


def require_source_repo(config):
    if not (config.source_repo / ".git").exists():
        raise UpdateError(f"The source repo {config.source_repo} is not a git checkout (sourceRepo in {config.path}).")


def running_builds(config):
    """Builds a process was started from. Refuses (raises) instead of guessing when it cannot look."""
    try:
        paths = t3platform.executable_paths()
    except Exception as error:
        raise UpdateError(f"Could not list running processes ({error}); refusing to guess what is running.")
    return t3core.builds_in_use(paths, config.builds_dir)


def launcher_running(config):
    return any(t3platform.lock_is_held(lock) for lock in [config.launch_lock, *config.other_locks])


def app_running(config):
    """Whether anything has the profile open: a build, a launcher, or an app this tool did not start."""
    return bool(running_builds(config) or launcher_running(config)
                or t3platform.electron_profile_owner(config.user_data_dir))


def run_logged(config, command, cwd, log_path, extra_env=None):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    env = config_environment(config, extra_env)
    if config.is_windows and command[0].lower().endswith(".cmd"):
        command = [str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"), "/d", "/c", *command]
    with open(log_path, "a", encoding="utf-8", newline="\n") as out:
        out.write(f"\n$ {' '.join(command)}  (cwd={cwd})\n")
        out.flush()
        result = subprocess.run(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out,
                                stderr=subprocess.STDOUT, creationflags=t3platform.NO_WINDOW)
    if result.returncode != 0:
        raise UpdateError(f"{' '.join(command[-3:])} failed with code {result.returncode}; see {log_path}")


def vp_command(config, build_dir):
    local = build_dir / "node_modules" / ".bin" / ("vp.cmd" if config.is_windows else "vp")
    if local.exists():
        return [str(local)]
    if config.vp and Path(config.vp).exists():
        return [config.vp]
    found = shutil.which("vp", path=config_environment(config)["PATH"])
    if not found:
        raise UpdateError(f"Vite+ (vp) not found. Install it, or set \"vp\" in {config.path}.")
    return [found]


def remove_tree(path):
    """Delete a build folder, including read-only files and (Windows) paths past MAX_PATH."""
    target = str(Path(path).resolve())
    if os.name == "nt" and not target.startswith("\\\\?\\"):
        target = "\\\\?\\" + target

    def clear_readonly(function, failed, _info):
        os.chmod(failed, stat.S_IWRITE)
        function(failed)

    if sys.version_info >= (3, 12):
        shutil.rmtree(target, onexc=clear_readonly)
    else:
        shutil.rmtree(target, onerror=clear_readonly)


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest() if Path(path).is_file() else None


def launcher_dir(config):
    return config.root / "launcher"


def launcher_outdated(config):
    directory = launcher_dir(config)
    if not directory.is_dir():
        return None
    return [name for name in LAUNCHER_FILES if file_digest(TOOLS / name) != file_digest(directory / name)]


def record(config, outcome, message):
    if not config.exists:
        return  # nothing is written for a machine that has not run setup
    config.logs_dir.mkdir(parents=True, exist_ok=True)
    with (config.logs_dir / "update-history.log").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{t3core.now_stamp()} {outcome}: {message}\n")


def last_record(config):
    path = config.logs_dir / "update-history.log"
    if not path.is_file():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    return lines[-1] if lines else None


def build_migrations_at(config, sha):
    return t3core.parse_migrations(git(config, "show", f"{sha}:{t3core.MIGRATIONS_FILE}"))


def migration_report(config, sha):
    return t3core.migration_report(build_migrations_at(config, sha), t3core.recorded_migrations(config.database))


def describe_behind(config, current_sha, target_sha):
    behind_info = t3core.parse_ahead_behind(git(config, "rev-list", "--left-right", "--count",
                                                f"{current_sha}...{target_sha}"))
    commits = t3core.parse_log(git(config, "log", "--no-merges", f"--max-count={SUBJECTS_SHOWN}",
                                   "--format=%h%x09%s", f"{current_sha}..{target_sha}"))
    return behind_info, commits


def print_behind(config, current_sha, target_sha, label=None):
    label = label or config.upstream_ref
    (only_current, behind), commits = describe_behind(config, current_sha, target_sha)
    log(f"  {behind} commit(s) on {label} are not in the current build")
    if only_current:
        log(f"  {only_current} commit(s) in the current build are not on {label} "
            "(the branch was rebased or the build came from another ref)")
    for sha, subject in commits:
        log(f"    {sha}  {subject}")
    if behind > len(commits):
        log(f"    ... and {behind - len(commits)} more (merges not listed)")
    return behind


def sha_of(config, name, meta=None):
    meta = meta if meta is not None else t3core.read_meta(config, name)
    if meta and meta.get("sha"):
        return meta["sha"]
    return git(config, "rev-parse", "--verify", f"{name}^{{commit}}")


def modify_pointer(config, change):
    with t3platform.FileLock(config.release_dir / "pointer.lock"):
        pointer = t3core.read_pointer(config.pointer_path)
        updated = change(pointer)
        if updated is not None and updated != pointer:
            t3core.write_json_atomic(config.pointer_path, updated)
        return updated if updated is not None else pointer


# ---------------------------------------------------------------- building

def prepare_dotenv(config, build_dir):
    """T3 Connect needs the public Clerk/relay ids in .env at build time (see .env.example)."""
    if not config.copy_env_example or (build_dir / ".env").exists():
        return None
    own = config.source_repo / ".env"
    source = own if own.is_file() else build_dir / ".env.example"
    if not source.is_file():
        return None
    shutil.copy2(source, build_dir / ".env")
    return source


def verify_build(config, build_dir):
    missing = [str(p) for p in t3core.required_build_files(config, build_dir) if not p.exists()]
    if missing:
        raise UpdateError("The build is incomplete; missing:\n  " + "\n  ".join(missing))
    unknown = t3core.build_understands((build_dir / "apps" / "desktop" / "dist-electron" / "main.cjs").read_bytes())
    if unknown:
        raise UpdateError(f"The build does not know {', '.join(unknown)}; the launcher cannot isolate it.")
    assets = build_dir / "apps" / "server" / "dist" / "client" / "assets"
    dev_hits, prod_hits, js_bytes = 0, 0, 0
    for chunk in assets.glob("*.js"):
        data = chunk.read_bytes()
        js_bytes += len(data)
        dev_hits += REACT_DEV_MARKER in data
        prod_hits += REACT_PROD_MARKER in data
    if dev_hits or not prod_hits:
        raise UpdateError(f"The renderer is not a production React build (dev markers {dev_hits}, prod {prod_hits})")
    verify_home = config.release_dir / "verify-home"
    try:
        version = subprocess.run(
            [str(config.electron_path(build_dir)), str(build_dir / "apps" / "server" / "dist" / "bin.mjs"), "--version"],
            cwd=build_dir, env=config_environment(config, {"ELECTRON_RUN_AS_NODE": "1", "T3CODE_HOME": str(verify_home)}),
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
            stdin=subprocess.DEVNULL, creationflags=t3platform.NO_WINDOW)
    finally:
        shutil.rmtree(verify_home, ignore_errors=True)
    if version.returncode != 0:
        raise UpdateError(f"The server bundle failed to start: {version.stderr.strip()[:500]}")
    return {"serverVersion": version.stdout.strip(), "rendererJsBytes": js_bytes}


def build(config, sha, ref, protected):
    name = t3core.build_name(sha)
    build_dir = config.builds_dir / name
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = config.logs_dir / f"build-{name}-{stamp}.log"
    meta = t3core.read_meta(config, name)
    if build_dir.is_dir() and meta and meta.get("sha") == sha:
        try:
            verify_build(config, build_dir)
            log(f"  {name} is already built ({meta.get('builtAt')}); reusing it")
            return build_dir, meta
        except UpdateError as error:
            log(f"  the existing {name} does not verify ({error}); building it again")
    if name in protected:
        raise UpdateError(f"{build_dir} is current, previous or running and does not verify; not touching it.")
    config.builds_dir.mkdir(parents=True, exist_ok=True)
    if not build_dir.exists():
        log(f"  checking out {sha[:12]} into {build_dir}")
        git(config, "worktree", "add", "--detach", str(build_dir), sha)
    else:
        head = git(config, "rev-parse", "HEAD", cwd=build_dir, check=False)
        if head != sha:
            raise UpdateError(f"{build_dir} exists but is not a checkout of {sha[:12]}; run `prune` and try again.")
    if git(config, "status", "--porcelain", "--untracked-files=no", cwd=build_dir):
        raise UpdateError(f"{build_dir} has local modifications; refusing to build it")
    (config.builds_dir / f"{name}.json").unlink(missing_ok=True)
    dotenv = prepare_dotenv(config, build_dir)
    if dotenv is not None:
        log(f"  no .env in the build: copied {dotenv} (T3 Connect's public ids)")
    vp = vp_command(config, build_dir)
    log(f"  installing dependencies (log: {log_path})")
    run_logged(config, vp + ["install", "--frozen-lockfile"], build_dir, log_path)
    vp = vp_command(config, build_dir)
    # pnpm does not run Electron's install script; this fetches the binary.
    log("  fetching the Electron runtime")
    run_logged(config, vp + ["run", "ensure:electron"], build_dir / "apps" / "desktop", log_path)
    for relative in ("apps/server/dist", "apps/web/dist", "apps/desktop/dist-electron"):
        shutil.rmtree(build_dir / relative, ignore_errors=True)
    brand = {"T3CODE_FORK_BRAND": config.brand} if config.brand else {}
    log(f"  building (vp run build:desktop{', brand ' + config.brand if config.brand else ''})")
    started = time.monotonic()
    run_logged(config, vp + ["run", "build:desktop"], build_dir, log_path, brand)
    seconds = round(time.monotonic() - started)
    warnings = []
    if not config.is_windows:
        # Imports browser sign-ins into previews; needs libsecret headers. The app runs without it.
        helper = build_dir / "apps" / "desktop" / "scripts" / "build-browser-secret.mjs"
        if helper.is_file():
            try:
                run_logged(config, [str(config.electron_path(build_dir)), str(helper)], build_dir / "apps" / "desktop",
                           log_path, {"ELECTRON_RUN_AS_NODE": "1"})
            except UpdateError as error:
                warnings.append(f"browser sign-in import helper not built: {error}")
    log("  verifying the build")
    verification = verify_build(config, build_dir)
    meta = {
        "name": name, "sha": sha, "ref": ref,
        "subject": git(config, "log", "-1", "--format=%s", sha),
        "builtAt": t3core.now_stamp(), "buildSeconds": seconds, **verification,
        "migrationHead": max(i for i, _ in build_migrations_at(config, sha)),
        "brand": config.brand or None, "builtBy": "t3update", "warnings": warnings, "smoke": None,
    }
    t3core.write_json_atomic(config.builds_dir / f"{name}.json", meta)
    for warning in warnings:
        log(f"  warning: {warning}")
    log(f"  built {name} in {seconds} s ({verification['serverVersion']})")
    return build_dir, meta


def smoke(config, build_dir, meta):
    workdir = config.smoke_dir / build_dir.name
    log(f"  smoke test: starting {build_dir.name} once against a neutralised copy of the profile")
    copied = t3smoke.smoke_copy(config, workdir / "home", replace=True)
    log(f"    profile copied ({copied['scheduledTasksDisabled']} scheduled task(s) disabled in the copy)")
    log_path = config.logs_dir / f"smoke-{build_dir.name}.log"
    result = t3smoke.run_smoke(config, build_dir, workdir, log_path)
    summary = {key: result.get(key) for key in ("passed", "problems", "secondsToDevtools", "secondsToUiReady",
                                                "exit", "sandbox", "display")}
    summary["at"] = t3core.now_stamp()
    summary["log"] = str(log_path)
    (config.logs_dir / f"smoke-{build_dir.name}.json").write_text(json.dumps(result, indent=2) + "\n",
                                                                  encoding="utf-8", newline="\n")
    meta = {**meta, "smoke": summary}
    t3core.write_json_atomic(config.builds_dir / f"{build_dir.name}.json", meta)
    if not result["passed"]:
        raise UpdateError("the smoke test failed: " + "; ".join(result["problems"]) + f" (log: {log_path})")
    shutil.rmtree(workdir, ignore_errors=True)  # the profile copy; the log stays
    log(f"    passed: UI up {result.get('secondsToUiReady')} s after start, {result.get('exit')}")
    return meta


# ---------------------------------------------------------------- commands

def cmd_config(config, args):
    if args.defaults:
        config = t3core.resolve_config(t3core.default_config(), config.path)
    log(f"config file:      {config.path} ({'exists' if config.exists else 'not written yet; these are the defaults'})")
    log(f"tooling root:     {config.root}")
    log(f"source repo:      {config.source_repo}  (builds {config.upstream_ref})")
    log(f"release dir:      {config.release_dir}")
    log(f"  pointer:        {config.pointer_path}")
    log(f"  builds:         {config.builds_dir}")
    log(f"  logs:           {config.logs_dir}")
    log(f"T3 home:          {config.home}")
    log(f"  database:       {config.database}")
    log(f"Electron profile: {config.user_data_dir}")
    log(f"DB backups:       {config.rollback_dir}")
    log(f"pending settings: {config.pending_dir}")
    log(f"pinned port:      {config.port or 'none'}")
    log(f"brand:            {config.brand or 'none (unbranded build)'}")
    log(f"app user model id:{' ' + config.app_user_model_id if config.app_user_model_id else ' n/a'}")
    log(f"launch lock:      {config.launch_lock}")
    for lock in config.other_locks:
        log(f"other lock:       {lock}")
    log(f"PATH first:       {config.path_prepend}")
    log(f"vp:               {config.vp or 'from PATH'}")
    log(f"copy .env.example:{' yes' if config.copy_env_example else ' no'}")
    log(f"Electron app name:{' ' + config.app_name if config.app_name else ' none (starts dist-electron/main.cjs)'}")
    return EXIT_OK


def cmd_status(config, args):
    log(f"config: {config.path}{'' if config.exists else ' (not written yet; showing defaults)'}")
    pointer = t3core.read_pointer(config.pointer_path)
    for key in ("current", "previous"):
        name = pointer.get(key)
        meta = t3core.read_meta(config, name) if name else None
        detail = f"{meta.get('subject')}  (built {meta.get('builtAt')})" if meta else ""
        log(f"{key + ':':10}{name or '-'}  {detail}")
    if pointer.get("rejected"):
        log(f"rolled back from (not taken again automatically): {', '.join(pointer['rejected'])}")
    if pointer.get("pendingDbBackup"):
        log(f"database backup at next start (new migrations): {pointer['pendingDbBackup'].get('new')}")
    running = running_builds(config)
    lock = launcher_running(config)
    log(f"running:  {', '.join(sorted(running)) or 'nothing from ' + str(config.builds_dir)}"
        f"{'  (launcher lock held)' if lock else ''}")
    if pointer.get("current") and running and pointer["current"] not in running:
        log("          the app runs an older build; the current one is used at the next start")
    owner = t3platform.electron_profile_owner(config.user_data_dir)
    if owner:
        pid, exe = owner
        foreign = not t3core.builds_in_use([exe], config.builds_dir) if exe else True
        log(f"app on the profile: pid {pid}, {exe or 'executable unknown'}"
            f"{'  (not one of these builds; nothing here touches it)' if foreign else ''}")
    if args.fetch:
        require_source_repo(config)
        git(config, "fetch", "--quiet", config.remote)
    if pointer.get("current") and (config.source_repo / ".git").exists():
        try:
            target = git(config, "rev-parse", "--verify", f"{config.upstream_ref}^{{commit}}")
            fetched = config.source_repo / ".git" / "FETCH_HEAD"
            when = (datetime.datetime.fromtimestamp(fetched.stat().st_mtime).isoformat(timespec="minutes")
                    if fetched.is_file() else "unknown")
            log(f"{config.upstream_ref} = {target[:9]} (last fetch {when}{'' if args.fetch else '; --fetch to refresh'})")
            print_behind(config, sha_of(config, pointer["current"]), target)
        except UpdateError as error:
            log(f"could not compare with {config.upstream_ref}: {error}")
    if config.builds_dir.is_dir():
        log("builds on disk:")
        for entry in sorted(config.builds_dir.iterdir()):
            if not entry.is_dir():
                continue
            meta = t3core.read_meta(config, entry.name)
            smoke_state = (meta or {}).get("smoke") or {}
            tag = ("smoke passed" if smoke_state.get("passed") else "smoke FAILED" if smoke_state else
                   "no smoke record") if meta else "no metadata (unfinished build or leftover)"
            log(f"  {entry.name}  {(meta or {}).get('builtAt', '')}  {tag}  {(meta or {}).get('subject', '')}")
    head = max((i for i, _ in t3core.recorded_migrations(config.database)), default=0)
    log(f"profile database migration head: {head}  ({config.database})")
    if not config.is_windows and pointer.get("current"):
        log(f"Chromium sandbox: {t3platform.linux_sandbox_state(config.electron_path(config.builds_dir / pointer['current']))[1]}")
    outdated = launcher_outdated(config)
    if outdated:
        log(f"the launcher copy in {launcher_dir(config)} differs from these tools ({', '.join(outdated)}); "
            "run `setup` to refresh it")
    last = last_record(config)
    if last:
        log(f"last update run: {last}")
    return EXIT_OK


def cmd_update(config, args):
    if not args.check:
        require_config(config)
    require_source_repo(config)
    if args.check:
        return _update(config, args)  # read-only: no lock file either
    lock = t3platform.FileLock(config.release_dir / "update.lock")
    config.release_dir.mkdir(parents=True, exist_ok=True)
    if not lock.try_acquire():
        raise UpdateError("Another update is running on this machine.")
    try:
        return _update(config, args)
    finally:
        lock.release()


def _update(config, args):
    log(f"Fetching {config.remote} in {config.source_repo}")
    git(config, "fetch", "--quiet", config.remote)
    ref = args.ref or config.upstream_ref
    sha = git(config, "rev-parse", "--verify", f"{ref}^{{commit}}")
    name = t3core.build_name(sha)
    pointer = t3core.read_pointer(config.pointer_path)
    current = pointer.get("current")
    log(f"{ref} = {name}  {git(config, 'log', '-1', '--format=%s', sha)}")
    log(f"current build: {current or 'none'}")
    if current == name:
        log("Already up to date; nothing to do.")
        if not args.check:
            record(config, "nothing", f"already at {name}")
        return EXIT_NOTHING
    if name in (pointer.get("rejected") or []) and not args.allow_rejected:
        log(f"{name} is the build you rolled back from. Not taking it again until {ref} moves on "
            "(or run `update --allow-rejected`).")
        if not args.check:
            record(config, "nothing", f"{name} was rolled back from")
        return EXIT_NOTHING
    if current:
        try:
            print_behind(config, sha_of(config, current), sha, ref)
        except UpdateError as error:
            log(f"  (could not list the commits: {error})")
    report = migration_report(config, sha)
    for line in t3core.report_lines(report):
        log(f"  {line}")
    if t3core.report_blocks_activation(report):
        raise UpdateError("the profile database does not match this build's migrations; not building it")
    if args.check:
        log("An update is available. Run `update` to build, test and mark it for the next start.")
        return EXIT_OK

    free = shutil.disk_usage(config.release_dir).free
    if free < MIN_FREE_BYTES:
        raise UpdateError(f"only {free // 1024 ** 3} GB free in {config.release_dir}; a build needs about 8 GB")
    running = running_builds(config)
    protected = t3core.protected_builds(pointer, running)
    log(f"Building {name}")
    build_dir, meta = build(config, sha, ref, protected)
    if (meta.get("smoke") or {}).get("passed"):
        log(f"  {name} already passed its smoke test at {meta['smoke'].get('at')}")
    else:
        meta = smoke(config, build_dir, meta)

    report = migration_report(config, sha)
    if t3core.report_blocks_activation(report):
        raise UpdateError("the profile database no longer matches this build's migrations; not activating it")
    if report["new"]:
        target = config.rollback_dir / t3core.backup_name(f"update-{name}")
        log(f"  backing up the profile database (new migrations): {target}")
        t3core.backup_database(config.database, target)
    pending = ({"build": name, "databaseHead": report["databaseHead"], "new": report["new"]}
               if report["new"] else None)
    pointer = modify_pointer(config, lambda p: t3core.activated(p, name, pending))
    log("")
    log(f"Ready: {name} ({meta.get('subject')}) is used the next time T3 Code starts.")
    log(f"previous = {pointer.get('previous')} (`rollback` goes back to it)")
    if pending:
        log("The launcher backs up the database once more right before the first start of the new build.")
    if app_running(config):
        log("T3 Code is running and was left alone: quit and start it when it suits you.")
    record(config, "updated", f"{pointer.get('previous')} -> {name}")
    return EXIT_OK


def cmd_rollback(config, args):
    require_config(config)
    pointer = t3core.read_pointer(config.pointer_path)
    previous = pointer.get("previous")
    if not previous:
        raise UpdateError("No previous build recorded.")
    build_dir = config.builds_dir / previous
    try:
        t3launch.check_build(config, build_dir)
    except t3launch.LaunchError as error:
        raise UpdateError(f"The previous build {previous} cannot be used: {error}")
    migrations_file = build_dir / t3core.MIGRATIONS_FILE
    build_migrations = t3core.parse_migrations(migrations_file.read_text(encoding="utf-8"))
    report = t3core.migration_report(build_migrations, t3core.recorded_migrations(config.database))
    if args.restore_db:
        source = Path(args.restore_db)
        if not source.is_file():
            raise UpdateError(f"{source} not found")
        if app_running(config):
            raise UpdateError("Quit T3 Code first: the database cannot be restored while the app has it open.")
        safety = config.rollback_dir / t3core.backup_name(f"before-restore-to-{previous}")
        t3core.backup_database(config.database, safety)
        log(f"Saved the current database to {safety}")
        for suffix in ("-wal", "-shm"):
            Path(str(config.database) + suffix).unlink(missing_ok=True)
        t3core.backup_database(source, config.database)
        log(f"Restored {source} into {config.database}")
        report = t3core.migration_report(build_migrations, t3core.recorded_migrations(config.database))
    if t3core.report_blocks_activation(report):
        for line in t3core.report_lines(report):
            log(f"  {line}")
        backups = sorted(config.rollback_dir.glob("statev2-*-before-*.sqlite")) + \
            sorted(config.rollback_dir.glob("statev2-*-update-*.sqlite"))
        log("The database has migrations the previous build does not know; it would refuse to start.")
        if backups:
            newest = max(backups, key=lambda p: p.stat().st_mtime)
            log(f"Newest pre-migration backup: {newest}")
            log(f"Quit T3 Code, then: t3update.py rollback --restore-db \"{newest}\"")
            log("(everything written since that backup is lost)")
        raise UpdateError("rollback needs a database restore")
    pointer = modify_pointer(config, t3core.rolled_back)
    log(f"current = {pointer['current']}, previous = {pointer['previous']}")
    log(f"{pointer['previous']} will not be taken again by `update` until {config.upstream_ref} moves on.")
    if app_running(config):
        log("T3 Code is running: quit and start it to switch.")
    record(config, "rollback", f"{pointer['previous']} -> {pointer['current']}")
    return EXIT_OK


def cmd_prune(config, args):
    require_config(config)
    if not config.builds_dir.is_dir():
        log("No builds folder.")
        return EXIT_NOTHING
    pointer = t3core.read_pointer(config.pointer_path)
    running = running_builds(config)
    keep = t3core.protected_builds(pointer, running)
    log(f"keeping: {', '.join(sorted(keep)) or '-'} (current, previous, running)")
    entries = os.listdir(config.builds_dir)
    candidates = t3core.prune_candidates(entries, pointer, running)
    if not candidates:
        log("Nothing to delete.")
        return EXIT_NOTHING
    registered = {Path(line[len("worktree "):]).resolve() for line in
                  git(config, "worktree", "list", "--porcelain").splitlines() if line.startswith("worktree ")}
    for entry in candidates:
        path = config.builds_dir / entry
        if args.dry_run:
            log(f"would delete {path}")
            continue
        # Look again right before deleting: a launch may have started since.
        if entry.removesuffix(".json") in running_builds(config):
            log(f"skipping {entry}: it is running now")
            continue
        log(f"deleting {path}")
        if path.is_dir():
            if path.resolve() in registered:
                git(config, "worktree", "remove", "--force", str(path), check=False)
            if path.exists():
                remove_tree(path)
            shutil.rmtree(config.smoke_dir / entry, ignore_errors=True)
        else:
            path.unlink()
    if not args.dry_run:
        git(config, "worktree", "prune", check=False)
    return EXIT_OK


def cmd_setup(config, args):
    created = not config.exists
    raw = dict(config.raw)
    if args.source_repo:
        raw["sourceRepo"] = str(Path(args.source_repo).resolve())
    if created and not config.is_windows:
        vp = shutil.which("vp") or (str(Path.home() / ".vite-plus" / "bin" / "vp")
                                    if (Path.home() / ".vite-plus" / "bin" / "vp").exists() else None)
        node = shutil.which("node")
        raw["vp"] = vp
        raw["pathPrepend"] = sorted({str(Path(p).parent) for p in (vp, node) if p})
    config = t3core.resolve_config(raw, config.path, config.platform)
    actions = []
    if created or args.source_repo:
        actions.append(f"write {config.path}")
    actions.append(f"copy the launcher to {launcher_dir(config)}")
    entry_path = icon_path = None
    if not config.is_windows:
        data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        entry_path = data_home / "applications" / "t3code-alex.desktop"
        icon_path = launcher_dir(config) / "icon.png"
        actions.append(f"write the app menu entry {entry_path}")
    log("setup will:" if args.dry_run else "setup:")
    for action in actions:
        log(f"  - {action}")
    cmd_config(config, argparse.Namespace(defaults=False))
    if args.dry_run:
        return EXIT_OK

    if created or args.source_repo:
        t3core.write_json_atomic(config.path, raw)
    target = launcher_dir(config)
    target.mkdir(parents=True, exist_ok=True)
    for name in LAUNCHER_FILES:
        shutil.copy2(TOOLS / name, target / name)
    if config.is_windows:
        log("")
        log("Windows: no shortcut was changed. The existing Start menu shortcut (Start-T3CodeRelease.pyw)")
        log(f"reads the same {config.pointer_path}. To use the in-repo launcher instead, point a shortcut at:")
        log(f'  pythonw.exe "{target / "t3launch.py"}"')
        return EXIT_OK

    launcher = target / "t3launch.py"
    launcher.chmod(0o755)
    icon_source = TOOLS.parent.parent / "assets" / "prod" / "black-universal-1024.png"
    if icon_source.is_file():
        shutil.copy2(icon_source, icon_path)
    entry_path.parent.mkdir(parents=True, exist_ok=True)
    entry_path.write_text(t3platform.render_desktop_entry(
        "T3 Code Alex", [sys.executable, str(launcher)], t3launch.LINUX_WM_CLASS,
        icon=str(icon_path) if icon_path.is_file() else None), encoding="utf-8", newline="\n")
    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(entry_path.parent)], check=False, capture_output=True)
    log(f"wrote {entry_path}")
    log("")
    log(f"profile: {config.home} ({'found' if config.database.is_file() else 'NOT FOUND: a new profile will be created'})")
    log(f"Electron profile: {config.user_data_dir} ({'found' if config.user_data_dir.is_dir() else 'not found'})")
    profile_text = t3platform.apparmor_profile_text(os.path.realpath(config.builds_dir))
    (target / "apparmor-t3code-alex-builds").write_text(profile_text, encoding="utf-8", newline="\n")
    sandbox_restricted = Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns").is_file() and \
        Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns").read_text().strip() == "1"
    if sandbox_restricted and not t3platform.APPARMOR_PROFILE.is_file():
        log("")
        log("Recommended, once (sudo): let the builds use Chromium's sandbox. Without it they run with")
        log("--no-sandbox, because this system only allows user namespaces to programs AppArmor names:")
        log(f'  sudo install -m 644 "{target / "apparmor-t3code-alex-builds"}" {t3platform.APPARMOR_PROFILE}')
        log(f"  sudo apparmor_parser -r {t3platform.APPARMOR_PROFILE}")
    if not shutil.which("Xvfb"):
        log("")
        log("Recommended, once (sudo): `sudo apt install xvfb`, so the update's smoke test runs on an invisible")
        log("display instead of opening a window on your desktop. Updates run outside the desktop session")
        log("(cron, a timer, `env -i`) need it: without a display their smoke test fails.")
    if Path("/opt/T3 Code Alex").exists() or shutil.which("t3code-alex"):
        log("")
        log("The old .deb install is still there. Once the new launcher works, remove it with:")
        log("  sudo apt remove t3code-alex")
        log("Your data stays: the profile and Electron folders above are not part of the package.")
    log("")
    log("Next: run `t3update.py update` to build and test the first build.")
    return EXIT_OK


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", help="config file (its folder is the tooling root)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("config", help="show the resolved per-machine settings")
    p.add_argument("--defaults", action="store_true", help="show the platform defaults, ignoring the file")
    p.set_defaults(func=cmd_config)
    p = sub.add_parser("status", help="installed, previous and running builds; what is new upstream")
    p.add_argument("--fetch", action="store_true", help="git fetch first")
    p.set_defaults(func=cmd_status)
    p = sub.add_parser("update", help="build, test and activate the newest origin/main")
    p.add_argument("--check", action="store_true", help="only report what an update would take")
    p.add_argument("--ref", help="build this ref instead of <remote>/<branch>")
    p.add_argument("--allow-rejected", action="store_true", help="take a build you rolled back from")
    p.set_defaults(func=cmd_update)
    p = sub.add_parser("rollback", help="use the previous build at the next start")
    p.add_argument("--restore-db", help="restore this database backup first (app must be closed)")
    p.set_defaults(func=cmd_rollback)
    p = sub.add_parser("prune", help="delete builds that are not current, previous or running")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_prune)
    p = sub.add_parser("setup", help="one-time per machine: config file, launcher, app menu entry")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--source-repo", help="the checkout builds are made from")
    p.set_defaults(func=cmd_setup)
    args = parser.parse_args(argv)
    try:
        config = t3core.load_config(args.config)
    except (ValueError, OSError) as error:
        log(f"FAILED: cannot read the config: {error}")
        return EXIT_FAILED
    try:
        return args.func(config, args)
    except (UpdateError, t3launch.LaunchError, SystemExit, RuntimeError, OSError, ValueError) as error:
        if isinstance(error, SystemExit) and error.code in (None, 0):
            return EXIT_OK
        message = str(error.code if isinstance(error, SystemExit) else error)
        log("")
        log(f"FAILED: {message}")
        if args.command == "update" and not getattr(args, "check", False):
            log("Nothing was activated; the current build stays in place.")
            try:
                record(config, "failed", message.splitlines()[0][:300])
            except OSError:
                pass
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
