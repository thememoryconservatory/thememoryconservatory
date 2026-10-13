#!/usr/bin/env python3
"""
Rename gallery files and folders to web-safe names.

The client's exports arrive with characters that cause trouble the moment they
become URLs — "+" (which a URL reads as a space), spaces, and mixed-case
extensions. This renames everything to lowercase ASCII slugs:

    Sheena x Daniel/Sheena+Daniel_Outdoor-135.JPG
      ->  sheena-x-daniel/sheena-daniel-outdoor-135.jpg

Nothing is touched unless you pass --apply. The default is a dry run that
prints what would change.

    python3 tools/rename-gallery.py "path/to/Gallery"
    python3 tools/rename-gallery.py "path/to/Gallery" --apply

Every applied run writes a mapping file next to the script so the rename can be
reversed:

    python3 tools/rename-gallery.py --undo rename-log-20260924-153000.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

# .jpeg and .jpg are the same format; picking one keeps URLs predictable.
EXTENSION_ALIASES = {".jpeg": ".jpg", ".jpe": ".jpg", ".tif": ".tiff"}


def slugify(text: str) -> str:
    """Lowercase ASCII, with every run of other characters collapsed to one hyphen."""
    # Decompose accents (é -> e + combining accent) and drop anything non-ASCII.
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text)
    return text.strip("-").lower()


def safe_name(name: str, is_dir: bool) -> str:
    """The web-safe version of one file or folder name."""
    if is_dir:
        return slugify(name) or "folder"

    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    ext = EXTENSION_ALIASES.get(ext, ext)
    stem = slugify(stem) or "file"
    return stem + ext


def is_free(parent: Path, candidate: str, original: Path) -> bool:
    """Is `candidate` an available name in `parent`?

    On a case-insensitive filesystem FOO.JPG and foo.jpg are the same file, so
    a name that "exists" may simply be the entry we are renaming. That is not a
    collision — samefile settles it.
    """
    target = parent / candidate
    if not target.exists():
        return True
    try:
        return target.samefile(original)
    except OSError:
        return False


def resolve_collision(parent: Path, name: str, claimed: set[str], original: Path) -> str:
    """Append -2, -3 ... if something else already sits at that name.

    `claimed` tracks names this run has already handed out, since two different
    originals can slugify to the same thing (Photo (1).jpg and Photo-1.jpg).
    """
    stem, ext = os.path.splitext(name)
    candidate = name
    counter = 2
    while candidate.lower() in claimed or not is_free(parent, candidate, original):
        candidate = f"{stem}-{counter}{ext}"
        counter += 1
    claimed.add(candidate.lower())
    return candidate


def rename(path: Path, new_name: str, log: list[dict]) -> Path:
    """Rename one entry, going via a temporary name when only the case changes.

    macOS filesystems are case-insensitive by default, so renaming FOO.JPG
    straight to foo.jpg is treated as renaming a file onto itself and silently
    does nothing. Two hops avoid that.
    """
    target = path.with_name(new_name)
    if path.name == new_name:
        return path

    if path.name.lower() == new_name.lower():
        temporary = path.with_name(f".tmp-rename-{os.getpid()}-{path.name}")
        path.rename(temporary)
        temporary.rename(target)
    else:
        path.rename(target)

    log.append({"from": str(path), "to": str(target)})
    return target


def walk(root: Path, apply: bool, remove_ds_store: bool, log: list[dict]) -> dict:
    stats = {"files": 0, "folders": 0, "renamed": 0, "deleted": 0, "skipped": 0}

    # Bottom-up, so a folder is renamed only after its contents are done and the
    # paths we are still holding remain valid.
    for current, dirnames, filenames in os.walk(root, topdown=False):
        parent = Path(current)

        claimed: set[str] = set()
        for filename in sorted(filenames):
            if filename == ".DS_Store":
                if remove_ds_store:
                    print(f"  delete  {parent / filename}")
                    if apply:
                        (parent / filename).unlink()
                    stats["deleted"] += 1
                else:
                    stats["skipped"] += 1
                continue

            if filename.startswith("."):
                stats["skipped"] += 1
                continue

            stats["files"] += 1
            wanted = safe_name(filename, is_dir=False)
            if wanted == filename:
                continue

            wanted = resolve_collision(parent, wanted, claimed, parent / filename)
            print(f"  file    {filename}\n       -> {wanted}")
            stats["renamed"] += 1
            if apply:
                rename(parent / filename, wanted, log)

        # The root itself keeps its name; only what is inside it is renamed.
        if parent == root:
            continue

        stats["folders"] += 1
        wanted = safe_name(parent.name, is_dir=True)
        if wanted == parent.name:
            continue

        wanted = resolve_collision(parent.parent, wanted, set(), parent)
        print(f"  folder  {parent.name}\n       -> {wanted}")
        stats["renamed"] += 1
        if apply:
            rename(parent, wanted, log)

    return stats


def undo(log_path: Path) -> None:
    entries = json.loads(log_path.read_text())
    # Reverse order, so folders go back before the files inside them.
    for entry in reversed(entries):
        source, destination = Path(entry["to"]), Path(entry["from"])
        if not source.exists():
            print(f"  missing {source}")
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)
        print(f"  {source.name} -> {destination.name}")
    print(f"\nReversed {len(entries)} renames.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", help="the gallery folder to rename inside")
    parser.add_argument("--apply", action="store_true", help="actually rename (default is a dry run)")
    parser.add_argument("--remove-ds-store", action="store_true", help="also delete .DS_Store files")
    parser.add_argument("--undo", metavar="LOG", help="reverse a previous run using its log file")
    args = parser.parse_args()

    if args.undo:
        undo(Path(args.undo))
        return 0

    if not args.folder:
        parser.error("give a folder, or --undo a log file")

    root = Path(args.folder).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a folder: {root}", file=sys.stderr)
        return 1

    print(f"{'RENAMING' if args.apply else 'DRY RUN — nothing will change'}\n{root}\n")

    log: list[dict] = []
    stats = walk(root, args.apply, args.remove_ds_store, log)

    print(
        f"\n{stats['files']} files, {stats['folders']} folders scanned."
        f"\n{stats['renamed']} need renaming."
        + (f"\n{stats['deleted']} .DS_Store deleted." if stats["deleted"] else "")
        + (f"\n{stats['skipped']} hidden files skipped." if stats["skipped"] else "")
    )

    if not args.apply:
        print("\nNothing was changed. Re-run with --apply to do it.")
        return 0

    if log:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        log_path = Path(__file__).parent / f"rename-log-{stamp}.json"
        log_path.write_text(json.dumps(log, indent=1))
        print(f"\nLog written to {log_path}")
        print(f"Reverse it with:\n  python3 {Path(__file__).name} --undo {log_path.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
