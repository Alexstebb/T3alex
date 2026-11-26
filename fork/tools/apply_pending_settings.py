"""Apply prepared edits to T3 Code's client settings while the app is closed.

The running app rewrites the whole client-settings.json, so edits are prepared as specs in the
config's pendingDir and the launcher applies them just before the app starts:
    python apply_pending_settings.py <build directory> [--config FILE] [--dry-run]

Each pending/*.json file is a spec:
{
  "renameSections": {"Old name": "New name"},
  "sections": [{"name": "...", "threadKeys": ["env:thread", ...], "chatProjectKey": "env:project"}],
  "sectionOrder": ["Name", ...],             # listed names first, in this order; the rest follow
  "pinScheduledTasks": ["[\\"env\\",\\"task id\\"]", ...]
}

Everything is idempotent. `chatProjectKey` is only written when the build understands the field
(an older build would silently drop it on its next save); until then the spec stays pending and is
applied again at the next start. A spec that has been applied in full moves to pending/applied/.
"""

import json
from pathlib import Path
import shutil
import sys
import time
import uuid


def log(pending_dir, text):
    pending_dir.mkdir(parents=True, exist_ok=True)
    with (pending_dir / "apply.log").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")


def build_supports_chat_folder(build):
    source = Path(build) / "packages" / "contracts" / "src" / "settings.ts"
    try:
        return "chatProjectKey" in source.read_text(encoding="utf-8")
    except OSError:
        return False


def apply_spec(settings, spec, chat_folder_supported):
    """Returns True when nothing in the spec is left to do."""
    complete = True
    sections = list(settings.get("sidebarCustomSections") or [])
    by_name = {section["name"]: section for section in sections}

    for old, new in (spec.get("renameSections") or {}).items():
        if old in by_name and new not in by_name:
            by_name[old]["name"] = new
            by_name[new] = by_name.pop(old)

    for wanted in spec.get("sections") or []:
        section = by_name.get(wanted["name"])
        if section is None:
            section = {"id": str(uuid.uuid4()), "name": wanted["name"], "collapsed": False, "threadKeys": []}
            sections.append(section)
            by_name[wanted["name"]] = section
        keys = wanted.get("threadKeys") or []
        if keys:
            moving = set(keys)
            for other in sections:
                if other is not section:
                    other["threadKeys"] = [key for key in other["threadKeys"] if key not in moving]
            section["threadKeys"] = section["threadKeys"] + [k for k in keys if k not in section["threadKeys"]]
        chat_key = wanted.get("chatProjectKey")
        if chat_key and "projectKey" not in section:
            if chat_folder_supported:
                section["chatProjectKey"] = chat_key
            elif section.get("chatProjectKey") != chat_key:
                complete = False

    order = spec.get("sectionOrder") or []
    rank = {name: index for index, name in enumerate(order)}
    sections.sort(key=lambda section: rank.get(section["name"], len(order)))
    settings["sidebarCustomSections"] = sections

    pins = spec.get("pinScheduledTasks") or []
    if pins:
        organization = settings.get("scheduledTaskOrganization") or {"pinnedTaskKeys": [], "sections": []}
        pinned = list(organization.get("pinnedTaskKeys") or [])
        organization["pinnedTaskKeys"] = pinned + [key for key in pins if key not in pinned]
        settings["scheduledTaskOrganization"] = organization
    return complete


def apply_pending(home, pending_dir, rollback_dir, build=None, dry_run=False):
    settings_path = Path(home) / "userdata" / "client-settings.json"
    pending_dir = Path(pending_dir)
    specs = sorted(pending_dir.glob("*.json")) if pending_dir.is_dir() else []
    if not specs or not settings_path.is_file():
        return
    supported = build is not None and build_supports_chat_folder(build)
    original = settings_path.read_text(encoding="utf-8")
    settings = json.loads(original)
    finished = []
    for spec_path in specs:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        if apply_spec(settings, spec, supported):
            finished.append(spec_path)
    updated = json.dumps(settings, ensure_ascii=False, indent=2) + "\n"
    if dry_run:
        print(json.dumps(settings.get("sidebarCustomSections"), ensure_ascii=False, indent=1))
        print(json.dumps(settings.get("scheduledTaskOrganization", {}).get("pinnedTaskKeys"), ensure_ascii=False))
        print("chat folder supported by build:", supported, "| specs finished:", [p.name for p in finished])
        return
    if updated != original:
        Path(rollback_dir).mkdir(parents=True, exist_ok=True)
        backup = Path(rollback_dir) / f"client-settings-before-pending-{time.strftime('%Y%m%d-%H%M%S')}.json"
        shutil.copy2(settings_path, backup)
        temporary = settings_path.with_suffix(".json.pending-tmp")
        temporary.write_text(updated, encoding="utf-8", newline="\n")
        temporary.replace(settings_path)
    (pending_dir / "applied").mkdir(exist_ok=True)
    for spec_path in finished:
        spec_path.replace(pending_dir / "applied" / spec_path.name)
    log(pending_dir, f"applied {len(specs)} spec(s), finished {[p.name for p in finished]}, "
                     f"chat folder supported: {supported}, changed: {updated != original}")


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from t3core import load_config

    args = sys.argv[1:]
    config = load_config(args[args.index("--config") + 1] if "--config" in args else None)
    build = Path(args[0]) if args and not args[0].startswith("--") else None
    apply_pending(config.home, config.pending_dir, config.rollback_dir, build, dry_run="--dry-run" in args)


if __name__ == "__main__":
    main()
