"""One supervised start of a build against a neutralised copy of the profile, before it is activated.

    t3smoke.py <build dir> <work dir> [--config FILE] [--text FILE] [--probe SCRIPT ARGS...]

The copy (smoke_copy) has every scheduled task disabled, every provider off and restart
continuation off, so the test instance cannot start agents or act on the world. The instance gets
its own T3 home, Electron profile (so its own single-instance lock) and app id, no pinned port, and
on Linux its own XDG data folder (the app rewrites its desktop entry at every start). It opens
minimized on Windows and inside a private Xvfb display on Linux when Xvfb is installed. Only the
process tree this script started is stopped, and that is verified.

`--probe` runs `<electron as node> SCRIPT <debug port> ARGS...` before the window closes, e.g.
cdp_runs_panel.mjs to measure a layout in the real build.
"""

from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from scrubbed_env import config_environment  # noqa: E402
import t3core  # noqa: E402
import t3launch  # noqa: E402
import t3platform  # noqa: E402

SMOKE_FILES = ("settings.json", "client-settings.json", "desktop-settings.json", "keybindings.json",
               "keybindings-migrations", "environment-id", "anonymous-id", "desktop-host-scope")
SMOKE_DIRS = ("attachments", "themes")
PROBE = TOOLS / "cdp_probe.mjs"


def _inside(path, parent):
    path, parent = Path(path).resolve(), Path(parent).resolve()
    return path == parent or parent in path.parents


def refuse_live(config, *paths):
    for path in paths:
        for live in (config.home, config.user_data_dir):
            if _inside(path, live) or _inside(live, path):
                raise SystemExit(f"Refusing: {path} overlaps the live profile {live}")


def smoke_copy(config, target, replace=False):
    """Copy the profile for a throwaway test and neutralise everything that acts on the world:
    no restart continuation of running agent turns, no scheduled tasks, no providers, no devices."""
    target = Path(target).resolve()
    refuse_live(config, target)
    if target.exists():
        if not replace:
            raise SystemExit(f"{target} exists (use --replace)")
        shutil.rmtree(target)
    source, staged = config.home / "userdata", target / "userdata"
    if not (source / "statev2.sqlite").is_file():
        raise SystemExit(f"No profile database at {source / 'statev2.sqlite'}")
    staged.mkdir(parents=True)
    t3core.backup_database(source / "statev2.sqlite", staged / "statev2.sqlite")
    for name in SMOKE_FILES:
        if (source / name).is_file():
            shutil.copy2(source / name, staged / name)
    for name in SMOKE_DIRS:
        if (source / name).is_dir():
            shutil.copytree(source / name, staged / name)
    settings_path = staged / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.is_file() else {}
    settings["continueThreadsAfterServerUpdate"] = False
    settings["enableDeviceSupport"] = False
    settings["enableAgentDeviceAccess"] = False
    for instance in (settings.get("providerInstances") or {}).values():
        if isinstance(instance, dict):
            instance["enabled"] = False
    for override in (settings.get("projectSettingsOverrides") or {}).values():
        if isinstance(override, dict):
            override.pop("continueThreadsAfterServerUpdate", None)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8", newline="\n")
    disabled = 0
    with closing(sqlite3.connect(staged / "statev2.sqlite")) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(scheduled_tasks)")}
        if "enabled" in columns:
            disabled = db.execute("UPDATE scheduled_tasks SET enabled = 0 WHERE enabled != 0").rowcount
            db.commit()
    return {"target": str(target), "scheduledTasksDisabled": disabled}


def free_port():
    with closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def node_command(config, build, script, *args):
    """Probes run on the build's own Electron as Node (Node 24, fetch and WebSocket built in)."""
    return [str(config.electron_path(build)), str(script), *map(str, args)]


def node_env(config):
    return config_environment(config, {"ELECTRON_RUN_AS_NODE": "1"})


def evaluate(result, log_text):
    """What is wrong with a smoke run; empty when it passed."""
    problems = []
    if result.get("error"):
        problems.append(result["error"])
    if result.get("secondsToDevtools") is None:
        problems.append("the app never opened its debugging port")
    probe = result.get("probe")
    if not isinstance(probe, dict) or probe.get("error"):
        problems.append(f"the window never showed the app ({str(probe)[:300]})")
    else:
        if (probe.get("textLength") or 0) < 200:
            problems.append(f"the window shows almost nothing ({probe.get('textLength')} characters)")
        if probe.get("viteClient"):
            problems.append("the renderer loads the Vite dev client")
        if probe.get("reactDevBuild") is True:
            problems.append("the renderer is a development React build")
    if "backend ready" not in log_text:
        problems.append("the backend never reported ready (see the smoke log)")
    if result.get("leftoverAfterCleanup"):
        problems.append(f"processes survived the cleanup: {result['leftoverAfterCleanup']}")
    if result.get("protocolRestored") is False:
        problems.append("the t3code:// handler changed and could not be restored")
    return problems


def run_smoke(config, build, workdir, log_path, text_path=None, probe_args=None, startup_timeout=90):
    build, workdir = Path(build).resolve(), Path(workdir).resolve()
    home, user_data = workdir / "home", workdir / "userdata"
    refuse_live(config, home, user_data, workdir)
    if not (home / "userdata" / "statev2.sqlite").is_file():
        raise SystemExit(f"{home} is not a profile copy; run smoke_copy first")
    t3launch.check_build(config, build)
    meta = t3core.read_meta(config, build.name) or {}
    user_data.mkdir(parents=True, exist_ok=True)
    local_state = config.user_data_dir / "Local State"
    if not (user_data / "Local State").exists() and local_state.is_file():
        shutil.copy2(local_state, user_data / "Local State")  # keeps safeStorage-encrypted values readable
    extra = {}
    extra_args = []
    xvfb = None
    result = {"build": build.name, "home": str(home), "userData": str(user_data)}
    if not config.is_windows:
        extra["XDG_DATA_HOME"] = str(workdir / "xdg-data")
        try:
            xvfb = t3platform.start_xvfb()
        except Exception as error:
            result["xvfbError"] = str(error)
        if xvfb:
            extra["DISPLAY"] = xvfb[1]
            extra_args.append("--ozone-platform=x11")
        result["display"] = xvfb[1] if xvfb else "the desktop (Xvfb not installed)"
    port = free_port()
    aumid = f"{config.app_user_model_id}.smoke" if config.app_user_model_id else None
    env = t3launch.app_environment(config, build, meta, home, user_data, port=None, app_user_model_id=aumid,
                                   extra=extra)
    if xvfb:
        env.pop("WAYLAND_DISPLAY", None)
    t3launch.write_app_folder(config, build)
    command = t3launch.electron_command(config, build, [f"--remote-debugging-port={port}", *extra_args])
    result["command"] = command
    result["sandbox"] = t3platform.linux_sandbox_state(config.electron_path(build))[1]
    original_protocol = t3platform.read_protocol_handler()
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    out = open(log_path, "w", encoding="utf-8", newline="\n")
    started = time.monotonic()
    process = subprocess.Popen(command, cwd=str(build / "apps" / "desktop"), env=env, stdin=subprocess.DEVNULL,
                               stdout=out, stderr=subprocess.STDOUT, startupinfo=t3platform.minimized_startupinfo(),
                               start_new_session=not config.is_windows)
    result["electronPid"] = process.pid
    ids = [process.pid]
    try:
        while time.monotonic() - started < startup_timeout:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
                result["secondsToDevtools"] = round(time.monotonic() - started, 2)
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError(f"Electron exited during startup with code {process.returncode}")
                time.sleep(0.25)
        else:
            raise RuntimeError(f"Electron did not open its debugging port within {startup_timeout} s")
        probe = subprocess.run(node_command(config, build, PROBE, port, "probe"), capture_output=True, text=True,
                               encoding="utf-8", timeout=150, env=node_env(config), stdin=subprocess.DEVNULL)
        result["secondsToUiReady"] = round(time.monotonic() - started - 5, 2)  # the probe waits 5 s after text
        try:
            result["probe"] = json.loads(probe.stdout)
        except ValueError:
            result["probe"] = (probe.stdout + probe.stderr)[-2000:]
        if text_path is not None:
            text = subprocess.run(node_command(config, build, PROBE, port, "text"), capture_output=True,
                                  text=True, encoding="utf-8", timeout=60, env=node_env(config),
                                  stdin=subprocess.DEVNULL)
            Path(text_path).write_text(text.stdout, encoding="utf-8", newline="\n")
        if probe_args:
            extra_out = subprocess.run(node_command(config, build, probe_args[0], port, *probe_args[1:]),
                                       capture_output=True, text=True, encoding="utf-8", timeout=180,
                                       env=node_env(config), stdin=subprocess.DEVNULL)
            try:
                result["extra"] = json.loads(extra_out.stdout)
            except ValueError:
                result["extra"] = (extra_out.stdout + extra_out.stderr)[-3000:]
        ids = t3platform.process_tree(process.pid)
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
        try:
            ids = t3platform.process_tree(process.pid)
        except Exception:
            pass
    finally:
        try:
            subprocess.run(node_command(config, build, PROBE, port, "close"), timeout=20, capture_output=True,
                           env=node_env(config), stdin=subprocess.DEVNULL)
        except Exception:
            pass
        try:
            process.wait(timeout=30)
            result["exit"] = f"graceful ({process.returncode})"
        except subprocess.TimeoutExpired:
            t3platform.kill_tree(process.pid)
            process.wait(timeout=30)
            result["exit"] = "killed"
        time.sleep(3)
        leftovers = t3platform.alive([pid for pid in ids if pid != process.pid])
        if leftovers:
            t3platform.kill(leftovers)
            time.sleep(2)
        result["leftoverAfterExit"] = leftovers
        result["leftoverAfterCleanup"] = t3platform.alive([pid for pid in ids if pid != process.pid])
        if config.is_windows:
            now = t3platform.read_protocol_handler()
            if original_protocol is not None and now != original_protocol:
                t3platform.write_protocol_handler(original_protocol)
            result["protocolRestored"] = t3platform.read_protocol_handler() == original_protocol
        if xvfb:
            xvfb[0].terminate()
            try:
                xvfb[0].wait(timeout=10)
            except subprocess.TimeoutExpired:
                xvfb[0].kill()
        out.close()
    result["problems"] = evaluate(result, log_path.read_text(encoding="utf-8", errors="replace"))
    result["passed"] = not result["problems"]
    return result


def main():
    args = sys.argv[1:]
    config_path = None
    if "--config" in args:
        index = args.index("--config")
        config_path = args[index + 1]
        del args[index:index + 2]
    text_path = None
    if "--text" in args:
        index = args.index("--text")
        text_path = args[index + 1]
        del args[index:index + 2]
    probe_args = None
    if "--probe" in args:
        index = args.index("--probe")
        probe_args = args[index + 1:]
        del args[index:]
    if len(args) != 2:
        raise SystemExit(__doc__)
    config = t3core.load_config(config_path)
    build, workdir = Path(args[0]), Path(args[1])
    copied = smoke_copy(config, workdir / "home", replace=True)
    print(json.dumps(copied))
    result = run_smoke(config, build, workdir, workdir / "smoke.log", text_path, probe_args)
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
