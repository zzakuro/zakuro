"""Inspect a game folder and gather every fact the detector needs."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import const
from .pe import PEInfo, read_pe
from .util import iter_exes, read_json

STEAM_API_DLLS = ("steam_api64.dll", "steam_api.dll", "steamclient64.dll", "steamclient.dll")


@dataclass
class ExeCandidate:
    path: Path
    rel: str
    size: int
    pe: PEInfo
    score: float = 0.0
    primary: bool = False

    @property
    def bitness(self) -> int:
        return self.pe.bitness


@dataclass
class GameFacts:
    root: Path
    exes: list[ExeCandidate] = field(default_factory=list)
    primary: ExeCandidate | None = None
    appid: int | None = None
    appid_sources: list[str] = field(default_factory=list)
    app_name: str | None = None
    bitness: int = 0
    all_bitness: set[int] = field(default_factory=set)
    emu_dlls: dict[str, Path] = field(default_factory=dict)
    original_dlls: dict[str, Path] = field(default_factory=dict)
    steam_settings: Path | None = None
    emu_settings_files: list[str] = field(default_factory=list)
    legacy_markers: list[str] = field(default_factory=list)
    marker: dict | None = None
    marker_state: str = "absent"  # absent | verified | modified | foreign
    marker_note: str = ""
    patcher: str = "none"  # see const.PATCHER_*
    patcher_note: str = ""
    extra_txt: list[Path] = field(default_factory=list)
    extra_lnk: list[Path] = field(default_factory=list)
    has_steamstub: bool = False
    steam_referencing_exes: list[str] = field(default_factory=list)
    is_steam_game_like: bool = False
    payload: dict[str, str] = field(default_factory=dict)  # rel path -> category
    errors: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.app_name or self.root.name

    @property
    def has_payload(self) -> bool:
        """True when any emulator artefact is deployed in the folder."""
        return bool(self.emu_dlls or self.emu_settings_files or self.legacy_markers)

    def summary(self) -> dict:
        return {
            "root": str(self.root),
            "name": self.name,
            "appid": self.appid,
            "appid_sources": self.appid_sources,
            "app_name": self.app_name,
            "bitness": self.bitness,
            "all_bitness": sorted(self.all_bitness),
            "primary_exe": self.primary.rel if self.primary else None,
            "primary_exe_size": self.primary.size if self.primary else 0,
            "candidates": [
                {
                    "path": e.rel,
                    "size": e.size,
                    "bitness": e.bitness,
                    "primary": e.primary,
                    "steamstub": e.pe.has_steamstub(),
                    "imports_steam_api": bool(
                        e.pe.imports_any(STEAM_API_DLLS) or _links_steam_api(e.pe)
                    ),
                }
                for e in self.exes
            ],
            "emu_dlls": {k: str(v) for k, v in self.emu_dlls.items()},
            "original_dlls": {k: str(v) for k, v in self.original_dlls.items()},
            "steam_settings": str(self.steam_settings) if self.steam_settings else None,
            "emu_settings_files": self.emu_settings_files,
            "legacy_markers": self.legacy_markers,
            "has_steamstub": self.has_steamstub,
            "steam_referencing_exes": self.steam_referencing_exes,
            "patcher": self.patcher,
            "patcher_note": self.patcher_note,
            "marker": self.marker,
            "marker_state": self.marker_state,
            "marker_note": self.marker_note,
            "payload": self.payload,
            "extra_txt": [str(p) for p in self.extra_txt],
            "extra_lnk": [str(p) for p in self.extra_lnk],
            "errors": self.errors,
        }


def _links_steam_api(pe: PEInfo) -> bool:
    """Some titles load steam_api dynamically (LoadLibrary + GetProcAddress)."""
    if not pe.is_pe:
        return False
    for dll in ("kernel32.dll", "KERNEL32.DLL"):
        funcs = pe.imports_of(dll)
        if "LoadLibraryA" in funcs or "LoadLibraryW" in funcs:
            return True
    return False


def _score_exe(cand_path: Path, root: Path) -> tuple[float, PEInfo]:
    pe = read_pe(cand_path)
    name = cand_path.name.lower()
    try:
        rel_parts = cand_path.relative_to(root).parts[:-1]
    except ValueError:
        rel_parts = ()

    score = 0.0
    for token in const.EXE_IGNORE_TOKENS:
        if token in name or any(token in part.lower() for part in rel_parts):
            score -= 100.0
    if pe.has_steamstub():
        score += 60.0
    if pe.imports_any(STEAM_API_DLLS):
        score += 120.0
    if _links_steam_api(pe):
        score += 15.0
    if not rel_parts:
        score += 30.0
    elif len(rel_parts) == 1 and rel_parts[0].lower() in ("bin", "win32", "win64", "x64"):
        score += 25.0
    if pe.looks_dotnet():
        score += 5.0
    if pe.is_pe:
        score += min(40.0, cand_path.stat().st_size / (1024 * 1024))
    else:
        score -= 20.0
    return score, pe


def find_primary_exe(root: Path, max_depth: int = 2) -> tuple[ExeCandidate | None, list[ExeCandidate]]:
    candidates: list[ExeCandidate] = []
    for path in iter_exes(root, max_depth=max_depth):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        score, pe = _score_exe(path, root)
        candidates.append(
            ExeCandidate(
                path=path,
                rel=str(path.relative_to(root)),
                size=size,
                pe=pe,
                score=score,
            )
        )
    if not candidates:
        return None, []
    candidates.sort(key=lambda c: (-c.score, c.rel.lower()))
    best = candidates[0]
    # Only promote a candidate that actually looks like a game binary.
    if best.score <= 0:
        return None, candidates
    best.primary = True
    return best, candidates


def _find_appid(facts: GameFacts) -> None:
    """Collect every app id we can prove, most trustworthy source first."""
    root = facts.root

    def record(value: str | None, source: str) -> bool:
        if not value:
            return False
        try:
            appid = int(str(value).strip())
        except ValueError:
            return False
        if appid <= 0:
            return False
        if source in facts.appid_sources:
            return True
        facts.appid_sources.append(source)
        if facts.appid is None:
            facts.appid = appid
        return True

    marker = facts.marker or {}
    record(marker.get("appid"), "marker")

    for name in const.APPID_FILENAMES:
        for base in (root, facts.steam_settings or root):
            candidate = base / name
            if candidate.is_file():
                record(candidate.read_text(encoding="utf-8", errors="ignore"), f"file:{name}")

    if facts.steam_settings:
        appinfo = facts.steam_settings / "appinfo.vdf"
        if not appinfo.is_file():
            appinfo = facts.steam_settings / "appcache" / "appinfo.vdf"
        if appinfo.is_file():
            text = appinfo.read_text(encoding="utf-8", errors="ignore")
            match = re.search(r'"appid"\s+"(\d+)"', text)
            if record(match.group(1) if match else None, "appinfo.vdf"):
                name_match = re.search(r'"name"\s+"([^"]+)"', text)
                if name_match:
                    facts.app_name = name_match.group(1)

    configs_app = facts.steam_settings / "configs.app.ini" if facts.steam_settings else None
    if configs_app and configs_app.is_file():
        text = configs_app.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"^\s*appid\s*=\s*(\d+)", text, re.MULTILINE)
        record(match.group(1) if match else None, "configs.app.ini")

    # Steam library layout: <library>/steamapps/common/<Game>/...
    for parent in [root, *root.parents[:4]]:
        steamapps = parent / "steamapps"
        if not steamapps.is_dir():
            continue
        for acf in steamapps.glob("appmanifest_*.acf"):
            text = acf.read_text(encoding="utf-8", errors="ignore")
            appid_match = re.search(r'"appid"\s+"(\d+)"', text)
            if not appid_match:
                continue
            if record(appid_match.group(1), acf.name):
                name_match = re.search(r'"name"\s+"([^"]+)"', text)
                if name_match and not facts.app_name:
                    facts.app_name = name_match.group(1)
        break

    if facts.primary and not facts.app_name:
        stem = facts.primary.path.stem
        if stem.lower() not in ("launcher", "start", "game", "main", "win64-shipping"):
            facts.app_name = stem


def _classify_emu_dll(path: Path) -> tuple[str, int, list[str]]:
    """Return (verdict, score, notes): emu | original | unknown."""
    notes: list[str] = []
    try:
        data = path.read_bytes()
    except OSError as exc:
        return "unknown", 0, [f"unreadable: {exc}"]
    from .pe import read_pe

    pe = read_pe(path)
    size = len(data)
    score = 0
    lowered = data.lower()
    for needle, weight in const.EMU_STRING_MARKERS:
        if needle in lowered or needle.decode().encode("utf-16-le") in data:
            score += weight
            notes.append(f"marker '{needle.decode()}'")
    if pe.has_signature:
        score -= 4
        notes.append("authenticode signed (looks like a Valve build)")
    if pe.is_pe and pe.is_64bit and size < 3 * 1024 * 1024:
        score += 1
        notes.append(f"size {size // 1024} KB")
    if pe.is_pe and pe.imports_of("version.dll"):
        score -= 1
    if score >= 4:
        verdict = "emu"
    elif score <= 0:
        verdict = "original"
    else:
        verdict = "unknown"
    return verdict, score, notes


def _scan_steam_settings(facts: GameFacts) -> None:
    ss = facts.root / const.STEAM_SETTINGS_DIR
    if not ss.is_dir():
        return
    facts.steam_settings = ss
    for rel in const.EMU_SETTINGS_FILES:
        if (ss / rel).exists():
            facts.emu_settings_files.append(rel)
    for rel in const.LEGACY_EMU_MARKERS:
        if (facts.root / rel).exists() or (ss / rel).exists():
            facts.legacy_markers.append(rel)
    if not facts.emu_settings_files:
        # Folder exists but holds nothing we recognise: still worth reporting.
        facts.emu_settings_files.append("<empty-or-unrecognised>")


def _scan_dlls(facts: GameFacts) -> None:
    for name in const.EMU_DLL_NAMES:
        for path in (facts.root / name,):
            if not path.is_file():
                continue
            verdict, _score, notes = _classify_emu_dll(path)
            log_msg = f"{name}: {verdict}"
            if notes:
                log_msg += f" ({'; '.join(notes[:3])})"
            from .util import log

            log.debug(log_msg)
            if verdict == "emu":
                facts.emu_dlls[name] = path
            else:
                facts.original_dlls[name] = path


def _scan_extras(facts: GameFacts) -> None:
    for path in sorted(facts.root.glob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".txt":
            facts.extra_txt.append(path)
        elif suffix == ".lnk":
            facts.extra_lnk.append(path)


def _has_rune_markers(facts: GameFacts) -> list[str]:
    """RUNE leaves `.rne` libraries and a `steam_emu.ini` behind."""
    hits: list[str] = []
    for path in facts.root.rglob("*.rne"):
        hits.append(path.relative_to(facts.root).as_posix())
        if len(hits) >= 5:
            break
    for candidate in [facts.root / "steam_emu.ini", *sorted(facts.root.glob("*.ini"))]:
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "RUNE_" in text or "RUNE" in text.upper():
            hits.append(candidate.name)
            break
    return hits


def identify_patcher(facts: GameFacts) -> None:
    """Work out which emulator deployment (if any) the folder carries."""
    marker = facts.marker if isinstance(facts.marker, dict) else {}
    settings_files = [f for f in facts.emu_settings_files if not f.startswith("<")]

    if marker.get("tool") == const.TOOL_NAME:
        facts.patcher = const.PATCHER_SELF
        facts.patcher_note = "patched by this tool"
        return

    if _has_rune_markers(facts):
        facts.patcher = const.PATCHER_RUNE
        facts.patcher_note = "RUNE style deployment (.rne / steam_emu.ini)"
        return

    gbe_hits = [f for f in settings_files if f in const.GBE_FORK_MARKERS]
    classic_hits = [f for f in settings_files if f in const.GOLDBERG_CLASSIC_MARKERS]
    if any(f in const.GOLDBERG_CLASSIC_MARKERS for f in facts.legacy_markers):
        classic_hits.append("steam_emu.ini")

    if gbe_hits and not classic_hits:
        facts.patcher = const.PATCHER_GBE_FORK
        facts.patcher_note = "gbe_fork layout: " + ", ".join(gbe_hits[:3])
    elif classic_hits and not gbe_hits:
        facts.patcher = const.PATCHER_GOLDBERG_CLASSIC
        facts.patcher_note = "pre-fork Goldberg layout: " + ", ".join(classic_hits[:3])
    elif gbe_hits and classic_hits:
        facts.patcher = const.PATCHER_GBE_FORK
        facts.patcher_note = "gbe_fork layout, with some pre-fork leftovers"
    elif facts.emu_dlls or facts.legacy_markers:
        facts.patcher = const.PATCHER_UNKNOWN_EMU
        facts.patcher_note = "emulator libraries found, but no recognisable steam_settings"
    elif facts.is_steam_game_like and not facts.has_steamstub:
        facts.patcher = const.PATCHER_STEAMLESS_ONLY
        facts.patcher_note = "SteamStub removed, but no emulator deployed"
    else:
        facts.patcher = "none"
        facts.patcher_note = "no emulator artefacts found"


def _scan_payload(facts: GameFacts) -> None:
    """Label every top level entry so selections and reports can talk about it."""
    from .select import categorize

    if not facts.root.is_dir():
        return
    for entry in sorted(facts.root.iterdir(), key=lambda p: p.name.lower()):
        try:
            rel = entry.relative_to(facts.root).as_posix()
        except ValueError:
            continue
        facts.payload[rel] = categorize(rel, entry.is_dir())


def probe(root: str | Path, max_depth: int = 2) -> GameFacts:
    root = Path(root).expanduser().resolve()
    facts = GameFacts(root=root)
    if not root.is_dir():
        facts.errors.append(f"not a directory: {root}")
        return facts

    facts.primary, facts.exes = find_primary_exe(root, max_depth=max_depth)
    for cand in facts.exes:
        if cand.pe.is_pe:
            facts.all_bitness.add(cand.bitness)
        if cand.pe.has_steamstub():
            facts.has_steamstub = True
        if cand.pe.imports_any(STEAM_API_DLLS):
            facts.steam_referencing_exes.append(cand.rel)

    if facts.primary:
        facts.bitness = facts.primary.bitness

    _scan_steam_settings(facts)
    _scan_dlls(facts)
    _scan_extras(facts)
    _scan_payload(facts)

    facts.marker = read_json(root / const.MARKER_FILENAME)
    _find_appid(facts)
    facts.is_steam_game_like = bool(
        facts.steam_referencing_exes or facts.emu_dlls or facts.original_dlls
    )
    identify_patcher(facts)
    return facts
