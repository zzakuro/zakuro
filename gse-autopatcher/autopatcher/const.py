"""Shared constants: filenames the ecosystem uses to mark a patched game."""

from __future__ import annotations

MARKER_FILENAME = ".gse_autopatch.json"
MARKER_VERSION = 1
TOOL_NAME = "gse-autopatcher"
TOOL_VERSION = "1.0.0"

STEAM_SETTINGS_DIR = "steam_settings"

# Emulator libraries, grouped by the bitness they serve.
EMU_DLLS_32 = ("steam_api.dll", "steamclient.dll", "libsteam_api.so")
EMU_DLLS_64 = ("steam_api64.dll", "steamclient64.dll", "libsteam_api.so")
EMU_DLL_NAMES = tuple(dict.fromkeys(EMU_DLLS_32 + EMU_DLLS_64))

# Files that only ever exist inside a Goldberg-emulator deployment.
EMU_SETTINGS_FILES = (
    "steam_interfaces.txt",
    "emu_version.txt",
    "configs.app.ini",
    "configs.user.ini",
    "configs.main.ini",
    "configs.overlay.ini",
    "config.vdf",
    "config.user.vdf",
    "appinfo.vdf",
    "appcache/appinfo.vdf",
    "achievements.json",
    "items.json",
    "controller/MenuControls.txt",
    "controller/InGameControls.txt",
    "interface",
)

# Classic (pre-fork) emulator layout, still used by plenty of releases.
LEGACY_EMU_MARKERS = ("steam_emu.ini", "settings/config.user.vdf", "localconfig.vdf")

# Root file Steam itself uses to bind a running process to an app id.
APPID_FILENAMES = ("steam_appid.txt",)

# Archive + installer noise that should never be mistaken for the game binary.
EXE_IGNORE_TOKENS = (
    "unins",
    "uninstall",
    "setup",
    "install",
    "redist",
    "vcredist",
    "dxsetup",
    "dxwebsetup",
    "dotnet",
    "openal",
    "dotnetfx",
    "7z",
    "winzip",
    "patch",
    "update",
    "crack",
    "unarc",
    "rar",
    "extract",
    "readme",
    "config",
    "launcher_helper",
    "steamworks",
    "steamstub",
)

# Substrings that identify an emulator build inside a DLL/EXE payload.
EMU_STRING_MARKERS = (
    (b"goldberg", 3),
    (b"steam_settings", 2),
    (b"gse fork", 3),
    (b"emu_version", 2),
    (b"bymarian", 1),
)

# ---------------------------------------------------------------------------
# Patch fingerprints: which emulator deployment a folder carries.
# ---------------------------------------------------------------------------
PATCHER_SELF = "gse-autopatcher"
PATCHER_GBE_FORK = "gbe-fork"
PATCHER_GOLDBERG_CLASSIC = "goldberg-classic"
PATCHER_RUNE = "rune"
PATCHER_STEAMLESS_ONLY = "drm-removed-only"
PATCHER_UNKNOWN_EMU = "unknown-emulator"

# Files that only the gbe_fork layout produces.
GBE_FORK_MARKERS = (
    "steam_interfaces.txt",
    "emu_version.txt",
    "configs.app.ini",
    "configs.user.ini",
    "configs.main.ini",
    "configs.overlay.ini",
    "appinfo.vdf",
    "appcache/appinfo.vdf",
    "controller",
)

# Files that only the pre-fork Goldberg layout produces.
GOLDBERG_CLASSIC_MARKERS = (
    "config.vdf",
    "config.user.vdf",
    "localconfig.vdf",
    "settings/config.user.vdf",
    "settings/localconfig.vdf",
    "steam_emu.ini",
)

# ---------------------------------------------------------------------------
# Archive selection
# ---------------------------------------------------------------------------
SELECT_PRESETS = ("full", "crack-only", "game-only")

# Never archived unless --include-junk is passed: the tool's own leftovers and
# Windows noise that would only bloat the archive.
JUNK_DIR_PATTERNS = (
    "*.autopatch-backup",
    "*.deleting-*",
    "_autopatcher",
    "$recycle.bin",
    "system volume information",
)

# Top level names that make up the emulator payload, used by the presets.
PAYLOAD_DIRS = (STEAM_SETTINGS_DIR,)
PAYLOAD_FILES = EMU_DLL_NAMES + (
    "steam_emu.ini",
    "localconfig.vdf",
    "config.vdf",
    "settings.txt",
    ".gse_autopatch.json",
)
