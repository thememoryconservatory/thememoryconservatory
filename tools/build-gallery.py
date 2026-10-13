#!/usr/bin/env python3
"""
Build web-sized copies of the client's gallery.

Reads the folder of originals and writes two copies of every photograph into a
separate output folder — a thumbnail for the grid and a larger one for the
lightbox. The originals are only ever read.

    Gallery/                              gallery-web/
      sheena-x-daniel/                      manifest.json
        photo-135.jpg   (20 MB, 33 MP)      sheena-x-daniel/
                                              thumb/photo-135.jpg   (~60 KB)
                                              full/photo-135.jpg    (~450 KB)

The output folder is what gets uploaded to Cloudflare Pages, so the URLs are:

    https://tmc-gallery.pages.dev/sheena-x-daniel/full/photo-135.jpg

manifest.json lists every wedding and photograph with its aspect ratio, so the
gallery page can reserve the right space before an image loads and the layout
never jumps.

    python3 tools/build-gallery.py "path/to/Gallery" "path/to/gallery-web"
    python3 tools/build-gallery.py SOURCE OUT --limit 5      # try a few first

Re-running skips anything already built, so adding one wedding is quick.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is needed:  pip3 install Pillow")

# Pillow refuses very large images by default as a decompression-bomb guard.
# These are the client's own photographs, so lift it — 33 MP is expected here.
Image.MAX_IMAGE_PIXELS = None

SIZES = {
    # name     long edge  JPEG quality
    "thumb": (600, 72),
    "full": (2560, 82),
}


def build_one(source: Path, out_root: Path, rel: Path, sizes: dict, overwrite: bool) -> dict | None:
    """Write every size of one photograph. Returns its manifest entry."""
    targets = {name: out_root / rel.parent / name / rel.name for name in sizes}

    # Skip work already done, unless asked to redo it.
    if not overwrite and all(t.exists() for t in targets.values()):
        with Image.open(source) as probe:
            width, height = probe.size
        return entry(rel, width, height)

    with Image.open(source) as image:
        # Honour the camera's rotation flag, then drop it — otherwise a phone
        # photo can come out sideways once the metadata is stripped.
        image = ImageOps.exif_transpose(image)
        width, height = image.size

        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        for name, (long_edge, quality) in sizes.items():
            target = targets[name]
            target.parent.mkdir(parents=True, exist_ok=True)

            copy = image.copy()
            copy.thumbnail((long_edge, long_edge), Image.LANCZOS)
            # No exif= argument means no metadata is carried over: camera
            # serial numbers, timestamps and any GPS coordinates are dropped.
            copy.save(target, "JPEG", quality=quality, optimize=True, progressive=True)

    return entry(rel, width, height)


def entry(rel: Path, width: int, height: int) -> dict:
    return {
        "file": rel.name,
        "wedding": rel.parent.as_posix(),
        "ratio": round(width / height, 4),
    }


def human(num_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024 or unit == "GB":
            return f"{num_bytes:.0f} {unit}" if unit != "GB" else f"{num_bytes:.2f} {unit}"
        num_bytes /= 1024
    return ""


def folder_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("source", help="folder of original photographs")
    parser.add_argument("out", help="folder to write web copies into")
    parser.add_argument("--thumb", type=int, default=SIZES["thumb"][0], help="thumbnail long edge (px)")
    parser.add_argument("--full", type=int, default=SIZES["full"][0], help="full-view long edge (px)")
    parser.add_argument("--limit", type=int, help="only process this many photos (for a trial run)")
    parser.add_argument("--overwrite", action="store_true", help="rebuild files that already exist")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 4, help="parallel workers")
    args = parser.parse_args()

    source = Path(args.source).expanduser().resolve()
    out_root = Path(args.out).expanduser().resolve()
    if not source.is_dir():
        sys.exit(f"Not a folder: {source}")
    if out_root == source or out_root in source.parents:
        sys.exit("Output folder must be separate from the originals.")

    sizes = {"thumb": (args.thumb, SIZES["thumb"][1]), "full": (args.full, SIZES["full"][1])}

    photos = sorted(p for p in source.rglob("*.jpg") if not p.name.startswith("."))
    if args.limit:
        photos = photos[: args.limit]
    if not photos:
        sys.exit(f"No .jpg files found in {source}")

    print(f"{len(photos)} photographs from {source}")
    print(f"thumb {args.thumb}px  ·  full {args.full}px  ->  {out_root}\n")

    entries: list[dict] = []
    failures: list[tuple[Path, str]] = []
    done = 0

    def work(photo: Path):
        rel = photo.relative_to(source)
        try:
            return rel, build_one(photo, out_root, rel, sizes, args.overwrite), None
        except Exception as error:  # a corrupt file should not stop the run
            return rel, None, str(error)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for rel, result, error in pool.map(work, photos):
            done += 1
            if error:
                failures.append((rel, error))
            elif result:
                entries.append(result)
            print(f"\r  {done}/{len(photos)}  {rel.name[:52]:<52}", end="", flush=True)

    print("\n")

    # Group into the shape the gallery page wants: one block per wedding.
    weddings: dict[str, list[dict]] = {}
    for item in sorted(entries, key=lambda e: (e["wedding"], e["file"])):
        weddings.setdefault(item["wedding"], []).append(
            {"file": item["file"], "ratio": item["ratio"]}
        )

    manifest = {
        "sizes": {name: dimension for name, (dimension, _) in sizes.items()},
        "weddings": [
            {
                "slug": slug,
                # "sheena-x-daniel" -> "Sheena x Daniel", a starting point the
                # client will want to correct.
                "title": slug.replace("-", " ").title().replace(" X ", " x "),
                "photos": photos_in,
            }
            for slug, photos_in in weddings.items()
        ],
    }
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=1))

    original_size = sum(p.stat().st_size for p in photos)
    built_size = folder_size(out_root)
    print(f"Built {len(entries)} photographs in {len(weddings)} weddings.")
    print(f"  originals  {human(original_size)}")
    print(f"  web copies {human(built_size)}  ({built_size / original_size:.1%})")
    print(f"  manifest   {out_root / 'manifest.json'}")

    if failures:
        print(f"\n{len(failures)} failed:")
        for rel, error in failures[:10]:
            print(f"  {rel}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
