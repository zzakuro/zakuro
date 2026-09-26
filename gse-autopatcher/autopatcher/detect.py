"""Decide whether a game folder is patched, partially patched or unpatched."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from . import const
from .probe import GameFacts, probe
from .util import human_size, log, sha256_file

PATCHED = "patched"
PARTIAL = "partial"
UNPATCHED = "unpatched"
NOT_STEAM = "not-steam"
UNKNOWN = "unknown"

LABELS = {
    PATCHED: "ALREADY PATCHED",
    PARTIAL: "PARTIALLY PATCHED",
    UNPATCHED: "NOT PATCHED",
    NOT_STEAM: "NO STEAM INTEGRATION",
    UNKNOWN: "UNKNOWN",
}

ACTION_LABELS = {
    "drm_removal": "strip SteamStub DRM from the game executable",
    "emu_dll": "install the emulator library matching the game bitness",
    "steam_settings": "create the steam_settings folder",
    "interfaces": "generate steam_settings/steam_interfaces.txt",
    "appid": "resolve and write the Steam app id",
    "extras": "add the extra .txt / .lnk files",
    "marker": "write the autopatch marker",
}


@dataclass
class Detection:
    verdict: str
    confidence: float
    reasons: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    is_steam_game: bool = False
    patcher: str = "none"
    patcher_note: str = ""
    marker_state: str = "absent"
    emu_match: str = "unknown"  # match | mismatch | unknown
    emu_mismatched: list[str] = field(default_factory=list)
    facts: GameFacts | None = None

    @property
    def label(self) -> str:
        return LABELS.get(self.verdict, self.verdict.upper())

    @property
    def needs_patch(self) -> bool:
        return self.verdict in (UNPATCHED, PARTIAL)

    @property
    def actions(self) -> list[str]:
        return [ACTION_LABELS.get(m, m) for m in self.missing]

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "label": self.label,
            "confidence": round(self.confidence, 2),
            "is_steam_game": self.is_steam_game,
            "patcher": self.patcher,
            "patcher_note": self.patcher_note,
            "marker_state": self.marker_state,
            "emu_build": self.emu_match,
            "emu_mismatched": self.emu_mismatched,
            "reasons": self.reasons,
            "missing": self.missing,
            "actions": self.actions,
            "facts": self.facts.summary() if self.facts else None,
        }


def _emu_dll_for_bitness(facts: GameFacts, bitness: int) -> str | None:
    if bitness == 64:
        for name in const.EMU_DLLS_64:
            if name in facts.emu_dlls:
                return name
    elif bitness == 32:
        for name in const.EMU_DLLS_32:
            if name in facts.emu_dlls:
                return name
    return None


def _marker_state(facts: GameFacts) -> tuple[str, str]:
    """Classify the marker: absent / verified / modified / foreign."""
    marker = facts.marker
    if marker is None:
        return "absent", ""
    if not isinstance(marker, dict):
        return "foreign", "marker file is not valid JSON"
    if marker.get("tool") != const.TOOL_NAME:
        return "foreign", f"marker written by {marker.get('tool', 'another tool')}"
    recorded = marker.get("files") or {}
    if not isinstance(recorded, dict) or not recorded:
        return "verified", f"marker v{marker.get('marker_version', '?')} (no hashes recorded)"
    for rel, expected in recorded.items():
        path = facts.root / rel
        if not path.is_file():
            return "modified", f"marker references a missing file: {rel}"
        if isinstance(expected, str) and expected.startswith("sha256:"):
            try:
                actual = sha256_file(path)
            except OSError as exc:
                return "modified", f"{rel} could not be read: {exc}"
            if actual != expected.split(":", 1)[1]:
                return "modified", f"{rel} changed since it was patched"
    return "verified", f"marker v{marker.get('marker_version', '?')} verified"


def _compare_emu_build(facts: GameFacts, emu_source) -> tuple[str, list[str]]:
    """Compare the deployed libraries with the configured emulator build."""
    if emu_source is None or not getattr(emu_source, "found", None):
        return "unknown", []
    compared = 0
    mismatched: list[str] = []
    for name, deployed in sorted(facts.emu_dlls.items()):
        source = emu_source.root / name
        if not source.is_file():
            continue
        compared += 1
        try:
            if sha256_file(deployed) != sha256_file(source):
                mismatched.append(name)
        except OSError:
            mismatched.append(name)
    if not compared:
        return "unknown", []
    return ("mismatch" if mismatched else "match"), mismatched


def detect(
    facts: GameFacts | str | Path,
    verify_hashes: bool = True,
    emu_source=None,
) -> Detection:
    if not isinstance(facts, GameFacts):
        facts = probe(facts)

    det = Detection(verdict=UNKNOWN, confidence=0.0, facts=facts)
    reasons: list[str] = det.reasons
    det.patcher = facts.patcher
    det.patcher_note = facts.patcher_note
    det.marker_state, facts.marker_note = _marker_state(facts)
    det.marker_state = facts.marker_state

    if facts.errors:
        reasons.extend(facts.errors)
        return det

    if not facts.primary:
        if facts.exes:
            reasons.append(
                f"none of the {len(facts.exes)} executable(s) look like a game binary"
            )
            if not facts.steam_referencing_exes and not facts.emu_dlls and not facts.original_dlls:
                det.verdict = NOT_STEAM
                det.confidence = 0.6
                reasons.append("conclusion: no Steam integration in this folder")
                return det
        else:
            reasons.append("no .exe found")
        return det

    primary = facts.primary
    reasons.append(f"main executable: {primary.rel} ({human_size(primary.size)}, {primary.bitness}-bit {primary.pe.arch})")

    emu_dlls = sorted(facts.emu_dlls)
    original_dlls = sorted(facts.original_dlls)
    settings_files = [
        f for f in facts.emu_settings_files if not f.startswith("<")
    ]

    if facts.marker is not None:
        reasons.append(f"autopatch marker: {facts.marker_note or 'unverified'}")
    if facts.patcher != "none":
        reasons.append(f"patch looks like: {facts.patcher} ({facts.patcher_note})")

    if emu_source is not None and emu_dlls:
        det.emu_match, det.emu_mismatched = _compare_emu_build(facts, emu_source)
        if det.emu_match == "match":
            reasons.append("emulator library is byte identical to the configured emu build")
        elif det.emu_match == "mismatch":
            reasons.append(
                "emulator library differs from the configured emu build: "
                + ", ".join(det.emu_mismatched)
                + " (re-patch with --force to update)"
            )

    imports_steam = bool(primary.pe.imports_any(
        ("steam_api64.dll", "steam_api.dll", "steamclient64.dll", "steamclient.dll")
    ))
    references_steam = bool(facts.steam_referencing_exes) or bool(original_dlls) or bool(emu_dlls)
    det.is_steam_game = imports_steam or references_steam

    if imports_steam:
        reasons.append("game imports the Steam API")
    elif references_steam:
        reasons.append("Steam API libraries are present next to the game")
    else:
        reasons.append("no Steam API reference found in the folder")

    if emu_dlls:
        reasons.append("emulator libraries in place: " + ", ".join(emu_dlls))
    if original_dlls:
        reasons.append("original Steam libraries still present: " + ", ".join(original_dlls))
    if facts.steam_settings:
        reasons.append(f"steam_settings/ present with {len(settings_files) or 0} recognised file(s)")
    if facts.legacy_markers:
        reasons.append("legacy emulator markers: " + ", ".join(facts.legacy_markers))
    if facts.has_steamstub:
        stub_exes = [e.rel for e in facts.exes if e.pe.has_steamstub()]
        reasons.append("SteamStub `.bind` section found in: " + ", ".join(stub_exes))
    if facts.extra_txt:
        reasons.append("extra .txt present: " + ", ".join(p.name for p in facts.extra_txt))
    if facts.extra_lnk:
        reasons.append("shortcut present: " + ", ".join(p.name for p in facts.extra_lnk))

    # -- required pieces ------------------------------------------------
    missing: list[str] = []
    if facts.has_steamstub:
        missing.append("drm_removal")
    if not _emu_dll_for_bitness(facts, facts.bitness):
        missing.append("emu_dll")
    if not facts.steam_settings or not settings_files:
        missing.append("steam_settings")
    if "steam_interfaces.txt" not in settings_files:
        missing.append("interfaces")
    if facts.appid is None:
        missing.append("appid")
    # A patch that is there but no longer matches the recorded state is not
    # "already patched": it needs the steps re-run.
    if det.emu_match == "mismatch" and "emu_dll" not in missing:
        missing.append("emu_dll")

    # -- verdict --------------------------------------------------------
    has_emu = bool(emu_dlls) or bool(settings_files) or bool(facts.legacy_markers)
    confidence = 0.55
    if facts.marker_state == "verified":
        confidence += 0.35
        reasons.append("marker file hashes match the patched build")
    elif facts.marker_state == "modified":
        confidence -= 0.2
    if len(settings_files) >= 2:
        confidence += 0.1
    if original_dlls and emu_dlls:
        confidence -= 0.15
        reasons.append("both original and emulator libraries are present")

    if not det.is_steam_game and not has_emu:
        det.verdict = NOT_STEAM
        det.confidence = 0.7
        det.missing = []
        reasons.append("conclusion: nothing Steam related, no patch required")
        return det

    if missing:
        det.missing = missing
        det.verdict = PARTIAL if has_emu else UNPATCHED
        if has_emu:
            confidence -= 0.1
            reasons.append("conclusion: partially patched, still missing steps")
        else:
            reasons.append("conclusion: not patched")
    else:
        det.verdict = PATCHED
        confidence += 0.1
        if det.emu_match == "match":
            reasons.append("conclusion: patched with the configured emulator build")
        else:
            reasons.append("conclusion: patched")

    if facts.has_steamstub:
        confidence -= 0.3
    det.confidence = max(0.05, min(0.99, confidence))
    return det


def format_report(det: Detection, verbose: bool = False) -> str:
    facts = det.facts
    lines: list[str] = []
    lines.append(f"folder : {facts.root if facts else '?'}")
    if facts:
        lines.append(f"name   : {facts.name}")
        lines.append(f"appid  : {facts.appid if facts.appid else '(unknown)'}"
                     + (f"  [{', '.join(facts.appid_sources)}]" if facts.appid_sources else ""))
        lines.append(f"bits   : {facts.bitness or '?'}-bit primary"
                     + (f" (folder has {sorted(facts.all_bitness)})" if len(facts.all_bitness) > 1 else ""))
    lines.append(f"state  : {det.label} (confidence {det.confidence:.2f})")
    if det.patcher and det.patcher != "none":
        lines.append(f"patcher: {det.patcher}" + (f" - {det.patcher_note}" if det.patcher_note else ""))
    lines.append(f"marker : {det.marker_state}"
                 + (f" ({facts.marker_note})" if facts and facts.marker_note else ""))
    if det.emu_match != "unknown":
        lines.append(f"emu    : {det.emu_match}"
                     + (f" (differs: {', '.join(det.emu_mismatched)})" if det.emu_mismatched else ""))
    if det.missing:
        lines.append("missing steps:")
        for action in det.actions:
            lines.append(f"  - {action}")
    if verbose or det.verdict != PATCHED:
        lines.append("evidence:")
        for reason in det.reasons:
            lines.append(f"  * {reason}")
    if verbose and facts:
        lines.append("executables:")
        for cand in facts.exes[:12]:
            flag = "->" if cand.primary else "  "
            stub = " SteamStub" if cand.pe.has_steamstub() else ""
            lines.append(f"  {flag} {cand.rel} ({human_size(cand.size)}, {cand.bitness or '?'}bit){stub}")
    return "\n".join(lines)


def log_detection(det: Detection, verbose: bool = False) -> None:
    log.plain(format_report(det, verbose=verbose))
