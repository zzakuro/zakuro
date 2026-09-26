"""Locate the external programs the patcher drives."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .util import log

SEVENZIP_CANDIDATES = (
    r"C:\Program Files\7-Zip\7z.exe",
    r"C:\Program Files (x86)\7-Zip\7z.exe",
    r"C:\Program Files\7-Zip\7za.exe",
    r"C:\Program Files (x86)\7-Zip\7za.exe",
)

STEAMLESS_NAMES = ("Steamless.CLI.exe", "Steamless.CLI")

# Sub-folder names emulator builds use to ship both architectures.
ARCH_DIRS = {
    32: ("x86", "win32", "32", "i386", "x86_32", "release_x86"),
    64: ("x64", "win64", "64", "x86_64", "amd64", "release_x64"),
}


def _on_path(name: str) -> Path | None:
    found = shutil.which(name)
    return Path(found) if found else None


def _first_file(paths) -> Path | None:
    for candidate in paths:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def find_7z(explicit: str | Path | None = None) -> Path | None:
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return path
        log.warn(f"7-Zip not found at {path}")
    env = os.environ.get("SEVENZIP") or os.environ.get("SEVEN_ZIP")
    if env and Path(env).is_file():
        return Path(env)
    found = _first_file(SEVENZIP_CANDIDATES) or _on_path("7z") or _on_path("7za") or _on_path("7zz")
    if found:
        return found
    # Emulator/tool bundles usually ship a standalone 7za.
    here = Path.cwd()
    for rel in (
        "steamless/tools/7za.exe",
        "third-party/deps/win/7za/7za.exe",
        "tools/7za.exe",
    ):
        candidate = here / rel
        if candidate.is_file():
            return candidate
    return None


def seven_zip_version(exe: Path) -> str:
    try:
        out = subprocess.run(
            [str(exe)], capture_output=True, text=True, timeout=30, check=False
        )
        first = (out.stdout or out.stderr).splitlines()[0] if (out.stdout or out.stderr) else ""
        return first.strip()
    except (OSError, subprocess.SubprocessError, IndexError):
        return "unknown"


def default_threads(percent: int = 70) -> int:
    count = os.cpu_count() or 2
    return max(1, count * percent // 100)


def _walk_depth(root: Path, max_depth: int = 3, skip: tuple[str, ...] = ()):
    root_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        if len(here.parts) - root_depth >= max_depth:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if d.lower() not in skip]
        yield here, dirnames, filenames


def find_steamless(explicit: str | Path | None = None) -> Path | None:
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return path
        log.warn(f"Steamless CLI not found at {path}")
    env = os.environ.get("STEAMLESS")
    if env and Path(env).is_file():
        return Path(env)
    roots = [Path.cwd(), Path(__file__).resolve().parent.parent]
    skip = ("steamapps", "node_modules", "$recycle.bin", "windows", "system32")
    fallback: Path | None = None
    for root in roots:
        if not root.is_dir():
            continue
        for _here, _dirs, filenames in _walk_depth(root, skip=skip):
            for name in STEAMLESS_NAMES:
                if name in filenames:
                    candidate = _here / name
                    if candidate.parent.name.lower() == "steamless":
                        return candidate
                    if fallback is None and name == STEAMLESS_NAMES[0]:
                        fallback = candidate
            if fallback is not None:
                return fallback
    return None


@dataclass
class EmuSource:
    """A folder holding emulator libraries for one or both architectures."""

    root: Path
    found: dict[str, Path] = field(default_factory=dict)  # bitness -> dll path
    settings_example: Path | None = None

    def dll_for(self, bitness: int) -> Path | None:
        return self.found.get(bitness)

    def all_dlls(self) -> list[Path]:
        return [p for _bits, p in sorted(self.found.items())]


def _dll_candidates_for(bitness: int) -> tuple[str, ...]:
    if bitness == 64:
        return ("steam_api64.dll", "steamclient64.dll", "libsteam_api.so")
    return ("steam_api.dll", "steamclient.dll", "libsteam_api.so")


def _scan_emu_dir(path: Path) -> EmuSource:
    source = EmuSource(root=path)
    for bitness, dirnames in ARCH_DIRS.items():
        search_dirs = [path / sub for sub in dirnames] + [path]
        for base in search_dirs:
            if not base.is_dir():
                continue
            for name in _dll_candidates_for(bitness):
                candidate = base / name
                if candidate.is_file():
                    source.found.setdefault(bitness, candidate)
                    break
            if bitness in source.found:
                break
    for rel in ("steam_settings.EXAMPLE", "steam_settings", "post_build/steam_settings.EXAMPLE"):
        candidate = path / rel
        if candidate.is_dir():
            source.settings_example = candidate
            break
    return source


def find_emu_source(explicit: str | Path | None = None) -> EmuSource | None:
    if explicit:
        path = Path(explicit)
        if path.is_dir():
            return _scan_emu_dir(path)
        log.warn(f"emulator folder not found: {path}")
        return None
    env = os.environ.get("GBE_EMU_DIR") or os.environ.get("STEAM_EMU_DIR")
    if env and Path(env).is_dir():
        return _scan_emu_dir(Path(env))
    skip = ("steamapps", "node_modules", "$recycle.bin")
    for root in (Path.cwd(), Path(__file__).resolve().parent.parent):
        if not root.is_dir():
            continue
        for _here, _dirs, filenames in _walk_depth(root, max_depth=4, skip=skip):
            if "steam_api64.dll" in filenames or "steam_api.dll" in filenames:
                source = _scan_emu_dir(_here)
                if source.found:
                    log.debug(f"emulator source guess: {_here}")
                    return source
    return None


def find_gen_emu_config(explicit: str | Path | None = None) -> Path | None:
    """`generate_emu_config` from gse_fork_tools: an exe or a .py entrypoint."""
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return path
        log.warn(f"generate_emu_config not found at {path}")
        return None
    env = os.environ.get("GSE_GEN_EMU_CONFIG")
    if env and Path(env).is_file():
        return Path(env)
    skip = ("steamapps", "node_modules", "$recycle.bin")
    for root in (Path.cwd(), Path(__file__).resolve().parent.parent):
        if not root.is_dir():
            continue
        for _here, _dirs, filenames in _walk_depth(root, max_depth=4, skip=skip):
            for name in ("generate_emu_config.exe", "generate_emu_config.py"):
                if name in filenames:
                    return _here / name
    return None
