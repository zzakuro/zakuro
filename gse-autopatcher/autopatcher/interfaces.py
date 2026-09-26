"""Generate `steam_settings/steam_interfaces.txt`.

Pure-python port of gbe_fork's `tools/generate_interfaces` (same patterns, same
output format, same `SteamClient` special case) so the patcher does not need the
compiled helper. The file lists the interface strings the game asks for; the
emulator uses it to build a matching interface table.
"""

from __future__ import annotations

import re
from pathlib import Path

# Kept in the exact order of the upstream tool so output is stable.
INTERFACE_PATTERNS: tuple[str, ...] = (
    r"STEAMAPPS_INTERFACE_VERSION\d+",
    r"SteamApps\d+",
    r"STEAMAPPLIST_INTERFACE_VERSION\d+",
    r"STEAMAPPTICKET_INTERFACE_VERSION\d+",
    r"SteamClient\d+",
    r"STEAMCONTROLLER_INTERFACE_VERSION",
    r"SteamController\d+",
    r"SteamFriends\d+",
    r"SteamGameServerStats\d+",
    r"SteamGameCoordinator\d+",
    r"SteamGameServer\d+",
    r"STEAMHTMLSURFACE_INTERFACE_VERSION_\d+",
    r"STEAMHTTP_INTERFACE_VERSION\d+",
    r"SteamInput\d+",
    r"STEAMINVENTORY_INTERFACE_V\d+",
    r"SteamMatchMakingServers\d+",
    r"SteamMatchMaking\d+",
    r"SteamMatchGameSearch\d+",
    r"SteamParties\d+",
    r"STEAMMUSIC_INTERFACE_VERSION\d+",
    r"STEAMMUSICREMOTE_INTERFACE_VERSION\d+",
    r"SteamNetworkingMessages\d+",
    r"SteamNetworkingSockets\d+",
    r"SteamNetworkingUtils\d+",
    r"SteamNetworking\d+",
    r"STEAMPARENTALSETTINGS_INTERFACE_VERSION\d+",
    r"STEAMREMOTEPLAY_INTERFACE_VERSION\d+",
    r"STEAMREMOTESTORAGE_INTERFACE_VERSION\d+",
    r"STEAMSCREENSHOTS_INTERFACE_VERSION\d+",
    r"STEAMTIMELINE_INTERFACE_V\d+",
    r"STEAMUGC_INTERFACE_VERSION\d+",
    r"SteamUser\d+",
    r"STEAMUSERSTATS_INTERFACE_VERSION\d+",
    r"SteamUtils\d+",
    r"STEAMVIDEO_INTERFACE_V\d+",
    r"STEAMUNIFIEDMESSAGES_INTERFACE_VERSION\d+",
    r"SteamMasterServerUpdater\d+",
)

_COMBINED = re.compile("|".join(f"(?:{p})".encode() for p in INTERFACE_PATTERNS))
_BY_NAME = {p.encode().decode(): re.compile(p.encode()) for p in INTERFACE_PATTERNS}


def extract_from_bytes(data: bytes) -> list[str]:
    """Return interface names, ordered by pattern then by first appearance."""
    found: dict[str, list[str]] = {}
    for match in _COMBINED.finditer(data):
        token = match.group(0).decode("ascii", "replace")
        for pattern, regex in _BY_NAME.items():
            if regex.fullmatch(token):
                found.setdefault(pattern, []).append(token)
                break

    # Newer SDKs keep only SteamClient017 among the legacy exports.
    clients = found.get(r"SteamClient\d+")
    if clients and len(clients) > 1 and "SteamClient017" in clients:
        found[r"SteamClient\d+"] = ["SteamClient017"]

    ordered: list[str] = []
    for pattern in INTERFACE_PATTERNS:
        for token in found.get(pattern, []):
            if token not in ordered:
                ordered.append(token)
    return ordered


def extract_from_file(path: str | Path) -> list[str]:
    return extract_from_bytes(Path(path).read_bytes())


def write_steam_interfaces(dest: str | Path, names: list[str]) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(names) + "\n", encoding="utf-8")
    return dest


def best_source(candidates: list[Path]) -> tuple[Path | None, list[str]]:
    """Pick the richest interface source available.

    Order of preference: the original Valve library (what the game really asks
    for), then the emulator library, then the game executable itself.
    """
    for path in candidates:
        if path and Path(path).is_file():
            names = extract_from_file(path)
            if names:
                return Path(path), names
    return None, []
