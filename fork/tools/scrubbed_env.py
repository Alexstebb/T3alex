"""Run a command with every inherited T3 Code / dev-server variable removed.

Agent sessions inherit the live app's environment (T3CODE_DESKTOP_DEV=1, T3CODE_HOME=<live profile>,
VITE_DEV_SERVER_URL, NODE_ENV=development, NODE_PATH into a checkout, ...). Any of those turns a
production build or launch into something that talks to, or behaves like, the live app: on
2026-11-24 a build started that way relaunched Electron every few seconds against the live
profile's single-instance lock and the live window stole focus.

Usage as a CLI (uses the per-machine config for the PATH entries to put first):
    python scrubbed_env.py [--cwd DIR] [--set NAME=VALUE ...] [--log FILE] [--print-env] -- command args...

Usage as a module: scrubbed_environment(extra={...}, path_prepend=[...], drop_path_under=[...]) -> dict
"""

import argparse
import os
from pathlib import Path
import subprocess
import sys

# Prefixes are compared case-insensitively (Windows environment names are case-insensitive).
SCRUB_PREFIXES = (
    "T3CODE_", "T3_", "VITE_", "ELECTRON_",
    "VP_", "NPM_", "PNPM_", "NODE_", "INIT_CWD",
    "CLAUDE", "CODEX_",
)
# Exact names: an AppImage's runtime variables (they make the app think it is that AppImage) and
# git's repository overrides (they would point every `git -C` at another repository).
SCRUB_NAMES = {"APPIMAGE", "APPDIR", "ARGV0", "OWD", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"}


def is_scrubbed(name):
    upper = name.upper()
    return upper.startswith(SCRUB_PREFIXES) or upper in SCRUB_NAMES


def _drop_path_entry(entry, drop_under):
    # vp/pnpm prepend every ancestor's node_modules/.bin; vp re-adds the right ones itself.
    if os.path.normcase(entry.rstrip("\\/")).endswith(os.path.normcase(os.path.join("node_modules", ".bin"))):
        return True
    try:
        resolved = Path(entry).resolve()
    except (OSError, ValueError):
        return False
    for directory in drop_under:
        try:
            resolved.relative_to(Path(directory).resolve())
            return True
        except (ValueError, OSError):
            continue
    return False


def scrubbed_environment(extra=None, base=None, path_prepend=(), drop_path_under=()):
    source = dict(os.environ if base is None else base)
    env = {name: value for name, value in source.items() if not is_scrubbed(name)}
    path_key = next((k for k in env if k.upper() == "PATH"), "PATH")
    entries = [e for e in env.pop(path_key, "").split(os.pathsep) if e and not _drop_path_entry(e, drop_path_under)]
    first = [str(p) for p in path_prepend]
    first_keys = {os.path.normcase(p) for p in first}
    env["PATH"] = os.pathsep.join(first + [e for e in entries if os.path.normcase(e) not in first_keys])
    for name, value in (extra or {}).items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    return env


def config_environment(config, extra=None):
    """The scrubbed environment for builds and helper scripts on this machine."""
    return scrubbed_environment(extra, path_prepend=config.path_prepend, drop_path_under=[config.source_repo])


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from t3core import load_config

    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    parser.add_argument("--cwd")
    parser.add_argument("--set", action="append", default=[], metavar="NAME=VALUE")
    parser.add_argument("--log")
    parser.add_argument("--print-env", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    extra = dict(item.split("=", 1) for item in args.set)
    env = config_environment(load_config(args.config), extra)
    if args.print_env:
        for name in sorted(env):
            print(f"{name}={env[name]}")
        return 0
    if not command:
        parser.error("missing command")
    out = open(args.log, "a", encoding="utf-8", newline="\n") if args.log else None
    try:
        return subprocess.run(
            command, cwd=args.cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=out, stderr=subprocess.STDOUT if out else None,
        ).returncode
    finally:
        if out:
            out.close()


if __name__ == "__main__":
    sys.exit(main())
