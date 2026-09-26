"""Decide what goes into the archive.

Three layers, in order of precedence:

1. ``--select PRESET``  - ``full`` (default), ``crack-only`` (emulator payload
   only, the "crack only" export) or ``game-only`` (everything except the
   payload).
2. ``--include`` / ``--exclude`` / ``--exclude-dir`` glob patterns. A pattern
   containing ``/`` is matched against the path relative to the game root, a
   pattern without one is matched against the file name anywhere in the tree,
   which is what ``-x *.pdb`` means to most people.
3. ``--list FILE`` - a text file with one path or glob per line, ``#`` comments
   allowed. Use it to reuse a selection you saved with ``--list-out``.

The result is written to a temporary 7-Zip list file so 7-Zip receives an exact
set of paths instead of a pile of switches.
"""

from __future__ import annotations

import fnmatch
import os
from dataclasses import dataclass, field
from pathlib import Path

from . import const
from .util import human_size, log

CATEGORY_EMU = "emulator payload"
CATEGORY_EXE = "game executable"
CATEGORY_DATA = "game data"
CATEGORY_EXTRAS = "extra files"
CATEGORY_JUNK = "tool leftovers"


@dataclass
class SelectionOptions:
    preset: str = "full"
    include: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    exclude_dirs: list[str] = field(default_factory=list)
    list_file: Path | None = None
    include_junk: bool = False
    max_depth: int = 0  # 0 = unlimited


@dataclass
class Selection:
    root: Path
    options: SelectionOptions
    files: list[str] = field(default_factory=list)      # relative posix paths
    dirs: list[str] = field(default_factory=list)       # relative posix paths
    skipped_junk: list[str] = field(default_factory=list)
    categories: dict[str, tuple[int, int]] = field(default_factory=dict)
    bytes_total: int = 0

    @property
    def count(self) -> int:
        return len(self.files) + len(self.dirs)

    def to_dict(self) -> dict:
        return {
            "root": str(self.root),
            "preset": self.options.preset,
            "include": self.options.include,
            "exclude": self.options.exclude,
            "exclude_dirs": self.options.exclude_dirs,
            "entries": self.count,
            "files": len(self.files),
            "dirs": len(self.dirs),
            "bytes": self.bytes_total,
            "categories": {
                name: {"entries": count, "bytes": size}
                for name, (count, size) in sorted(self.categories.items())
            },
            "skipped_junk": self.skipped_junk[:50],
        }


def _matches(rel: str, name: str, pattern: str) -> bool:
    pattern = pattern.replace("\\", "/").strip()
    if not pattern:
        return False
    if pattern.endswith("/"):
        # A directory pattern covers the whole subtree.
        pattern = pattern.rstrip("/")
        if rel == pattern or rel.startswith(pattern + "/"):
            return True
        return fnmatch.fnmatch(name, pattern)
    if "/" in pattern:
        return fnmatch.fnmatch(rel.lower(), pattern.lower())
    return fnmatch.fnmatch(name.lower(), pattern.lower())


def _is_junk_dir(name: str) -> bool:
    lowered = name.lower()
    return any(fnmatch.fnmatch(lowered, pattern) for pattern in const.JUNK_DIR_PATTERNS)


def categorize(rel: str, is_dir: bool) -> str:
    parts = rel.split("/")
    name = parts[-1].lower()
    if parts[0].lower() in const.PAYLOAD_DIRS:
        return CATEGORY_EMU
    if is_dir and any(fnmatch.fnmatch(name, p) for p in const.PAYLOAD_FILES):
        return CATEGORY_EMU
    if not is_dir and any(fnmatch.fnmatch(name, p) for p in const.PAYLOAD_FILES):
        return CATEGORY_EMU
    if not is_dir and name == const.MARKER_FILENAME:
        return CATEGORY_EMU
    if not is_dir and (name.endswith(".lnk") or name.endswith(".txt")):
        return CATEGORY_EXTRAS
    if not is_dir and name.endswith(".exe"):
        return CATEGORY_EXE
    return CATEGORY_DATA


def _read_list_file(path: Path) -> tuple[list[str], list[str], list[str]]:
    """Return (include, exclude, exclude_dirs) parsed from a selection file."""
    include: list[str] = []
    exclude: list[str] = []
    exclude_dirs: list[str] = []
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            exclude.append(line[1:].strip())
        elif line.startswith("/"):
            exclude_dirs.append(line[1:].strip())
        else:
            include.append(line)
    return include, exclude, exclude_dirs


def _walk(root: Path, options: SelectionOptions):
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        rel_dir = here.relative_to(root).as_posix()
        rel_posix = "" if rel_dir == "." else rel_dir

        if not options.include_junk:
            kept = []
            for name in sorted(dirnames):
                if _is_junk_dir(name):
                    yield "skip", (f"{rel_posix}/{name}" if rel_posix else name), None
                else:
                    kept.append(name)
            dirnames[:] = kept

        for name in sorted(filenames):
            rel = f"{rel_posix}/{name}" if rel_posix else name
            yield "file", rel, here / name

        for name in sorted(dirnames):
            rel = f"{rel_posix}/{name}" if rel_posix else name
            if options.max_depth and len(rel.split("/")) > options.max_depth:
                dirnames.remove(name)
                continue
            yield "dir", rel, here / name


def _is_excluded(rel: str, options: SelectionOptions, include: list[str]) -> bool:
    name = rel.split("/")[-1]
    for pattern in options.exclude:
        if _matches(rel, name, pattern):
            return True
    for pattern in options.exclude_dirs:
        if _matches(rel, name, pattern.rstrip("/") + "/") or rel == pattern.rstrip("/"):
            return True
    if include:
        # Inside an explicitly included subtree: still honour the excludes.
        for pattern in options.exclude_dirs:
            trimmed = pattern.rstrip("/")
            if rel == trimmed or rel.startswith(trimmed + "/"):
                return True
    return False


def _preset_allows(rel: str, name: str, is_dir: bool, preset: str) -> bool:
    if preset == "full":
        return True
    if preset == "crack-only":
        if is_dir:
            return name.lower() in const.PAYLOAD_DIRS
        top = rel.split("/")[0].lower()
        if top in const.PAYLOAD_DIRS:
            return True
        return any(fnmatch.fnmatch(name.lower(), p) for p in const.PAYLOAD_FILES)
    if preset == "game-only":
        if is_dir:
            return name.lower() not in const.PAYLOAD_DIRS
        top = rel.split("/")[0].lower()
        if top in const.PAYLOAD_DIRS:
            return False
        if name.lower() == const.MARKER_FILENAME:
            return False
        # A payload library sitting in the game root counts as payload too.
        return not any(fnmatch.fnmatch(name.lower(), p) for p in const.PAYLOAD_FILES)
    return True


def build_selection(root: str | Path, options: SelectionOptions | None = None) -> Selection:
    options = options or SelectionOptions()
    root = Path(root).expanduser().resolve()
    selection = Selection(root=root, options=options)
    if not root.is_dir():
        return selection

    include = list(options.include)
    exclude = list(options.exclude)
    exclude_dirs = list(options.exclude_dirs)
    if options.list_file:
        list_include, list_exclude, list_dirs = _read_list_file(Path(options.list_file))
        if list_include:
            include = list_include + include
        exclude.extend(list_exclude)
        exclude_dirs.extend(list_dirs)

    merged = SelectionOptions(
        preset=options.preset,
        include=include,
        exclude=exclude,
        exclude_dirs=exclude_dirs,
        list_file=options.list_file,
        include_junk=options.include_junk,
        max_depth=options.max_depth,
    )
    selection.options = merged
    if merged.preset not in const.SELECT_PRESETS:
        merged.preset = "full"

    for kind, rel, full in _walk(root, merged):
        name = rel.split("/")[-1]
        if kind == "skip":
            selection.skipped_junk.append(rel)
            continue
        is_dir = kind == "dir"

        if _is_excluded(rel, merged, include):
            continue
        if not _preset_allows(rel, name, is_dir, merged.preset):
            continue
        if include and not any(_matches(rel, name, p) for p in include) and not _under_include(rel, include):
            continue

        size = 0
        if not is_dir and full is not None:
            try:
                size = full.stat().st_size
            except OSError:
                continue
        if is_dir:
            selection.dirs.append(rel)
            size = 0
        else:
            selection.files.append(rel)
            selection.bytes_total += size

        category = categorize(rel, is_dir)
        count, total = selection.categories.get(category, (0, 0))
        selection.categories[category] = (count + 1, total + size)

    return selection


def _under_include(rel: str, include: list[str]) -> bool:
    """True when `rel` lives inside a directory named by an include pattern."""
    for pattern in include:
        trimmed = pattern.replace("\\", "/").rstrip("/")
        if not trimmed:
            continue
        head = trimmed.split("/")[0]
        if not fnmatch.fnmatch(rel.split("/")[0], head):
            continue
        if "/" not in trimmed:
            # A bare name: everything under a matching top level folder counts.
            return True
        if rel == trimmed or rel.startswith(trimmed + "/"):
            return True
    return False


def summary(selection: Selection) -> str:
    lines = [
        f"selection : preset={selection.options.preset}"
        + (f" include={selection.options.include}" if selection.options.include else "")
        + (f" exclude={selection.options.exclude}" if selection.options.exclude else "")
        + (f" exclude-dirs={selection.options.exclude_dirs}" if selection.options.exclude_dirs else ""),
        f"entries   : {selection.count} ({len(selection.files)} file(s), "
        f"{len(selection.dirs)} folder(s), {human_size(selection.bytes_total)})",
    ]
    for name, (count, size) in sorted(selection.categories.items()):
        lines.append(f"  {name:20} {count:6} entry(ies)  {human_size(size)}")
    if selection.skipped_junk:
        lines.append(f"  skipped {len(selection.skipped_junk)} tool leftover folder(s)")
    return "\n".join(lines)


def write_list_file(selection: Selection, dest: Path) -> int:
    """Write a 7-Zip list file. Returns the number of lines written."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for rel in selection.dirs:
        lines.append(rel.replace("/", os.sep))
    for rel in selection.files:
        # 7-Zip list files have no escape for newlines; skip the pathological.
        if "\n" in rel or "\r" in rel or '"' in rel:
            log.warn(f"skipped (unsupported name in a 7-Zip list file): {rel}")
            continue
        lines.append(rel.replace("/", os.sep))
    dest.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return len(lines)


def inventory(root: str | Path, options: SelectionOptions | None = None) -> list[dict]:
    """Per top level entry: size and category, for the `files` command."""
    root = Path(root).expanduser().resolve()
    rows: list[dict] = []
    if not root.is_dir():
        return rows
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if entry.is_dir():
            total = 0
            count = 0
            for dirpath, _dirs, filenames in os.walk(entry):
                for name in filenames:
                    fp = Path(dirpath) / name
                    try:
                        total += fp.stat().st_size
                        count += 1
                    except OSError:
                        pass
            category = categorize(entry.name, True)
            junk = _is_junk_dir(entry.name)
        else:
            try:
                total = entry.stat().st_size
            except OSError:
                continue
            count = 1
            category = categorize(entry.name, False)
            junk = False
        rows.append(
            {
                "name": entry.name,
                "kind": "dir" if entry.is_dir() else "file",
                "files": count,
                "bytes": total,
                "category": CATEGORY_JUNK if junk else category,
            }
        )
    return rows
