r"""Re-apply one fork commit's i18n catalog changes onto the current checkout.

Use it when a rebase or cherry-pick conflicts in apps/web/src/i18n/translations/*.json:

    python fork/tools/i18n_apply.py <fork-commit>    # from the repo root, mid-conflict
    vp fmt apps/web/src/i18n/translations/*.json
    git add apps/web/src/i18n/translations

It takes HEAD's version of every catalog (upstream, during a rebase) and applies the keys the
fork commit added, removed or changed relative to its parent. Added keys go to the end of the
file, as the i18n rules in FORK.md ask. It prints a key clash if HEAD already has a key with a
different value. Afterwards check that all ten catalogs have the same key set.
"""

import json
import subprocess
import sys

LOCALES = ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "sv", "zh"]


def show(rev, path):
    result = subprocess.run(
        ["git", "-c", "core.longpaths=true", "show", f"{rev}:{path}"], capture_output=True
    )
    if result.returncode:
        raise SystemExit(f"git show {rev}:{path} failed: {result.stderr.decode().strip()}")
    return json.loads(result.stdout.decode("utf-8"))


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    commit = sys.argv[1]
    for locale in LOCALES:
        path = f"apps/web/src/i18n/translations/{locale}.json"
        base, fork, head = show(f"{commit}^", path), show(commit, path), show("HEAD", path)
        added = [key for key in fork if key not in base]
        removed = [key for key in base if key not in fork]
        changed = [key for key in fork if key in base and fork[key] != base[key]]
        clashes = [key for key in added if key in head and head[key] != fork[key]]
        out = dict(head)
        for key in removed:
            out.pop(key, None)
        for key in changed:
            if key in out:
                out[key] = fork[key]
        for key in added:
            out[key] = fork[key]
        with open(path, "w", encoding="utf-8", newline="\n") as file:
            file.write(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
        print(f"{locale}: added {len(added)}, removed {len(removed)}, changed {len(changed)}"
              + (f", CLASH {clashes}" if clashes else ""))


if __name__ == "__main__":
    main()
