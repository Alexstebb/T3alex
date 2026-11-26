"""Shared logic of the fork's updater: per-machine config, the build pointer, git and migration
parsing, prune selection and SQLite copies. Python 3 standard library only; no side effects at
import time, so the launcher copy and the unit tests can import it freely."""

from contextlib import closing
from dataclasses import dataclass, field
import datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

CONFIG_NAME = "t3update.json"
CONFIG_VERSION = 1
BUILD_NAME = re.compile(r"^[0-9a-f]{7,40}$")
MIGRATION_ENTRY = re.compile(r'^\s*\[(\d+),\s*"([A-Za-z0-9_]+)",\s*Migration\d+\]', re.M)
MIGRATIONS_FILE = "apps/server/src/persistence/Migrations.ts"
# A build is used through these environment variables; one that does not know them would open the
# installed app's profile or register t3code://, so the updater refuses it.
REQUIRED_BUILD_FEATURES = ("T3CODE_DESKTOP_USER_DATA_DIR", "T3CODE_DESKTOP_SKIP_PROTOCOL_REGISTRATION")


def is_windows(platform=None):
    return (platform or sys.platform) == "win32"


# ---------------------------------------------------------------- config

def default_config_path(platform=None, env=None, home=None):
    """Where the per-machine config lives. Its folder is the tooling root (builds, pointer, logs)."""
    env = os.environ if env is None else env
    home = Path(home or Path.home())
    if is_windows(platform):
        local = env.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        return Path(local) / "T3CodeFork" / CONFIG_NAME
    data = env.get("XDG_DATA_HOME") or str(home / ".local" / "share")
    return Path(data) / "t3code-alex" / CONFIG_NAME


def default_config(platform=None, env=None, home=None):
    """Defaults per platform. Relative paths resolve against the config file's folder.

    Windows reproduces the release setup of 2026-11-24 exactly (root %LOCALAPPDATA%\\T3CodeFork,
    profile live, port 14084, unbranded build). Linux uses the branded build's own data folders, so
    the profile of the old .deb install carries over."""
    env = os.environ if env is None else env
    home = Path(home or Path.home())
    if is_windows(platform):
        return {
            "version": CONFIG_VERSION,
            "sourceRepo": str(home / "Documents" / "Codex" / "t3code"),
            "remote": "origin",
            "branch": "main",
            "releaseDir": "release",
            "home": "live",
            "userDataDir": "release/userdata",
            "rollbackDir": "rollback",
            "pendingDir": "pending",
            "port": 14084,
            "brand": "",
            "appUserModelId": "com.t3tools.t3code.alexrelease",
            "launchLock": "release-launch.lock",
            "otherLocks": ["live-launch.lock"],
            "pathPrepend": ["toolchain/node_modules/node/bin"],
            "vp": "toolchain/node_modules/.bin/vp.cmd",
            "electronArgs": [],
            "copyEnvExample": True,
            "appName": None,
        }
    config_home = Path(env.get("XDG_CONFIG_HOME") or home / ".config")
    return {
        "version": CONFIG_VERSION,
        "sourceRepo": str(home / "src" / "t3code-alex"),
        "remote": "origin",
        "branch": "main",
        "releaseDir": "release",
        "home": str(home / ".t3-alex"),
        "userDataDir": str(config_home / "t3code-alex"),
        "rollbackDir": "rollback",
        "pendingDir": "pending",
        "port": None,
        "brand": "alex",
        "appUserModelId": None,
        "launchLock": "release-launch.lock",
        "otherLocks": [],
        "pathPrepend": [],
        "vp": None,
        "electronArgs": [],
        "copyEnvExample": True,
        # The .deb's package name: Electron files its safeStorage key in the keyring under it.
        "appName": "t3code-alex",
    }


@dataclass
class Config:
    path: Path
    root: Path
    exists: bool
    raw: dict
    platform: str
    source_repo: Path
    remote: str
    branch: str
    release_dir: Path
    home: Path
    user_data_dir: Path
    rollback_dir: Path
    pending_dir: Path
    port: object
    brand: str
    app_user_model_id: object
    launch_lock: Path
    other_locks: list = field(default_factory=list)
    path_prepend: list = field(default_factory=list)
    vp: object = None
    electron_args: list = field(default_factory=list)
    copy_env_example: bool = True
    app_name: object = None

    @property
    def builds_dir(self):
        return self.release_dir / "builds"

    @property
    def pointer_path(self):
        return self.release_dir / "current.json"

    @property
    def logs_dir(self):
        return self.release_dir / "logs"

    @property
    def smoke_dir(self):
        return self.release_dir / "smoke"

    @property
    def database(self):
        return self.home / "userdata" / "statev2.sqlite"

    @property
    def upstream_ref(self):
        return f"{self.remote}/{self.branch}"

    @property
    def is_windows(self):
        return is_windows(self.platform)

    def electron_path(self, build_dir):
        dist = build_dir / "apps" / "desktop" / "node_modules" / "electron" / "dist"
        return dist / ("electron.exe" if self.is_windows else "electron")


def resolve_config(raw, path, platform=None):
    platform = platform or sys.platform
    root = Path(path).parent

    def resolved(value):
        candidate = Path(os.path.expanduser(str(value)))
        return candidate if candidate.is_absolute() else root / candidate

    unknown = sorted(set(raw) - set(default_config(platform)))
    if unknown:
        raise ValueError(f"{path}: unknown setting(s) {', '.join(unknown)}")
    if raw.get("version") != CONFIG_VERSION:
        raise ValueError(f"{path}: expected \"version\": {CONFIG_VERSION}")
    port = raw.get("port")
    if port is not None and (not isinstance(port, int) or not 0 < port < 65536):
        raise ValueError(f"{path}: port must be a number or null")
    return Config(
        path=Path(path), root=root, exists=Path(path).is_file(), raw=raw, platform=platform,
        source_repo=resolved(raw["sourceRepo"]), remote=raw["remote"], branch=raw["branch"],
        release_dir=resolved(raw["releaseDir"]), home=resolved(raw["home"]),
        user_data_dir=resolved(raw["userDataDir"]), rollback_dir=resolved(raw["rollbackDir"]),
        pending_dir=resolved(raw["pendingDir"]), port=port, brand=raw.get("brand") or "",
        app_user_model_id=raw.get("appUserModelId"), launch_lock=resolved(raw["launchLock"]),
        other_locks=[resolved(p) for p in raw.get("otherLocks") or []],
        path_prepend=[str(resolved(p)) for p in raw.get("pathPrepend") or []],
        vp=str(resolved(raw["vp"])) if raw.get("vp") else None,
        electron_args=list(raw.get("electronArgs") or []),
        copy_env_example=bool(raw.get("copyEnvExample", True)),
        app_name=raw.get("appName") or None,
    )


def load_config(path=None, platform=None):
    """The config file if there is one, otherwise the platform defaults (exists=False)."""
    platform = platform or sys.platform
    path = Path(path) if path else default_config_path(platform)
    if path.is_file():
        raw = {**default_config(platform), **json.loads(path.read_text(encoding="utf-8"))}
    else:
        raw = default_config(platform)
    return resolve_config(raw, path, platform)


def write_json_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


# ---------------------------------------------------------------- pointer (release/current.json)

def empty_pointer():
    return {"current": None, "previous": None, "pendingDbBackup": None, "history": []}


def read_pointer(path):
    if not Path(path).is_file():
        return empty_pointer()
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    for key, value in empty_pointer().items():
        data.setdefault(key, value)
    return data


def now_stamp():
    return datetime.datetime.now().isoformat(timespec="seconds")


def activated(pointer, name, pending_backup=None, at=None):
    """The pointer after making `name` current. Keeps unknown keys (the launcher adds lastDbBackup)."""
    if pointer.get("current") == name:
        return dict(pointer)
    result = dict(pointer)
    result["history"] = list(pointer.get("history") or []) + [
        {"at": at or now_stamp(), "from": pointer.get("current"), "to": name}]
    result["previous"], result["current"] = pointer.get("current"), name
    # Start_T3CodeRelease.pyw and t3launch.py take this backup right before the first start.
    result["pendingDbBackup"] = pending_backup
    if name in (pointer.get("rejected") or []):
        result["rejected"] = [other for other in pointer["rejected"] if other != name]
    return result


def rolled_back(pointer, at=None):
    """The pointer after going back to the previous build. The build left behind is remembered in
    `rejected`, so an unattended update does not bring it straight back."""
    if not pointer.get("previous"):
        raise ValueError("No previous build recorded.")
    result = dict(pointer)
    left = pointer.get("current")
    result["history"] = list(pointer.get("history") or []) + [
        {"at": at or now_stamp(), "from": left, "to": pointer["previous"], "rollback": True}]
    result["current"], result["previous"] = pointer["previous"], left
    result["pendingDbBackup"] = None
    rejected = [name for name in pointer.get("rejected") or [] if name != left]
    result["rejected"] = (rejected + [left])[-10:] if left else rejected
    return result


# ---------------------------------------------------------------- git output

def parse_ahead_behind(output):
    """`git rev-list --left-right --count A...B` -> (only in A, only in B)."""
    parts = output.split()
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        raise ValueError(f"unexpected rev-list output: {output!r}")
    return int(parts[0]), int(parts[1])


def parse_log(output):
    """`git log --format=%h%x09%s` -> [(short sha, subject)]."""
    commits = []
    for line in output.splitlines():
        if not line.strip():
            continue
        sha, _, subject = line.partition("\t")
        commits.append((sha.strip(), subject.strip()))
    return commits


def build_name(sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        raise ValueError(f"not a full commit sha: {sha!r}")
    return sha[:9]


# ---------------------------------------------------------------- prune selection

def protected_builds(pointer, running):
    return {name for name in (pointer.get("current"), pointer.get("previous"), *running) if name}


def prune_candidates(entries, pointer, running):
    """Which entries under builds/ may be deleted: never current, previous or a running build, and
    only names that look like a build (so a stray folder of something else is left alone)."""
    keep = protected_builds(pointer, running)
    candidates = []
    for entry in sorted(entries):
        stem = entry[:-5] if entry.endswith(".json") else entry
        if not BUILD_NAME.match(stem) or stem in keep:
            continue
        if any(stem.startswith(k) or k.startswith(stem) for k in keep):
            continue  # an abbreviation of a protected build: leave it
        candidates.append(entry)
    return candidates


def builds_in_use(executable_paths, builds_dir):
    """Names of builds that a running process was started from (its executable lies inside)."""
    base = os.path.normcase(os.path.abspath(str(builds_dir)))
    names = set()
    for exe in executable_paths:
        if not exe:
            continue
        path = os.path.normcase(os.path.abspath(str(exe)))
        if path.startswith(base + os.sep):
            first = path[len(base) + 1:].split(os.sep, 1)[0]
            if first:
                names.add(first)
    return names


# ---------------------------------------------------------------- migrations

def parse_migrations(source):
    entries = [(int(i), n) for i, n in MIGRATION_ENTRY.findall(source)]
    if not entries:
        raise ValueError("Could not read the migration list")
    return entries


def recorded_migrations(db_path):
    """Read-only look at effect_sql_migrations; never writes to the database."""
    if not Path(db_path).is_file():
        return []
    uri = Path(db_path).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True, timeout=30)) as db:
        has_table = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='effect_sql_migrations'").fetchone()
        if not has_table:
            return []
        return [(int(i), str(n)) for i, n in
                db.execute("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")]


def migration_report(build, recorded):
    recorded_by_id = dict(recorded)
    build_by_id = dict(build)
    head = max(recorded_by_id, default=0)
    return {
        "buildHead": max(build_by_id),
        "databaseHead": head,
        # Effect's migrator runs only ids above the highest recorded one.
        "new": [f"{i}_{n}" for i, n in build if i > head],
        "skippedGaps": [f"{i}_{n}" for i, n in build if i <= head and i not in recorded_by_id],
        "nameMismatches": [f"{i}: build {build_by_id[i]!r} vs database {recorded_by_id[i]!r}"
                           for i in sorted(set(build_by_id) & set(recorded_by_id))
                           if build_by_id[i] != recorded_by_id[i]],
        "databaseAhead": [f"{i}_{n}" for i, n in recorded if i not in build_by_id],
    }


def report_blocks_activation(report):
    return bool(report["nameMismatches"] or report["databaseAhead"])


def report_lines(report):
    lines = [f"build migration head:    {report['buildHead']}",
             f"profile database head:   {report['databaseHead']}"]
    if report["new"]:
        lines.append(f"NEW migrations ({len(report['new'])}, one-way):")
        lines += [f"  + {name}" for name in report["new"]]
    else:
        lines.append("no new migrations")
    for key, label in (("nameMismatches", "NAME MISMATCH (the migrator will refuse the database)"),
                       ("databaseAhead", "the database has migrations this build does not know"),
                       ("skippedGaps", "the build has ids below the database head that never ran")):
        lines += [f"! {label}: {item}" for item in report[key]]
    return lines


# ---------------------------------------------------------------- database copies

def backup_database(source, target):
    """Consistent copy with SQLite's backup API (safe while the app has the database open)."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".partial")
    partial.unlink(missing_ok=True)
    with closing(sqlite3.connect(Path(source).resolve().as_uri() + "?mode=ro", uri=True, timeout=60)) as original:
        with closing(sqlite3.connect(partial)) as copy:
            original.backup(copy)
            if copy.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise RuntimeError(f"quick_check failed for the copy {partial}")
    os.replace(partial, target)
    return target


def backup_name(reason, at=None):
    stamp = (at or datetime.datetime.now()).strftime("%Y%m%d-%H%M%S")
    return f"statev2-{stamp}-{reason}.sqlite"


# ---------------------------------------------------------------- build checks

def build_understands(main_cjs_bytes):
    return [name for name in REQUIRED_BUILD_FEATURES if name.encode() not in main_cjs_bytes]


def required_build_files(config, build_dir):
    desktop = build_dir / "apps" / "desktop"
    return [
        desktop / "dist-electron" / "main.cjs",
        desktop / "dist-electron" / "preload.cjs",
        build_dir / "apps" / "server" / "dist" / "bin.mjs",
        build_dir / "apps" / "server" / "dist" / "client" / "index.html",
        config.electron_path(build_dir),
    ]


def read_meta(config, name):
    path = config.builds_dir / f"{name}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None
