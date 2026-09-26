"""Logging, hashing, prompts and other odds and ends."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Iterable

_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40, "silent": 100}

_COLOR = {
    "debug": "\033[90m",
    "info": "",
    "ok": "\033[32m",
    "warn": "\033[33m",
    "error": "\033[31m",
    "step": "\033[36m",
    "reset": "\033[0m",
}


class Log:
    def __init__(self, level: str = "info", color: bool | None = None):
        self.level = _LEVELS.get(level, 20)
        if color is None:
            color = sys.stdout.isatty() and os.name == "nt" or sys.stdout.isatty()
        self.color = bool(color)
        self._quiet = False

    def _paint(self, text: str, key: str) -> str:
        if not self.color or key not in _COLOR:
            return text
        return f"{_COLOR[key]}{text}{_COLOR['reset']}"

    def _emit(self, key: str, threshold: int, prefix: str, message: str) -> None:
        if self.level > threshold or self._quiet:
            return
        stamp = time.strftime("%H:%M:%S")
        line = f"{stamp} {prefix} {message}"
        print(self._paint(line, key) if key else line, flush=True)

    def debug(self, message: str) -> None:
        self._emit("debug", 10, "DBG", message)

    def info(self, message: str) -> None:
        self._emit("", 20, "   ", message)

    def step(self, message: str) -> None:
        self._emit("step", 20, "==> ", message)

    def ok(self, message: str) -> None:
        self._emit("ok", 20, " OK ", message)

    def warn(self, message: str) -> None:
        self._emit("warn", 30, "WRN", message)

    def error(self, message: str) -> None:
        self._emit("error", 40, "ERR", message)

    def plain(self, message: str = "") -> None:
        if not self._quiet:
            print(message, flush=True)

    def rule(self, title: str = "") -> None:
        if self._quiet or self.level > 20:
            return
        width = 74
        if title:
            pad = max(0, width - len(title) - 3)
            self.plain(self._paint(f"-- {title} " + "-" * pad, "step"))
        else:
            self.plain(self._paint("-" * width, "step"))


log = Log()


def human_size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num) < 1024.0 or unit == "TB":
            return f"{num:.1f} {unit}" if unit != "B" else f"{int(num)} B"
        num /= 1024.0
    return f"{num:.1f} TB"


def sha256_file(path: str | Path, chunk: int = 4 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def read_json(path: str | Path) -> Any:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def copy2(src: Path, dst: Path, log_msg: bool = True) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    if log_msg:
        log.info(f"copied {src.name} -> {_rel(dst)}")


def _rel(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def confirm(prompt: str, assume_yes: bool, default: bool = False) -> bool:
    if assume_yes:
        return True
    if not sys.stdin or not sys.stdin.isatty():
        return default
    suffix = "[y/N]" if not default else "[Y/n]"
    try:
        answer = input(f"{prompt} {suffix} ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    if not answer:
        return default
    return answer in ("y", "yes")


def dir_size(path: Path, follow_symlinks: bool = False) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=follow_symlinks):
        for name in files:
            fp = Path(root) / name
            try:
                if fp.is_symlink():
                    continue
                total += fp.stat().st_size
            except OSError:
                continue
    return total


def iter_exes(root: Path, max_depth: int = 2, limit: int = 400) -> Iterable[Path]:
    """Yield .exe files under `root`, shallowest first, capped for safety."""
    root_depth = len(root.parts)
    found: list[tuple[int, Path]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        depth = len(here.parts) - root_depth
        dirnames[:] = [
            d
            for d in dirnames
            if d.lower() not in ("steam_settings", "_autopatcher", "$recycle.bin")
        ]
        if depth >= max_depth:
            dirnames[:] = []
        for name in filenames:
            if name.lower().endswith(".exe"):
                found.append((depth, here / name))
        if len(found) > limit:
            break
    found.sort(key=lambda item: (item[0], item[1].name.lower()))
    return [path for _depth, path in found]


def safe_rmtree(path: Path) -> None:
    def on_error(func, target, _exc):
        try:
            os.chmod(target, 0o700)
            func(target)
        except OSError:
            pass

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=on_error)
    else:
        shutil.rmtree(path, onerror=on_error)


def short_exe_name(path: Path) -> str:
    return path.name if len(path.name) <= 40 else path.name[:37] + "..."
