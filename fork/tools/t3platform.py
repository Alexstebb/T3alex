"""Everything that differs between Windows and Linux: process tables, locks, killing a process tree,
notifications, the Linux Chromium sandbox, Xvfb and desktop entries. Each function checks the
platform itself; callers stay platform-neutral."""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

IS_WINDOWS = sys.platform == "win32"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
APPARMOR_PROFILE = Path("/etc/apparmor.d/t3code-alex-builds")


# ---------------------------------------------------------------- locks

class FileLock:
    """An exclusive lock on byte 0 of a file. On Windows the same byte-range lock the old
    Start-T3CodeRelease.pyw takes, so both see each other; on Linux flock(2)."""

    def __init__(self, path):
        self.path = Path(path)
        self.handle = None

    def try_acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            if IS_WINDOWS:
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def acquire(self, timeout=30):
        deadline = time.monotonic() + timeout
        while not self.try_acquire():
            if time.monotonic() > deadline:
                raise TimeoutError(f"{self.path} stayed locked for {timeout} s")
            time.sleep(0.2)
        return self

    def release(self):
        if self.handle is None:
            return
        try:
            if IS_WINDOWS:
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_):
        self.release()


def lock_is_held(path):
    if not Path(path).exists():
        return False
    lock = FileLock(path)
    if lock.try_acquire():
        lock.release()
        return False
    return True


# ---------------------------------------------------------------- processes

def process_table():
    """[(pid, parent pid, executable path or None)] for every process we can see."""
    if IS_WINDOWS:
        script = ("Get-CimInstance Win32_Process | ForEach-Object { "
                  "[pscustomobject]@{p=[int]$_.ProcessId; q=[int]$_.ParentProcessId; e=$_.ExecutablePath} } "
                  "| ConvertTo-Json -Compress")
        out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                             capture_output=True, text=True, timeout=120, creationflags=NO_WINDOW,
                             stdin=subprocess.DEVNULL)
        if out.returncode != 0 or not out.stdout.strip():
            raise RuntimeError(f"Could not list processes: {out.stderr.strip()[:300]}")
        rows = json.loads(out.stdout)
        rows = rows if isinstance(rows, list) else [rows]
        return [(row["p"], row["q"], row.get("e")) for row in rows]
    table = []
    for entry in os.scandir("/proc"):
        if not entry.name.isdigit():
            continue
        try:
            with open(f"/proc/{entry.name}/stat", "rb") as handle:
                stat = handle.read().decode("utf-8", "replace")
            # The command name is in parentheses and may contain spaces or ')'.
            ppid = int(stat[stat.rindex(")") + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        try:
            exe = os.readlink(f"/proc/{entry.name}/exe")
            exe = exe[:-len(" (deleted)")] if exe.endswith(" (deleted)") else exe
        except OSError:
            exe = None
        table.append((int(entry.name), ppid, exe))
    return table


def descendants(table, root):
    children = {}
    for pid, ppid, _exe in table:
        children.setdefault(ppid, []).append(pid)
    ids, index = [root], 0
    while index < len(ids):
        ids += [child for child in children.get(ids[index], []) if child not in ids]
        index += 1
    return ids


def process_tree(root):
    return descendants(process_table(), root)


def alive(pids):
    wanted = set(pids)
    return sorted(pid for pid, _ppid, _exe in process_table() if pid in wanted)


def kill(pids, force=True):
    pids = [pid for pid in pids if pid and pid != os.getpid()]
    if not pids:
        return
    if IS_WINDOWS:
        args = ["taskkill", *(["/F"] if force else []), *sum((["/PID", str(pid)] for pid in pids), [])]
        subprocess.run(args, capture_output=True, creationflags=NO_WINDOW, stdin=subprocess.DEVNULL)
        return
    import signal
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:
            pass


def kill_tree(root):
    if IS_WINDOWS:
        subprocess.run(["taskkill", "/PID", str(root), "/T", "/F"], capture_output=True,
                       creationflags=NO_WINDOW, stdin=subprocess.DEVNULL)
        return
    kill(list(reversed(process_tree(root))), force=True)


def executable_paths():
    return [exe for _pid, _ppid, exe in process_table() if exe]


def singleton_lock_pid(target, hostname):
    """Chromium's SingletonLock is a symlink to "<hostname>-<pid>"."""
    host, _, pid = str(target).rpartition("-")
    return int(pid) if host == hostname and pid.isdigit() else None


def electron_profile_owner(user_data_dir):
    """Linux: (pid, executable or None) of the live process holding Chromium's single-instance lock on
    this Electron profile, whatever started it (a build, the old .deb, by hand); None when nothing
    does. Windows: None (Chromium locks the profile there without a readable owner)."""
    if IS_WINDOWS:
        return None
    try:
        target = os.readlink(Path(user_data_dir) / "SingletonLock")
    except OSError:
        return None
    pid = singleton_lock_pid(target, socket.gethostname())
    if pid is None or not os.path.exists(f"/proc/{pid}"):
        return None  # another machine's lock on a shared folder, or left behind by a crash
    try:
        exe = os.readlink(f"/proc/{pid}/exe")
        exe = exe[:-len(" (deleted)")] if exe.endswith(" (deleted)") else exe
    except OSError:
        exe = None
    return pid, exe


# ---------------------------------------------------------------- windows and notifications

def minimized_startupinfo():
    """Windows: ask for a minimized, non-activated first window (SW_SHOWMINNOACTIVE)."""
    if not IS_WINDOWS:
        return None
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 7
    return startup


def notify(title, text):
    """A message the user sees even though the launcher has no console."""
    try:
        if IS_WINDOWS:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, text, title, 0x30)
            return
        if shutil.which("notify-send"):
            subprocess.run(["notify-send", "--urgency=critical", "--app-name=T3 Code Alex", title, text],
                           timeout=10, check=False, stdin=subprocess.DEVNULL)
            return
        if shutil.which("zenity"):
            subprocess.run(["zenity", "--error", "--title", title, "--text", text], check=False,
                           stdin=subprocess.DEVNULL)
            return
    except Exception:
        pass
    print(f"{title}: {text}", file=sys.stderr)


# ---------------------------------------------------------------- Windows t3code:// handler

PROTOCOL_KEY = r"Software\Classes\t3code\shell\open\command"


def read_protocol_handler():
    if not IS_WINDOWS:
        return None
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY) as key:
            return winreg.QueryValueEx(key, "")[0]
    except FileNotFoundError:
        return None


def write_protocol_handler(value):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, PROTOCOL_KEY) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, value)


# ---------------------------------------------------------------- Linux: Chromium sandbox

def _read_proc(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def linux_sandbox_state(electron):
    """(electron arguments, explanation). Chromium needs either a root-owned setuid chrome-sandbox
    (the .deb sets that up with sudo) or unprivileged user namespaces, which Ubuntu 24.04 and its
    derivatives allow only to programs an AppArmor profile names. Without either Electron aborts,
    so the build then runs with --no-sandbox, as upstream's own dev launcher does."""
    if IS_WINDOWS:
        return [], "not applicable"
    helper = Path(electron).parent / "chrome-sandbox"
    try:
        stat = helper.stat()
        if stat.st_uid == 0 and (stat.st_mode & 0o4777) == 0o4755:
            return [], "on (setuid chrome-sandbox)"
    except OSError:
        pass
    if _read_proc("/proc/sys/kernel/unprivileged_userns_clone") == "0":
        return ["--no-sandbox"], "OFF: unprivileged user namespaces are disabled"
    if _read_proc("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") == "1":
        if APPARMOR_PROFILE.is_file():
            return [], f"on (user namespaces allowed by {APPARMOR_PROFILE})"
        return ["--no-sandbox"], (f"OFF: AppArmor restricts user namespaces and {APPARMOR_PROFILE} "
                                  "is not installed (see `t3update.py setup`)")
    return [], "on (user namespaces)"


def apparmor_profile_text(builds_dir):
    # AppArmor matches the resolved executable, and pnpm links apps/desktop/node_modules/electron into
    # the build's node_modules/.pnpm; builds_dir must be resolved too.
    electron = f"{builds_dir}/*/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron"
    return "\n".join([
        "# Lets T3 Code Alex's builds use Chromium's user-namespace sandbox (written by t3update.py setup).",
        "abi <abi/4.0>,",
        "include <tunables/global>",
        "",
        f'profile t3code-alex-builds "{electron}" flags=(unconfined) {{',
        "  userns,",
        "  include if exists <local/t3code-alex-builds>",
        "}",
        "",
    ])


# ---------------------------------------------------------------- Linux: Xvfb for invisible smoke runs

def start_xvfb():
    """Start a private X server; (process, DISPLAY) or None when Xvfb is not installed."""
    if IS_WINDOWS:
        return None
    exe = shutil.which("Xvfb")
    if not exe:
        return None
    import select
    read_end, write_end = os.pipe()
    process = subprocess.Popen([exe, "-displayfd", str(write_end), "-screen", "0", "1440x900x24", "-nolisten", "tcp"],
                               pass_fds=(write_end,), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    os.close(write_end)
    number = b""
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline and not number.endswith(b"\n"):
            ready, _, _ = select.select([read_end], [], [], 0.5)
            if ready:
                chunk = os.read(read_end, 16)
                if not chunk:
                    break
                number += chunk
    finally:
        os.close(read_end)
    if not number.strip().isdigit():
        process.kill()
        process.wait(timeout=10)
        raise RuntimeError("Xvfb did not report a display")
    return process, f":{number.strip().decode()}"


# ---------------------------------------------------------------- Linux: desktop entries

def _desktop_exec_arg(arg):
    # Desktop Entry spec: quote, escape " ` $ \ inside quotes, then the string-level backslash
    # escape on top; a literal % is %%.
    quoted = '"' + "".join("\\" + c if c in '"`$\\' else c for c in str(arg)) + '"'
    return quoted.replace("\\", "\\\\").replace("%", "%%")


def _desktop_string(value):
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace("\t", "\\t").replace("\r", "\\r")


def render_desktop_entry(name, exec_argv, wm_class, icon=None, comment="Desktop GUI for coding agents"):
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        f"Name={_desktop_string(name)}",
        f"Comment={_desktop_string(comment)}",
        f"Exec={' '.join(_desktop_exec_arg(a) for a in exec_argv)}",
        *([f"Icon={_desktop_string(icon)}"] if icon else []),
        "Terminal=false",
        "Categories=Development;",
        f"StartupWMClass={_desktop_string(wm_class)}",
        "",
    ]
    return "\n".join(lines)
