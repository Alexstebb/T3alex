#!/usr/bin/env python3
"""Start the current build of T3 Code against this machine's profile.

`t3update.py setup` copies this folder to <root>/launcher/ and points the app menu (Linux) at it, so
the launcher does not change when the source checkout does. The build to run is named in
<releaseDir>/current.json. Before the first start of a build with new database migrations it backs
up the database (pendingDbBackup), then applies pending client-settings edits, then starts Electron
with the profile, Electron profile and port from the config and waits for it to exit.

    t3launch.py [--config FILE] [--check]

The smoke test starts builds through app_environment()/electron_command() as well, so every
update exercises the code this launcher uses.
"""

import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrubbed_env import is_scrubbed  # noqa: E402
import t3core  # noqa: E402
import t3platform  # noqa: E402

LINUX_WM_CLASS = "com.t3tools.t3code.alex"


class LaunchError(Exception):
    pass


def resolve_current(config):
    pointer = t3core.read_pointer(config.pointer_path)
    name = pointer.get("current")
    if not name:
        raise LaunchError(f"No build is marked as current in {config.pointer_path}.")
    build = config.builds_dir / name
    check_build(config, build)
    return pointer, build, t3core.read_meta(config, name) or {}


def check_build(config, build):
    missing = [str(p) for p in t3core.required_build_files(config, build) if not p.is_file()]
    if missing:
        raise LaunchError("The build is incomplete; missing:\n  " + "\n  ".join(missing))
    unknown = t3core.build_understands((build / "apps" / "desktop" / "dist-electron" / "main.cjs").read_bytes())
    if unknown:
        raise LaunchError(f"{build.name} is too old for this launcher (does not know {', '.join(unknown)}).")


def app_environment(config, build, meta, home, user_data, port=None, app_user_model_id=None,
                    launcher_path=None, extra=None):
    """The environment the app runs with. Inherited T3 Code / dev-server variables are dropped; PATH
    is left as it is, because agents started by the app inherit it."""
    env = {name: value for name, value in os.environ.items() if not is_scrubbed(name)}
    env.update({
        "T3CODE_HOME": str(home),
        "T3CODE_DESKTOP_USER_DATA_DIR": str(user_data),
        "T3CODE_DESKTOP_SKIP_PROTOCOL_REGISTRATION": "1",
        "T3CODE_DISABLE_AUTO_UPDATE": "true",
        "T3CODE_TELEMETRY_ENABLED": "false",
        "T3CODE_COMMIT_HASH": meta.get("sha", build.name),
    })
    if port:
        env["T3CODE_PORT"] = str(port)
    if app_user_model_id:
        env["T3CODE_DESKTOP_APP_USER_MODEL_ID"] = app_user_model_id
    if launcher_path:
        # Linux: the app rewrites its URL-handler desktop entry at every start; without this it would
        # point at this build's electron binary, which prune deletes later.
        env["T3CODE_DESKTOP_LAUNCHER_PATH"] = str(launcher_path)
    env.update(extra or {})
    return env


def electron_command(config, build, extra_args=()):
    electron = config.electron_path(build)
    sandbox_args, _why = t3platform.linux_sandbox_state(electron)
    return [str(electron), *sandbox_args, *config.electron_args, *extra_args, "dist-electron/main.cjs"]


def take_pending_backup(config):
    """The backup activation asked for, taken now that nothing has the database open."""
    with t3platform.FileLock(config.release_dir / "pointer.lock"):
        pointer = t3core.read_pointer(config.pointer_path)
        pending = pointer.get("pendingDbBackup")
        if not pending or not config.database.is_file():
            return None
        target = config.rollback_dir / t3core.backup_name(f"before-{pending['build']}")
        t3core.backup_database(config.database, target)
        pointer["pendingDbBackup"] = None
        pointer["lastDbBackup"] = {"path": str(target), "build": pending["build"],
                                   "databaseHead": pending.get("databaseHead")}
        t3core.write_json_atomic(config.pointer_path, pointer)
        return target


def apply_pending_settings(config, build):
    """A failure here must never stop the app from starting."""
    try:
        if config.pending_dir.is_dir() and any(config.pending_dir.glob("*.json")):
            from apply_pending_settings import apply_pending
            apply_pending(config.home, config.pending_dir, config.rollback_dir, build)
    except Exception as error:
        try:
            from apply_pending_settings import log
            log(config.pending_dir, f"FAILED: {type(error).__name__}: {error}")
        except Exception:
            pass


def launch(config, check=False):
    for lock in config.other_locks:
        if t3platform.lock_is_held(lock):
            raise LaunchError(f"Another T3 Code launcher holds {lock} for the same profile. "
                              "Quit that app completely and start this one again.")
    pointer, build, meta = resolve_current(config)
    launcher_path = Path(__file__).resolve() if not config.is_windows else None
    env = app_environment(config, build, meta, config.home, config.user_data_dir, config.port,
                          config.app_user_model_id, launcher_path)
    command = electron_command(config, build)
    desktop = build / "apps" / "desktop"
    if check:
        print(f"build:        {build.name} {meta.get('subject', '')}")
        print(f"command:      {command} (cwd {desktop})")
        print(f"T3CODE_HOME:  {env['T3CODE_HOME']}")
        print(f"userData:     {env['T3CODE_DESKTOP_USER_DATA_DIR']}")
        print(f"port:         {env.get('T3CODE_PORT', 'not pinned')}")
        print(f"sandbox:      {t3platform.linux_sandbox_state(config.electron_path(build))[1]}")
        print(f"pending DB backup before start: {pointer.get('pendingDbBackup')}")
        print("T3/VITE/ELECTRON/NODE variables passed:",
              sorted(k for k in env if k.upper().startswith(("T3CODE_", "T3_", "VITE_", "ELECTRON_", "NODE_"))))
        return 0
    lock = t3platform.FileLock(config.launch_lock)
    if not lock.try_acquire():
        return 0  # this launcher already runs the app
    try:
        take_pending_backup(config)
        apply_pending_settings(config, build)
        log_path = config.logs_dir / "app-last.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        with log_path.open("w", encoding="utf-8", newline="\n") as log:
            process = subprocess.Popen(command, cwd=desktop, env=env, stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, creationflags=t3platform.NO_WINDOW)
            code = process.wait()
        if code != 0:
            when = "under oppstart" if time.monotonic() - started < 60 else "uventet"
            t3platform.notify("T3 Code", f"T3 Code avsluttet {when} (kode {code}). Se {log_path}.")
        return code
    finally:
        lock.release()


def config_path_for_launcher(argv):
    if "--config" in argv:
        return Path(argv[argv.index("--config") + 1])
    beside = Path(__file__).resolve().parent.parent / t3core.CONFIG_NAME
    return beside if beside.is_file() else None


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    check = "--check" in argv
    try:
        config = t3core.load_config(config_path_for_launcher(argv))
        return launch(config, check=check)
    except Exception as error:
        if check:
            raise
        t3platform.notify("T3 Code", f"T3 Code kunne ikke starte. Profilen er ikke endret. "
                                     f"({type(error).__name__}: {error})")
        return 1


if __name__ == "__main__":
    sys.exit(main())
