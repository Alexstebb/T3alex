"""Unit tests for the updater's pure logic. Run from the repo root on Windows or Linux:

    python -m unittest discover -s fork/tools -p "test_*.py"
"""

from contextlib import closing
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrubbed_env import scrubbed_environment  # noqa: E402
import t3core  # noqa: E402
import t3launch  # noqa: E402
import t3platform  # noqa: E402
import t3smoke  # noqa: E402
import t3update  # noqa: E402


class TempDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


class ConfigDefaults(TempDir):
    def test_windows_defaults_reproduce_the_release_setup(self):
        local = self.tmp / "AppData" / "Local"
        path = t3core.default_config_path("win32", {"LOCALAPPDATA": str(local)}, self.tmp)
        self.assertEqual(path, local / "T3CodeFork" / "t3update.json")
        config = t3core.load_config(path, "win32")
        root = local / "T3CodeFork"
        self.assertFalse(config.exists)
        self.assertEqual(config.root, root)
        self.assertEqual(config.pointer_path, root / "release" / "current.json")
        self.assertEqual(config.builds_dir, root / "release" / "builds")
        self.assertEqual(config.home, root / "live")
        self.assertEqual(config.database, root / "live" / "userdata" / "statev2.sqlite")
        self.assertEqual(config.user_data_dir, root / "release" / "userdata")
        self.assertEqual(config.rollback_dir, root / "rollback")
        self.assertEqual(config.pending_dir, root / "pending")
        self.assertEqual(config.launch_lock, root / "release-launch.lock")
        self.assertEqual(config.other_locks, [root / "live-launch.lock"])
        self.assertEqual(config.port, 14084)
        self.assertEqual(config.brand, "")
        self.assertEqual(config.app_user_model_id, "com.t3tools.t3code.alexrelease")
        self.assertEqual(config.path_prepend, [str(root / "toolchain" / "node_modules" / "node" / "bin")])
        self.assertEqual(config.electron_path(root / "b"), root / "b" / "apps" / "desktop" / "node_modules"
                         / "electron" / "dist" / "electron.exe")

    def test_linux_defaults_use_the_branded_profile(self):
        env = {}
        path = t3core.default_config_path("linux", env, self.tmp)
        self.assertEqual(path, self.tmp / ".local" / "share" / "t3code-alex" / "t3update.json")
        config = t3core.resolve_config(t3core.default_config("linux", env, self.tmp), path, "linux")
        self.assertEqual(config.home, self.tmp / ".t3-alex")
        self.assertEqual(config.user_data_dir, self.tmp / ".config" / "t3code-alex")
        self.assertEqual(config.source_repo, self.tmp / "src" / "t3code-alex")
        self.assertEqual(config.builds_dir, self.tmp / ".local" / "share" / "t3code-alex" / "release" / "builds")
        self.assertIsNone(config.port)
        self.assertEqual(config.brand, "alex")
        self.assertEqual(config.other_locks, [])
        self.assertEqual(config.electron_path(Path("b")).name, "electron")
        self.assertEqual(config.app_name, "t3code-alex")

    def test_linux_defaults_follow_xdg_variables(self):
        env = {"XDG_DATA_HOME": str(self.tmp / "data"), "XDG_CONFIG_HOME": str(self.tmp / "conf")}
        path = t3core.default_config_path("linux", env, self.tmp)
        self.assertEqual(path, self.tmp / "data" / "t3code-alex" / "t3update.json")
        raw = t3core.default_config("linux", env, self.tmp)
        self.assertEqual(Path(raw["userDataDir"]), self.tmp / "conf" / "t3code-alex")

    def test_file_overrides_defaults_and_relative_paths_resolve_against_it(self):
        path = self.tmp / "root" / "t3update.json"
        path.parent.mkdir()
        path.write_text(json.dumps({"version": 1, "port": None, "home": "profile", "sourceRepo": str(self.tmp)}))
        config = t3core.load_config(path, "win32")
        self.assertTrue(config.exists)
        self.assertIsNone(config.port)
        self.assertEqual(config.home, self.tmp / "root" / "profile")
        self.assertEqual(config.release_dir, self.tmp / "root" / "release")

    def test_rejects_unknown_settings_bad_ports_and_versions(self):
        path = self.tmp / "t3update.json"
        for content in ({"version": 1, "prot": 1}, {"version": 1, "port": "14084"}, {"version": 2}):
            path.write_text(json.dumps(content))
            with self.assertRaises(ValueError):
                t3core.load_config(path, "linux")


class Pointer(TempDir):
    def test_missing_pointer_is_empty(self):
        self.assertEqual(t3core.read_pointer(self.tmp / "nope.json")["current"], None)

    def test_activation_moves_current_to_previous_and_keeps_other_keys(self):
        pointer = {"current": "aaaaaaaaa", "previous": "bbbbbbbbb", "history": [], "lastDbBackup": {"x": 1},
                   "pendingDbBackup": None}
        result = t3core.activated(pointer, "ccccccccc", {"build": "ccccccccc"}, at="T")
        self.assertEqual((result["current"], result["previous"]), ("ccccccccc", "aaaaaaaaa"))
        self.assertEqual(result["history"], [{"at": "T", "from": "aaaaaaaaa", "to": "ccccccccc"}])
        self.assertEqual(result["pendingDbBackup"], {"build": "ccccccccc"})
        self.assertEqual(result["lastDbBackup"], {"x": 1})
        self.assertEqual(pointer["current"], "aaaaaaaaa")
        self.assertEqual(t3core.activated(result, "ccccccccc"), result)

    def test_rollback_swaps_and_remembers_the_build_left_behind(self):
        pointer = {"current": "ccccccccc", "previous": "aaaaaaaaa", "history": [], "pendingDbBackup": {"b": 1}}
        result = t3core.rolled_back(pointer, at="T")
        self.assertEqual((result["current"], result["previous"]), ("aaaaaaaaa", "ccccccccc"))
        self.assertEqual(result["rejected"], ["ccccccccc"])
        self.assertIsNone(result["pendingDbBackup"])
        self.assertTrue(result["history"][-1]["rollback"])
        with self.assertRaises(ValueError):
            t3core.rolled_back({"current": "a", "previous": None})

    def test_taking_a_rejected_build_on_purpose_clears_the_rejection(self):
        pointer = {"current": "aaaaaaaaa", "previous": "ccccccccc", "rejected": ["ccccccccc", "ddddddddd"]}
        self.assertEqual(t3core.activated(pointer, "ccccccccc")["rejected"], ["ddddddddd"])

    def test_pointer_round_trip_is_atomic_json(self):
        path = self.tmp / "release" / "current.json"
        t3core.write_json_atomic(path, {"current": "abc1234ff"})
        self.assertEqual(t3core.read_pointer(path)["current"], "abc1234ff")
        self.assertEqual(t3core.read_pointer(path)["history"], [])
        self.assertFalse(path.with_name("current.json.tmp").exists())


class RollbackTarget(TempDir):
    A, B, C, D = "aaaaaaaaa", "bbbbbbbbb", "ccccccccc", "ddddddddd"

    def config(self):
        raw = {**t3core.default_config("linux", {}, self.tmp), "sourceRepo": str(self.tmp / "src")}
        (self.tmp / "t3update.json").write_text(json.dumps(raw), encoding="utf-8")
        return t3core.resolve_config(raw, self.tmp / "t3update.json", "linux")

    def fake_build(self, config, name):
        build = config.builds_dir / name
        for path in t3core.required_build_files(config, build):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"T3CODE_DESKTOP_USER_DATA_DIR T3CODE_DESKTOP_SKIP_PROTOCOL_REGISTRATION")
        migrations = build / t3core.MIGRATIONS_FILE
        migrations.parent.mkdir(parents=True, exist_ok=True)
        migrations.write_text('  [1, "Init", Migration0001],' + chr(10), encoding="utf-8")

    def test_two_updates_between_starts_roll_back_to_the_build_that_ran(self):
        pointer = t3core.record_run({"current": self.A, "previous": None}, self.A, at="2026-11-27T08:02:00")
        pointer = t3core.activated(pointer, self.B)  # B is built and marked, never started
        pointer = t3core.activated(pointer, self.C)
        self.assertEqual((pointer["current"], pointer["previous"]), (self.C, self.A))
        target = t3core.rollback_target(pointer)
        self.assertEqual((target["build"], target["basis"]), (self.A, "run"))
        self.assertEqual(t3core.describe_target(target), "last run 2026-11-27 08:02")
        rolled = t3core.rolled_back(pointer)
        self.assertEqual((rolled["current"], rolled["previous"], rolled["rejected"]), (self.A, self.C, [self.C]))

    def test_a_pointer_without_the_new_fields_keeps_working(self):
        pointer = {"current": self.C, "previous": self.B, "history": []}
        target = t3core.rollback_target(pointer)
        self.assertEqual((target["build"], target["basis"]), (self.B, "previous"))
        self.assertIn("may never have been started", t3core.describe_target(target))
        self.assertEqual(t3core.rolled_back(pointer)["current"], self.B)
        self.assertEqual(t3core.activated(pointer, self.D)["previous"], self.C)  # today's behaviour
        self.assertIsNone(t3core.rollback_target({"current": self.A}))

    def test_last_run_is_the_current_build_goes_to_the_one_run_before(self):
        pointer = {"current": self.C, "previous": self.B}
        for name in (self.A, self.C):
            pointer = t3core.record_run(pointer, name)
        self.assertEqual(t3core.rollback_target(pointer)["build"], self.A)
        self.assertEqual(t3core.record_run(pointer, self.C)["runs"][-1]["build"], self.C)
        self.assertEqual(len(t3core.record_run(pointer, self.C)["runs"]), 2)

    def test_a_build_rolled_back_from_is_not_the_target_again(self):
        pointer = {"current": self.C, "previous": None}
        for name in (self.A, self.B, self.C):
            pointer = t3core.record_run(pointer, name)
        pointer = t3core.rolled_back(pointer)
        self.assertEqual(pointer["current"], self.B)
        self.assertEqual(t3core.rollback_target(pointer)["build"], self.A)

    def test_a_build_that_is_gone_is_skipped(self):
        pointer = {"current": self.C, "previous": self.B}
        for name in (self.A, self.B, self.C):
            pointer = t3core.record_run(pointer, name)
        self.assertEqual(t3core.rollback_target(pointer, lambda name: name != self.B)["build"], self.A)

    def test_a_running_build_counts_as_run_and_is_not_rewritten(self):
        pointer = t3core.observed({"current": self.B, "previous": None}, {self.A}, at="T1")
        self.assertEqual(pointer["lastRun"], {"build": self.A, "at": "T1", "source": "observed"})
        self.assertEqual(t3core.observed(pointer, {self.A}, at="T2"), pointer)
        self.assertEqual(t3core.describe_target(t3core.rollback_target(pointer)), "seen running T1")

    def test_prune_keeps_the_rollback_target(self):
        pointer = t3core.activated(t3core.activated(
            t3core.record_run({"current": self.A}, self.A), self.B), self.C)
        entries = [self.A, self.A + ".json", self.B, self.B + ".json", self.C, self.D]
        self.assertEqual(t3core.prune_candidates(entries, pointer, set()), [self.B, self.B + ".json", self.D])
        self.assertEqual(t3core.protected_builds(pointer, {self.D}), {self.A, self.C, self.D})
        # The previous build is still kept when it is not the target.
        pointer = {**pointer, "previous": self.B}
        self.assertEqual(t3core.prune_candidates(entries, pointer, set()), [self.D])

    def test_launcher_records_each_start(self):
        config = self.config()
        t3core.write_json_atomic(config.pointer_path, {"current": self.B, "previous": self.A})
        t3launch.record_start(config, self.B)
        pointer = t3core.read_pointer(config.pointer_path)
        self.assertEqual((pointer["lastRun"]["build"], pointer["lastRun"]["source"]), (self.B, "launcher"))
        self.assertEqual((pointer["current"], pointer["previous"]), (self.B, self.A))

    def test_rollback_command_uses_the_last_run_build(self):
        config = self.config()
        for name in (self.A, self.B, self.C):
            self.fake_build(config, name)
        pointer = t3core.activated(t3core.activated(
            t3core.record_run({"current": self.A}, self.A), self.B), self.C)
        t3core.write_json_atomic(config.pointer_path, pointer)
        args = type("Args", (), {"restore_db": None})()
        with mock.patch.object(t3update, "running_builds", return_value=set()),                 mock.patch.object(t3update, "app_running", return_value=False):
            self.assertEqual(t3update.cmd_rollback(config, args), 0)
        result = t3core.read_pointer(config.pointer_path)
        self.assertEqual((result["current"], result["previous"]), (self.A, self.C))

    def test_status_shows_the_target_and_writes_nothing(self):
        config = self.config()
        self.fake_build(config, self.A)
        t3core.write_json_atomic(config.pointer_path, {"current": self.C, "previous": self.B, "runs": [
            {"build": self.A, "at": "2026-11-27T08:02:11", "source": "launcher"}], "history": []})
        before = config.pointer_path.read_bytes()
        lines = []
        with mock.patch.object(t3update, "running_builds", return_value={self.C}),                 mock.patch.object(t3update, "launcher_running", return_value=False),                 mock.patch.object(t3update, "log", side_effect=lines.append):
            t3update.cmd_status(config, type("Args", (), {"fetch": False})())
        text = chr(10).join(lines)
        self.assertIn("last run 2026-11-27 08:02", text)
        self.assertRegex(text, r"rollback: +aaaaaaaaa")
        self.assertRegex(text, r"previous: +bbbbbbbbb")
        self.assertEqual(config.pointer_path.read_bytes(), before)


class GitParsing(unittest.TestCase):
    def test_ahead_behind(self):
        self.assertEqual(t3core.parse_ahead_behind("3\t120\n"), (3, 120))
        with self.assertRaises(ValueError):
            t3core.parse_ahead_behind("fatal: bad revision")

    def test_log_lines(self):
        output = "5e96ab7c2\tfeat(fork): branded Linux build\n\nb34fbeab3\tfix: a\tb\n"
        self.assertEqual(t3core.parse_log(output),
                         [("5e96ab7c2", "feat(fork): branded Linux build"), ("b34fbeab3", "fix: a\tb")])

    def test_build_name_needs_a_full_sha(self):
        self.assertEqual(t3core.build_name("5e96ab7c24" + "0" * 30), "5e96ab7c2")
        with self.assertRaises(ValueError):
            t3core.build_name("main")


class Prune(unittest.TestCase):
    pointer = {"current": "aaaaaaaaa", "previous": "bbbbbbbbb"}

    def test_keeps_current_previous_and_running(self):
        entries = ["aaaaaaaaa", "aaaaaaaaa.json", "bbbbbbbbb", "bbbbbbbbb.json", "ccccccccc", "ccccccccc.json",
                   "ddddddddd", "eeeeeeeee.json"]
        self.assertEqual(t3core.prune_candidates(entries, self.pointer, {"ccccccccc"}),
                         ["ddddddddd", "eeeeeeeee.json"])

    def test_leaves_folders_that_are_not_builds_alone(self):
        entries = ["notes", "ddddddddd.json.tmp", "ABCDEF123", "123", "fffffffff"]
        self.assertEqual(t3core.prune_candidates(entries, self.pointer, set()), ["fffffffff"])

    def test_never_deletes_an_abbreviation_of_a_protected_build(self):
        self.assertEqual(t3core.prune_candidates(["aaaaaaa", "aaaaaaaaaa"], self.pointer, set()), [])

    def test_running_builds_from_executable_paths(self):
        builds = Path(tempfile.gettempdir()) / "root" / "release" / "builds"
        paths = [str(builds / "aaaaaaaaa" / "apps" / "desktop" / "node_modules" / "electron" / "dist" / "electron"),
                 str(builds.parent / "other" / "x"), None, str(builds), str(builds / "ccccccccc" / "x")]
        self.assertEqual(t3core.builds_in_use(paths, builds), {"aaaaaaaaa", "ccccccccc"})


class Scrubbing(unittest.TestCase):
    def test_removes_inherited_app_and_dev_variables(self):
        base = {"T3CODE_HOME": "live", "T3CODE_DESKTOP_DEV": "1", "VITE_DEV_SERVER_URL": "x", "NODE_ENV": "development",
                "NODE_PATH": "x", "ELECTRON_RUN_AS_NODE": "1", "npm_config_x": "1", "CLAUDECODE": "1",
                "CODEX_HOME": "x", "APPIMAGE": "/a", "GIT_DIR": "/g", "HOME": "/home/a", "LANG": "nb_NO.UTF-8",
                "PATH": os.pathsep.join(["/usr/bin", "/repo/node_modules/.bin", "/src/main/bin"])}
        env = scrubbed_environment({"T3CODE_HOME": "copy", "LANG": None}, base=base, path_prepend=["/tool/node"],
                                   drop_path_under=["/src/main"])
        self.assertEqual(env["T3CODE_HOME"], "copy")
        for name in ("T3CODE_DESKTOP_DEV", "VITE_DEV_SERVER_URL", "NODE_ENV", "NODE_PATH", "ELECTRON_RUN_AS_NODE",
                     "npm_config_x", "CLAUDECODE", "CODEX_HOME", "APPIMAGE", "GIT_DIR", "LANG"):
            self.assertNotIn(name, env)
        self.assertEqual(env["HOME"], "/home/a")
        self.assertEqual(env["PATH"].split(os.pathsep), ["/tool/node", "/usr/bin"])

    def test_case_insensitive_on_names(self):
        env = scrubbed_environment(base={"t3code_home": "x", "Path": "/bin"})
        self.assertNotIn("t3code_home", env)
        self.assertEqual(env["PATH"], "/bin")

    def test_app_environment_sets_only_what_the_launcher_means(self):
        config = t3core.resolve_config(t3core.default_config("linux", {}, "/h"), "/h/r/t3update.json", "linux")
        with mock.patch.dict(os.environ, {"T3CODE_HOME": "/live", "VITE_WS_URL": "ws://x", "KEEP": "1"}, clear=False):
            env = t3launch.app_environment(config, Path("/b/abc"), {"sha": "f" * 40}, Path("/copy"), Path("/ud"))
        self.assertEqual(env["T3CODE_HOME"], str(Path("/copy")))
        self.assertEqual(env["T3CODE_DESKTOP_USER_DATA_DIR"], str(Path("/ud")))
        self.assertEqual(env["T3CODE_COMMIT_HASH"], "f" * 40)
        self.assertNotIn("T3CODE_PORT", env)
        self.assertNotIn("VITE_WS_URL", env)
        self.assertEqual(env["KEEP"], "1")
        pinned = t3launch.app_environment(config, Path("/b/abc"), {}, Path("/h"), Path("/u"), port=14084,
                                          launcher_path=Path("/l/t3launch.py"))
        self.assertEqual(pinned["T3CODE_PORT"], "14084")
        self.assertEqual(pinned["T3CODE_DESKTOP_LAUNCHER_PATH"], str(Path("/l/t3launch.py")))


class Migrations(TempDir):
    source = '''
export const migrationEntries = [
  [1, "Init", Migration0001],
  [2, "Threads", Migration0002],
  [3, "Runs", Migration0003],
] as const;
'''

    def database(self, rows):
        path = self.tmp / "statev2.sqlite"
        with closing(sqlite3.connect(path)) as db:
            db.execute("CREATE TABLE effect_sql_migrations (migration_id INTEGER, name TEXT)")
            db.executemany("INSERT INTO effect_sql_migrations VALUES (?, ?)", rows)
            db.commit()
        return path

    def test_parses_the_migration_list(self):
        self.assertEqual(t3core.parse_migrations(self.source), [(1, "Init"), (2, "Threads"), (3, "Runs")])
        with self.assertRaises(ValueError):
            t3core.parse_migrations("nothing here")

    def test_new_migrations_and_blocking_states(self):
        build = t3core.parse_migrations(self.source)
        report = t3core.migration_report(build, t3core.recorded_migrations(self.database([(1, "Init")])))
        self.assertEqual(report["new"], ["2_Threads", "3_Runs"])
        self.assertFalse(t3core.report_blocks_activation(report))
        ahead = t3core.migration_report(build[:1], [(1, "Init"), (2, "Threads")])
        self.assertEqual(ahead["databaseAhead"], ["2_Threads"])
        self.assertTrue(t3core.report_blocks_activation(ahead))
        renamed = t3core.migration_report(build, [(1, "Other")])
        self.assertTrue(t3core.report_blocks_activation(renamed))
        self.assertEqual(t3core.recorded_migrations(self.tmp / "missing.sqlite"), [])

    def test_backup_database_copies_consistently(self):
        source = self.database([(1, "Init")])
        target = t3core.backup_database(source, self.tmp / "backups" / "copy.sqlite")
        self.assertEqual(t3core.recorded_migrations(target), [(1, "Init")])
        self.assertFalse(target.with_name("copy.sqlite.partial").exists())


class DesktopEntry(unittest.TestCase):
    def test_quotes_exec_arguments(self):
        entry = t3platform.render_desktop_entry("T3 Code Alex", ["/usr/bin/python3", "/home/a b/$x%/t3launch.py"],
                                                "com.t3tools.t3code.alex", icon="/home/a/icon.png")
        self.assertIn('Exec="/usr/bin/python3" "/home/a b/\\\\$x%%/t3launch.py"\n', entry)
        self.assertIn("StartupWMClass=com.t3tools.t3code.alex\n", entry)
        self.assertIn("Icon=/home/a/icon.png\n", entry)
        self.assertTrue(entry.startswith("[Desktop Entry]\nType=Application\nName=T3 Code Alex\n"))

    def test_apparmor_profile_matches_the_resolved_electron_of_every_build(self):
        builds = "/home/a/.local/share/t3code-alex/release/builds"
        text = t3platform.apparmor_profile_text(builds)
        glob = re.search(r'^profile t3code-alex-builds "([^"]+)" flags=\(unconfined\) \{$', text, re.M).group(1)
        # AppArmor's * does not cross '/'; the kernel reports the executable with pnpm's links resolved.
        pattern = re.compile("^" + re.escape(glob).replace(r"\*", "[^/]*") + "$")
        resolved = (f"{builds}/f0ff791ee/node_modules/.pnpm/electron@44.10.1_supports-color@8.1.1/"
                    "node_modules/electron/dist/electron")
        self.assertRegex(resolved, pattern)
        self.assertNotRegex(f"{builds}/f0ff791ee/x/node_modules/.pnpm/electron@1/node_modules/electron/dist/electron",
                            pattern)
        self.assertIn("userns,", text)


class AppFolder(TempDir):
    def build(self, boot=True):
        desktop = self.tmp / "b" / "apps" / "desktop"
        (desktop / "dist-electron").mkdir(parents=True)
        (desktop / "package.json").write_text(json.dumps({"name": "@t3tools/desktop", "version": "0.1.11"}))
        (desktop / "dist-electron" / "main.cjs").write_text("")
        if boot:
            (desktop / "dist-electron" / "boot.cjs").write_text("")
        return self.tmp / "b"

    def config(self, platform):
        return t3core.resolve_config(t3core.default_config(platform, {}, self.tmp), self.tmp / "r" / "t3update.json",
                                     platform)

    def test_linux_starts_the_build_under_the_packaged_apps_name(self):
        build, config = self.build(), self.config("linux")
        self.assertEqual(t3launch.electron_command(config, build)[-1], t3launch.APP_FOLDER)
        t3launch.write_app_folder(config, build)
        manifest = json.loads((build / "apps" / "desktop" / t3launch.APP_FOLDER / "package.json").read_text())
        self.assertEqual(manifest, {"name": "t3code-alex", "version": "0.1.11", "private": True,
                                    "main": "../dist-electron/boot.cjs"})

    def test_falls_back_to_main_without_boot(self):
        build = self.build(boot=False)
        self.assertEqual(t3launch.app_manifest(self.config("linux"), build)["main"], "../dist-electron/main.cjs")

    def test_windows_keeps_starting_main_directly(self):
        build, config = self.build(), self.config("win32")
        self.assertIsNone(config.app_name)
        self.assertEqual(t3launch.electron_command(config, build)[-1], "dist-electron/main.cjs")
        t3launch.write_app_folder(config, build)
        self.assertFalse((build / "apps" / "desktop" / t3launch.APP_FOLDER).exists())


class ProfileOwner(TempDir):
    def test_parses_chromiums_singleton_lock(self):
        self.assertEqual(t3platform.singleton_lock_pid("pop-os-138065", "pop-os"), 138065)
        self.assertIsNone(t3platform.singleton_lock_pid("other-host-138065", "pop-os"))
        self.assertIsNone(t3platform.singleton_lock_pid("pop-os-abc", "pop-os"))
        self.assertIsNone(t3platform.singleton_lock_pid("garbage", "pop-os"))

    @unittest.skipIf(sys.platform == "win32", "Chromium's SingletonLock symlink is Linux-only")
    def test_sees_a_live_owner_and_ignores_a_stale_lock(self):
        lock = self.tmp / "SingletonLock"
        self.assertIsNone(t3platform.electron_profile_owner(self.tmp))
        os.symlink(f"{socket.gethostname()}-{os.getpid()}", lock)
        pid, exe = t3platform.electron_profile_owner(self.tmp)
        self.assertEqual(pid, os.getpid())
        self.assertEqual(Path(exe).resolve(), Path(sys.executable).resolve())
        lock.unlink()
        os.symlink(f"{socket.gethostname()}-999999999", lock)
        self.assertIsNone(t3platform.electron_profile_owner(self.tmp))

    def test_an_app_this_tool_did_not_start_counts_as_running(self):
        config = t3core.resolve_config(t3core.default_config("linux", {}, self.tmp), self.tmp / "r" / "t3update.json",
                                       "linux")
        with mock.patch.object(t3platform, "executable_paths", return_value=["/opt/T3 Code Alex/t3code-alex"]), \
                mock.patch.object(t3platform, "electron_profile_owner", return_value=(42, "/opt/T3 Code Alex/t3code-alex")):
            self.assertEqual(t3update.running_builds(config), set())
            self.assertTrue(t3update.app_running(config))

    def test_launcher_leaves_database_and_settings_alone_while_the_profile_is_in_use(self):
        config = t3core.resolve_config(t3core.default_config("linux", {}, self.tmp), self.tmp / "r" / "t3update.json",
                                       "linux")
        build = self.tmp / "b"
        (build / "apps" / "desktop").mkdir(parents=True)
        (build / "apps" / "desktop" / "package.json").write_text(json.dumps({"version": "1.0.0"}))
        process = mock.Mock()
        process.wait.return_value = 0
        for owner, expected in (((42, "/opt/x"), False), (None, True)):
            with mock.patch.object(t3launch, "resolve_current", return_value=({}, build, {})), \
                    mock.patch.object(t3platform, "electron_profile_owner", return_value=owner), \
                    mock.patch.object(t3launch, "take_pending_backup") as backup, \
                    mock.patch.object(t3launch, "apply_pending_settings") as settings, \
                    mock.patch.object(t3launch.subprocess, "Popen", return_value=process) as popen:
                self.assertEqual(t3launch.launch(config), 0)
            self.assertEqual(backup.called, expected)
            self.assertEqual(settings.called, expected)
            self.assertTrue(popen.called)


class SmokeVerdict(unittest.TestCase):
    good = {"secondsToDevtools": 2.1, "probe": {"textLength": 900, "viteClient": False, "reactDevBuild": False},
            "leftoverAfterCleanup": [], "protocolRestored": True}
    log = "[17:48:09.025] INFO (#133): backend ready\n"

    def test_passes_a_healthy_start(self):
        self.assertEqual(t3smoke.evaluate(self.good, self.log), [])

    def test_fails_each_way_a_start_can_go_wrong(self):
        cases = [
            ({"error": "RuntimeError: Electron exited during startup with code 1"}, self.log),
            ({"secondsToDevtools": None}, self.log),
            ({"probe": {"error": "no t3code://app page target"}}, self.log),
            ({"probe": "Traceback"}, self.log),
            ({"probe": {"textLength": 40}}, self.log),
            ({"probe": {"textLength": 900, "viteClient": True}}, self.log),
            ({"probe": {"textLength": 900, "reactDevBuild": True}}, self.log),
            ({}, "main window created\n"),
            ({"leftoverAfterCleanup": [123]}, self.log),
            ({"protocolRestored": False}, self.log),
        ]
        for change, log_text in cases:
            with self.subTest(change=change, log=log_text):
                self.assertNotEqual(t3smoke.evaluate({**self.good, **change}, log_text), [])

    @unittest.skipIf(sys.platform == "win32", "Linux display handling")
    def test_without_xvfb_or_a_display_it_fails_early_and_says_why(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            config = t3core.resolve_config(t3core.default_config("linux", {}, tmp), tmp / "r" / "t3update.json",
                                           "linux")
            (tmp / "w" / "home" / "userdata").mkdir(parents=True)
            (tmp / "w" / "home" / "userdata" / "statev2.sqlite").write_bytes(b"")
            with mock.patch.object(t3launch, "check_build"), \
                    mock.patch.object(t3platform, "start_xvfb", return_value=None), \
                    mock.patch.dict(os.environ, {}, clear=True), \
                    mock.patch.object(t3smoke.subprocess, "Popen") as popen:
                result = t3smoke.run_smoke(config, tmp / "b", tmp / "w", tmp / "smoke.log")
        self.assertFalse(popen.called)
        self.assertFalse(result["passed"])
        self.assertEqual(result["problems"], [t3smoke.NO_DISPLAY])

    def test_refuses_to_smoke_inside_the_live_profile(self):
        config = t3core.resolve_config(t3core.default_config("linux", {}, "/h"), "/h/r/t3update.json", "linux")
        with self.assertRaises(SystemExit):
            t3smoke.refuse_live(config, Path("/h/.t3-alex/userdata"))
        with self.assertRaises(SystemExit):
            t3smoke.refuse_live(config, Path("/h/.config"))
        t3smoke.refuse_live(config, Path("/h/r/release/smoke/abc"))


class DotEnv(TempDir):
    def config(self):
        raw = {**t3core.default_config("linux", {}, self.tmp), "sourceRepo": str(self.tmp / "src")}
        return t3core.resolve_config(raw, self.tmp / "t3update.json", "linux")

    def test_copies_env_example_when_the_build_has_no_env(self):
        build = self.tmp / "build"
        build.mkdir()
        (build / ".env.example").write_text("T3CODE_RELAY_URL=x\n")
        self.assertEqual(t3update.prepare_dotenv(self.config(), build), build / ".env.example")
        self.assertEqual((build / ".env").read_text(), "T3CODE_RELAY_URL=x\n")
        self.assertIsNone(t3update.prepare_dotenv(self.config(), build))

    def test_prefers_the_source_checkouts_own_env(self):
        build = self.tmp / "build"
        build.mkdir()
        (self.tmp / "src").mkdir()
        (self.tmp / "src" / ".env").write_text("OWN=1\n")
        (build / ".env.example").write_text("EXAMPLE=1\n")
        t3update.prepare_dotenv(self.config(), build)
        self.assertEqual((build / ".env").read_text(), "OWN=1\n")


class Locks(TempDir):
    def test_a_held_lock_is_seen_and_released(self):
        path = self.tmp / "app.lock"
        self.assertFalse(t3platform.lock_is_held(path))
        lock = t3platform.FileLock(path)
        self.assertTrue(lock.try_acquire())
        self.assertTrue(t3platform.lock_is_held(path))
        self.assertFalse(t3platform.FileLock(path).try_acquire())
        lock.release()
        self.assertFalse(t3platform.lock_is_held(path))

    def test_descendants_walks_the_process_table(self):
        table = [(1, 0, None), (10, 1, None), (11, 10, None), (12, 10, None), (20, 1, None), (13, 11, None)]
        self.assertEqual(t3platform.descendants(table, 10), [10, 11, 12, 13])


if __name__ == "__main__":
    unittest.main()
