"""End-to-end self test: build synthetic games, patch them, pack them, verify."""

from __future__ import annotations

import json
import shutil
import struct
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from . import const, interfaces
from .detect import PATCHED, UNPATCHED, detect
from .extras import is_valid_lnk, render_template
from .external import find_7z
from .pack import PackOptions, pack_folder
from .patch import PatchOptions, patch_game
from .pe import read_pe
from .probe import probe
from .select import SelectionOptions, build_selection
from .util import log, safe_rmtree

INTERFACE_STRINGS = [
    "SteamClient017",
    "SteamClient012",
    "SteamUser017",
    "SteamUtils007",
    "SteamFriends014",
    "SteamMatchMaking009",
    "STEAMAPPS_INTERFACE_VERSION006",
    "STEAMAPPTICKET_INTERFACE_VERSION002",
    "STEAMUGC_INTERFACE_VERSION002",
    "STEAMUSERSTATS_INTERFACE_VERSION011",
    "STEAMREMOTESTORAGE_INTERFACE_VERSION012",
    "STEAMSCREENSHOTS_INTERFACE_VERSION002",
    "STEAMHTTP_INTERFACE_VERSION002",
    "STEAMUNIFIEDMESSAGES_INTERFACE_VERSION001",
    "STEAMCONTROLLER_INTERFACE_VERSION",
    "STEAMUGC_INTERFACE_VERSION002",
    "STEAMAPPLIST_INTERFACE_VERSION001",
    "STEAMMUSIC_INTERFACE_VERSION001",
    "STEAMMUSICREMOTE_INTERFACE_VERSION001",
    "SteamNetworking005",
]

EMU_MARKERS = [
    b"goldberg steam emulator",
    b"steam_settings",
    b"emu_version",
]


@dataclass
class Checks:
    passed: int = 0
    failures: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def check(self, name: str, condition: bool, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            log.ok(f"{name}")
        else:
            message = f"{name}{f' -- {detail}' if detail else ''}"
            self.failures.append(message)
            log.error(message)
        return bool(condition)

    def note(self, message: str) -> None:
        self.notes.append(message)
        log.info(message)


# --------------------------------------------------------------- PE builder
def _align(value: int, alignment: int) -> int:
    return (value + alignment - 1) // alignment * alignment


def build_pe(
    path: Path,
    bits: int = 32,
    imports: dict[str, list[str]] | None = None,
    strings: list[str] | None = None,
    with_bind: bool = False,
    signed: bool = False,
    emu_markers: bool = False,
) -> Path:
    """Write a small but structurally valid PE file used by the self test."""
    imports = imports or {}
    strings = strings or []
    file_align = 0x200
    sect_align = 0x1000

    names = [".text", ".rdata"]
    if with_bind:
        names.append(".bind")
    if emu_markers:
        names.append(".data")

    # ---- .rdata payload: import table + strings
    rdata = bytearray()

    def rva_for_rdata_offset(offset: int) -> int:
        return 0x2000 + offset

    thunk_size = 8 if bits == 64 else 4
    ordinal_flag = (1 << 63) if bits == 64 else (1 << 31)

    # Reserve space for descriptors, then fill them in once offsets are known.
    descriptor_count = len(imports) + 1
    descriptor_offset = 0
    rdata += b"\x00" * (descriptor_count * 20)

    for dll, func_list in imports.items():
        entries: list[int] = []
        for func in func_list:
            entries.append(len(rdata))
            rdata += struct.pack("<H", 0) + func.encode() + b"\x00"
            if len(rdata) % 2:
                rdata += b"\x00"
        array_start = len(rdata)
        rdata += b"\x00" * thunk_size * (len(entries) + 1)  # thunk array + terminator
        for position, entry in enumerate(entries):
            struct.pack_into(
                "<Q" if bits == 64 else "<I",
                rdata,
                array_start + position * thunk_size,
                rva_for_rdata_offset(entry),
            )
        thunk_rva = rva_for_rdata_offset(array_start)

        dll_offset = len(rdata)
        rdata += dll.encode() + b"\x00"
        dll_rva = rva_for_rdata_offset(dll_offset)

        i = list(imports).index(dll)
        struct.pack_into(
            "<IIIII",
            rdata,
            descriptor_offset + i * 20,
            thunk_rva,
            0,
            0,
            dll_rva,
            thunk_rva,
        )

    for text in strings:
        rdata += text.encode() + b"\x00"
    if emu_markers:
        for marker in EMU_MARKERS:
            rdata += marker + b"\x00"

    sections: list[dict] = [
        {"name": ".text", "vsize": 0x200, "data": b"\xc3" + b"\x90" * 0x1FF},
        {"name": ".rdata", "vsize": max(0x200, len(rdata)), "data": bytes(rdata)},
    ]
    if with_bind:
        payload = b"STEAMSTUB-PAYLOAD\x00" + b"\x00" * 0x3F0
        sections.append({"name": ".bind", "vsize": len(payload), "data": payload})
    if emu_markers:
        sections.append({"name": ".data", "vsize": 0x200, "data": b"\x00" * 0x200})

    # ---- lay the file out
    header_size = _align(0x80 + 4 + 20 + (240 if bits == 64 else 224) + 40 * len(sections), file_align)
    file = bytearray(b"\x00" * header_size)
    file[0:2] = b"MZ"
    struct.pack_into("<I", file, 0x3C, 0x80)

    cursor = header_size
    for index, section in enumerate(sections):
        raw_size = _align(len(section["data"]), file_align)
        section["vaddr"] = sect_align * (index + 1)
        section["rsize"] = raw_size
        section["rptr"] = cursor
        file += section["data"] + b"\x00" * (raw_size - len(section["data"]))
        cursor += raw_size

    size_of_image = sect_align * (len(sections) + 1)

    struct.pack_into("<I", file, 0x80, 0x00004550)
    opt_size = 240 if bits == 64 else 224
    struct.pack_into(
        "<HHIIIHH",
        file,
        0x84,
        0x8664 if bits == 64 else 0x014C,
        len(sections),
        0,
        0,
        0,
        opt_size,
        0x0022 if bits == 64 else 0x0102,
    )

    opt = 0x98
    struct.pack_into("<H", file, opt, 0x20B if bits == 64 else 0x10B)
    struct.pack_into("<BB", file, opt + 2, 1, 0)
    struct.pack_into("<I", file, opt + 4, sections[0]["rsize"])
    struct.pack_into("<I", file, opt + 8, sum(s["rsize"] for s in sections[1:]))
    struct.pack_into("<I", file, opt + 16, 0x1000)  # entry point
    struct.pack_into("<I", file, opt + 20, 0x1000)  # base of code
    if bits == 64:
        struct.pack_into("<Q", file, opt + 24, 0x140000000)
        dd = opt + 112
    else:
        struct.pack_into("<I", file, opt + 24, 0x1000)  # base of data
        struct.pack_into("<I", file, opt + 28, 0x400000)
        dd = opt + 96
    struct.pack_into("<II", file, opt + 32, sect_align, file_align)
    struct.pack_into("<HHHHHH", file, opt + 40, 6, 0, 0, 0, 6, 0)
    struct.pack_into("<I", file, opt + 52, 0)
    struct.pack_into("<I", file, opt + 56, size_of_image)
    struct.pack_into("<I", file, opt + 60, header_size)
    struct.pack_into("<I", file, opt + 64, 0)
    struct.pack_into("<HH", file, opt + 68, 3, 0)  # subsystem: console
    if bits == 64:
        # PE32+ widens the stack/heap sizes to 64 bit, which shifts LoaderFlags
        # and NumberOfRvaAndSizes.
        struct.pack_into("<Q", file, opt + 72, 0x100000)
        struct.pack_into("<Q", file, opt + 80, 0x1000)
        struct.pack_into("<Q", file, opt + 88, 0x100000)
        struct.pack_into("<Q", file, opt + 96, 0x1000)
        struct.pack_into("<II", file, opt + 104, 0, 16)
    else:
        struct.pack_into("<III", file, opt + 72, 0x100000, 0x1000, 0x100000)
        struct.pack_into("<II", file, opt + 84, 0x1000, 0)
        struct.pack_into("<I", file, opt + 92, 16)

    # data directories: exports, imports, security
    struct.pack_into("<II", file, dd + 1 * 8, rva_for_rdata_offset(descriptor_offset),
                     descriptor_count * 20)

    section_table = opt + opt_size
    for index, section in enumerate(sections):
        offset = section_table + index * 40
        file[offset : offset + 8] = section["name"].encode().ljust(8, b"\x00")
        struct.pack_into(
            "<IIIIIIHHI",
            file,
            offset + 8,
            section["vsize"],
            section["vaddr"],
            section["rsize"],
            section["rptr"],
            0,
            0,
            0,
            0,
            0x60000020 if section["name"] == ".text" else 0x40000040,
        )

    if signed:
        cert = struct.pack("<IHH", 0x200, 0x0200, 0x0002) + b"\x00" * 0x1FC
        cert_offset = len(file)
        file += cert
        struct.pack_into("<II", file, dd + 4 * 8, cert_offset, len(cert))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(file))
    return path


def build_fixture(root: Path) -> dict:
    """Create the emulator source, two fake games and a text template."""
    emu = root / "emu"
    game32 = root / "Game32"
    game64 = root / "Game64"
    for folder in (emu, game32, game64):
        folder.mkdir(parents=True, exist_ok=True)

    build_pe(emu / "steam_api.dll", bits=32, emu_markers=True)
    build_pe(emu / "steam_api64.dll", bits=64, emu_markers=True)

    build_pe(
        game32 / "Game32.exe",
        bits=32,
        imports={
            "steam_api.dll": ["SteamAPI_Init", "SteamAPI_RunCallbacks", "SteamAPI_Shutdown"],
            "KERNEL32.dll": ["LoadLibraryA", "GetProcAddress", "GetModuleHandleA"],
        },
        strings=INTERFACE_STRINGS,
        with_bind=True,
    )
    build_pe(
        game32 / "steam_api.dll",
        bits=32,
        strings=INTERFACE_STRINGS,
        signed=True,
    )

    build_pe(
        game64 / "Game64.exe",
        bits=64,
        imports={
            "steam_api64.dll": ["SteamAPI_Init", "SteamAPI_RunCallbacks", "SteamAPI_Shutdown"],
            "KERNEL32.dll": ["LoadLibraryA", "GetProcAddress"],
        },
        strings=INTERFACE_STRINGS,
    )
    build_pe(game64 / "steam_api64.dll", bits=64, strings=INTERFACE_STRINGS, signed=True)

    payload = root / "payload.txt"
    payload.write_text(
        "Game   : {GAME}\n"
        "AppID  : {APPID}\n"
        "Folder : {FOLDER}\n"
        "Exe    : {EXE}\n"
        "Bitness: {BITNESS}\n"
        "Date   : {DATE}\n"
        "Site   : {SITE}\n"
        "{{literal braces}}\n",
        encoding="utf-8",
    )
    return {"root": root, "emu": emu, "game32": game32, "game64": game64, "payload": payload}


# -------------------------------------------------------------------- tests
def run_selftest(keep: bool = False, as_json: bool = False) -> int:
    checks = Checks()
    tmp = Path(tempfile.mkdtemp(prefix="gse-autopatcher-selftest-"))
    try:
        fixture = build_fixture(tmp)
        _run_checks(checks, fixture, tmp)
    finally:
        if keep:
            log.info(f"fixtures kept in {tmp}")
        else:
            safe_rmtree(tmp)

    passed = checks.passed
    failed = len(checks.failures)
    if as_json:
        print(json.dumps({"passed": passed, "failed": failed,
                          "failures": checks.failures, "notes": checks.notes}, indent=2))
    else:
        log.plain("")
        log.plain(f"self test: {passed} passed, {failed} failed")
        for failure in checks.failures:
            log.plain(f"  FAIL {failure}")
    return 0 if failed == 0 else 1


def _run_checks(checks: Checks, fixture: dict, tmp: Path) -> None:
    emu_dir = fixture["emu"]
    game32 = fixture["game32"]
    game64 = fixture["game64"]
    payload = fixture["payload"]

    # ---- PE parser ------------------------------------------------
    info = read_pe(game32 / "Game32.exe")
    checks.check("pe: 32-bit game parses", info.is_pe and info.bitness == 32, info.error)
    checks.check("pe: `.bind` section detected", info.has_steamstub(), str(info.section_names()))
    checks.check("pe: imports steam_api.dll",
                 "SteamAPI_Init" in info.imports_of("steam_api.dll"), str(list(info.imports)))
    info64 = read_pe(game64 / "Game64.exe")
    checks.check("pe: 64-bit game parses", info64.is_pe and info64.bitness == 64, info64.error)
    checks.check("pe: 64-bit game has no `.bind`", not info64.has_steamstub())
    checks.check("pe: 64-bit imports steam_api64.dll",
                 "SteamAPI_Init" in info64.imports_of("steam_api64.dll"))

    # ---- interfaces ----------------------------------------------
    names = interfaces.extract_from_file(game32 / "steam_api.dll")
    checks.check("interfaces: found from the original library", len(names) > 10, str(names[:5]))
    checks.check("interfaces: only the current SteamClient is kept",
                 [n for n in names if n.startswith("SteamClient")] == ["SteamClient017"],
                 str([n for n in names if n.startswith("SteamClient")]))
    checks.check("interfaces: dedup keeps the first occurrence",
                 names.count("STEAMUGC_INTERFACE_VERSION002") == 1)
    from_exe = interfaces.extract_from_file(game64 / "Game64.exe")
    checks.check("interfaces: can fall back to the game binary",
                 "SteamUser017" in from_exe, str(from_exe[:5]))

    # ---- template rendering --------------------------------------
    rendered = render_template("{GAME} {{ok}} {UNKNOWN}", {"GAME": "Hades"})
    checks.check("template: known token replaced, unknown kept",
                 rendered == "Hades {ok} {UNKNOWN}", rendered)

    # ---- detection on the unpatched games -------------------------
    det32 = detect(probe(game32))
    checks.check("detect: 32-bit game is unpatched", det32.verdict == UNPATCHED, det32.verdict)
    checks.check("detect: reports the missing steps",
                 {"drm_removal", "emu_dll", "steam_settings", "interfaces", "appid"} <= set(det32.missing),
                 str(det32.missing))
    det64 = detect(probe(game64))
    checks.check("detect: 64-bit game is unpatched", det64.verdict == UNPATCHED, det64.verdict)
    checks.check("detect: no SteamStub section on the clean game",
                 not probe(game64).has_steamstub, str(det64.reasons))

    # ---- patch refuses to guess when Steamless is missing ---------
    blocked = patch_game(game32, PatchOptions(emu_source=None, settings_mode="minimal"))
    checks.check("patch: refuses to skip a SteamStub without Steamless",
                 any("Steamless" in e for e in blocked.errors), str(blocked.errors))

    # ---- happy path on the 64-bit (already DRM free) game ---------
    result = patch_game(
        game64,
        PatchOptions(
            appid=1145360,
            app_name="Game64",
            emu_source=_emu_source(emu_dir),
            settings_mode="minimal",
            txt_file=payload,
            lnk_name="Game64.lnk",
            template_vars={"SITE": "example.invalid"},
            backup=False,
            yes=True,
        ),
    )
    checks.check("patch: 64-bit game patches cleanly", result.ok, str(result.errors))
    checks.check("patch: emulator library installed",
                 (game64 / "steam_api64.dll").is_file() and "emu_dll" in result.performed,
                 str(result.performed))
    checks.check("patch: 32-bit library not installed",
                 not (game64 / "steam_api.dll").is_file())
    checks.check("patch: steam_settings created",
                 (game64 / const.STEAM_SETTINGS_DIR / "steam_interfaces.txt").is_file())
    appid_file = game64 / const.STEAM_SETTINGS_DIR / "steam_appid.txt"
    checks.check("patch: app id written",
                 appid_file.is_file() and appid_file.read_text().strip() == "1145360")
    marker = game64 / const.MARKER_FILENAME
    checks.check("patch: marker written", marker.is_file())
    if marker.is_file():
        from .util import read_json

        payload_json = read_json(marker) or {}
        checks.check("patch: marker records the app id", payload_json.get("appid") == 1145360)
        checks.check("patch: marker records file hashes",
                     any(str(v).startswith("sha256:") for v in (payload_json.get("files") or {}).values()))

    # ---- extras ----------------------------------------------------
    added_txt = game64 / "payload.txt"
    checks.check("extras: text file added", added_txt.is_file())
    if added_txt.is_file():
        body = added_txt.read_text(encoding="utf-8")
        checks.check("extras: tokens substituted",
                     "AppID  : 1145360" in body and "{GAME}" not in body, body)
        checks.check("extras: custom token substituted", "Site   : example.invalid" in body)
        checks.check("extras: literal braces preserved", "{literal braces}" in body)
    lnk = game64 / "Game64.lnk"
    if sys.platform == "win32":
        checks.check("extras: shortcut created", lnk.is_file())
        checks.check("extras: shortcut is a valid shell link",
                     lnk.is_file() and is_valid_lnk(lnk))
    else:
        checks.note("shortcut test skipped: not on Windows")

    # ---- re-detection is idempotent --------------------------------
    det_after = detect(probe(game64), emu_source=_emu_source(emu_dir))
    checks.check("detect: patched game is recognised",
                 det_after.verdict == PATCHED, f"{det_after.verdict} {det_after.reasons}")
    checks.check("detect: nothing missing after patching", not det_after.missing, str(det_after.missing))
    checks.check("detect: marker is trusted", det_after.marker_state == "verified",
                 det_after.marker_state)
    checks.check("detect: patcher identified as this tool",
                 det_after.patcher == const.PATCHER_SELF, det_after.patcher)
    checks.check("detect: deployed library matches the configured emu build",
                 det_after.emu_match == "match", det_after.emu_match)

    # a different emu build in the folder must not pass as "already patched"
    swapped = tmp / "Game64Swapped"
    shutil.copytree(game64, swapped)
    (swapped / "steam_api64.dll").write_bytes(
        (emu_dir / "steam_api64.dll").read_bytes() + b"\x00tampered"
    )
    det_swapped = detect(probe(swapped), emu_source=_emu_source(emu_dir))
    checks.check("detect: a different emu build is reported as a mismatch",
                 det_swapped.emu_match == "mismatch", det_swapped.emu_match)
    checks.check("detect: mismatch turns a patched folder into work to do",
                 "emu_dll" in det_swapped.missing, str(det_swapped.missing))

    # a hand made gbe_fork layout must be recognised as somebody else's patch
    foreign = tmp / "ForeignPatch"
    shutil.copytree(game64, foreign)
    (foreign / const.MARKER_FILENAME).unlink()
    (foreign / const.STEAM_SETTINGS_DIR / "configs.user.ini").write_text(
        "[user]\naccount_name=someone\n", encoding="utf-8"
    )
    det_foreign = detect(probe(foreign), emu_source=_emu_source(emu_dir))
    checks.check("detect: a foreign gbe_fork patch is identified",
                 det_foreign.patcher == const.PATCHER_GBE_FORK, det_foreign.patcher)
    checks.check("detect: a verified emu build still counts as patched",
                 det_foreign.verdict == PATCHED, det_foreign.verdict)

    # a changed file must invalidate the marker
    tampered = tmp / "Tampered"
    shutil.copytree(game64, tampered)
    (tampered / "payload.txt").write_text("edited after patching", encoding="utf-8")
    det_tampered = detect(probe(tampered))
    checks.check("detect: editing a patched file invalidates the marker",
                 det_tampered.marker_state == "modified", det_tampered.marker_state)

    # ---- archive contents selection --------------------------------
    (game64 / "logs").mkdir(exist_ok=True)
    (game64 / "logs" / "session.log").write_text("noise", encoding="utf-8")
    (game64 / "readme.md").write_text("docs", encoding="utf-8")
    (game64 / "Hades.autopatch-backup").mkdir(exist_ok=True)
    (game64 / "Hades.autopatch-backup" / "Game64.exe").write_bytes(b"old")

    everything = build_selection(game64)
    checks.check("select: full takes every file",
                 "logs/session.log" in everything.files
                 and "payload.txt" in everything.files
                 and "steam_settings/steam_interfaces.txt" in everything.files,
                 str(everything.files))
    checks.check("select: tool leftovers are skipped by default",
                 "Hades.autopatch-backup/Game64.exe" not in everything.files
                 and "Hades.autopatch-backup" in everything.skipped_junk,
                 str(everything.skipped_junk))

    crack = build_selection(game64, SelectionOptions(preset="crack-only"))
    checks.check("select: crack-only keeps the emulator payload",
                 "steam_api64.dll" in crack.files
                 and "steam_settings/steam_interfaces.txt" in crack.files,
                 str(crack.files))
    checks.check("select: crack-only drops the game",
                 "Game64.exe" not in crack.files and "payload.txt" not in crack.files,
                 str(crack.files))
    checks.check("select: crack-only leaves the patch marker behind",
                 const.MARKER_FILENAME not in crack.files, str(crack.files))

    only_game = build_selection(game64, SelectionOptions(preset="game-only"))
    checks.check("select: game-only drops the payload",
                 "steam_api64.dll" not in only_game.files
                 and const.MARKER_FILENAME not in only_game.files
                 and "Game64.exe" in only_game.files, str(only_game.files))

    only_data = build_selection(game64, SelectionOptions(include=["logs/*"]))
    checks.check("select: --include narrows to the match",
                 only_data.files == ["logs/session.log"], str(only_data.files))

    no_logs = build_selection(game64, SelectionOptions(exclude_dirs=["logs"]))
    checks.check("select: --exclude-dir drops a folder and its contents",
                 not any(f.startswith("logs/") for f in no_logs.files)
                 and "Game64.exe" in no_logs.files, str(no_logs.files))

    no_pdb = build_selection(game64, SelectionOptions(exclude=["*.md"]))
    checks.check("select: --exclude matches by name anywhere",
                 "readme.md" not in no_pdb.files, str(no_pdb.files))

    list_path = tmp / "selection.txt"
    list_path.write_text(
        "# only what matters\nGame64.exe\nsteam_settings/*\n-lnk\n/logs\n", encoding="utf-8"
    )
    from_list = build_selection(game64, SelectionOptions(list_file=list_path))
    checks.check("select: --list honours includes, excludes and folder excludes",
                 set(from_list.files) == {"Game64.exe", "steam_settings/steam_interfaces.txt",
                                          "steam_settings/steam_appid.txt"},
                 str(from_list.files))

    empty = build_selection(game64, SelectionOptions(include=["does-not-exist*"]))
    checks.check("select: an impossible selection is empty, not everything",
                 empty.count == 0, str(empty.files))

    again = patch_game(game64, PatchOptions(emu_source=_emu_source(emu_dir), settings_mode="minimal"))
    checks.check("patch: second run is a no-op",
                 not again.changed and any("already patched" in s for s in again.skipped),
                 str(again.skipped))

    # ---- 32-bit game: strip the stub, then patch -------------------
    clean32 = tmp / "Game32Clean"
    shutil.copytree(game32, clean32)
    _strip_bind(clean32 / "Game32.exe", tmp / "Game32Clean.exe")
    shutil.move(str(tmp / "Game32Clean.exe"), str(clean32 / "Game32.exe"))
    result32 = patch_game(
        clean32,
        PatchOptions(
            appid=480,
            emu_source=_emu_source(emu_dir),
            settings_mode="minimal",
            txt_file=payload,
            lnk_name="Game32.lnk",
            backup=False,
            yes=True,
        ),
    )
    checks.check("patch: 32-bit game patches cleanly", result32.ok, str(result32.errors))
    checks.check("patch: 32-bit library installed",
                 (clean32 / "steam_api.dll").is_file() and not (clean32 / "steam_api64.dll").is_file())
    checks.check("patch: interfaces written for the 32-bit game",
                 (clean32 / const.STEAM_SETTINGS_DIR / "steam_interfaces.txt").is_file())

    # ---- compression -----------------------------------------------
    sevenzip = find_7z()
    if not sevenzip:
        checks.note("7-Zip not found: compression checks skipped")
        return

    guard = pack_folder(game64, PackOptions(output=game64 / "inside.7z", dry_run=False))
    checks.check("pack: refuses to write the archive inside the source",
                 any("inside the source" in e for e in guard.errors), str(guard.errors))

    archive = tmp / "Game64.7z"
    packed = pack_folder(game64, PackOptions(sevenzip=sevenzip, output=archive, profile="fast"))
    checks.check("pack: archive created", packed.ok and archive.is_file(), str(packed.errors))
    checks.check("pack: archive verified", packed.verified)
    checks.check("pack: archive smaller than the source", packed.ratio < 1.0, f"{packed.ratio}")

    listing = _list_archive(sevenzip, archive)
    checks.check("pack: text file is inside the archive", "payload.txt" in listing)
    checks.check("pack: shortcut is inside the archive", "Game64.lnk" in listing)
    checks.check("pack: steam_settings is inside the archive",
                 any("steam_settings/steam_interfaces.txt" in name.replace("\\", "/") for name in listing))
    checks.check("pack: the tool's backup folder stays out of the archive",
                 not any("autopatch-backup" in name for name in listing), str(listing))

    # ---- compression honours the selection -------------------------
    crack_archive = tmp / "Game64-crack.7z"
    crack_packed = pack_folder(
        game64,
        PackOptions(sevenzip=sevenzip, output=crack_archive, profile="fast",
                    selection=SelectionOptions(preset="crack-only")),
    )
    crack_listing = _list_archive(sevenzip, crack_archive)
    checks.check("pack: crack-only archive holds the payload",
                 crack_packed.ok
                 and "steam_api64.dll" in crack_listing
                 and any("steam_settings" in n for n in crack_listing),
                 str(crack_listing))
    checks.check("pack: crack-only archive leaves the game out",
                 "Game64.exe" not in crack_listing and "payload.txt" not in crack_listing,
                 str(crack_listing))
    checks.check("pack: crack-only archive carries no patch marker",
                 const.MARKER_FILENAME not in crack_listing, str(crack_listing))

    picked_archive = tmp / "Game64-picked.7z"
    picked = pack_folder(
        game64,
        PackOptions(sevenzip=sevenzip, output=picked_archive, profile="fast",
                    selection=SelectionOptions(exclude_dirs=["logs"]), list_out=tmp / "picked.txt"),
    )
    picked_listing = _list_archive(sevenzip, picked_archive)
    checks.check("pack: --exclude-dir keeps the excluded folder out",
                 picked.ok and not any("session.log" in n for n in picked_listing)
                 and "Game64.exe" in picked_listing, str(picked_listing))
    checks.check("pack: --list-out saves the selection for reuse",
                 (tmp / "picked.txt").is_file()
                 and "Game64.exe" in (tmp / "picked.txt").read_text(encoding="utf-8"))

    reuse = pack_folder(
        game64,
        PackOptions(sevenzip=sevenzip, output=tmp / "Game64-reuse.7z", profile="fast",
                    selection=SelectionOptions(list_file=tmp / "picked.txt")),
    )
    checks.check("pack: a saved selection can be replayed with --list",
                 reuse.ok and "Game64.exe" in _list_archive(sevenzip, tmp / "Game64-reuse.7z"))

    dry = pack_folder(
        game64,
        PackOptions(sevenzip=sevenzip, output=tmp / "Game64-dry.7z", profile="fast",
                    selection=SelectionOptions(include=["nope*"]), dry_run=True),
    )
    checks.check("pack: an empty selection is refused",
                 any("selection is empty" in e for e in dry.errors)
                 and not (tmp / "Game64-dry.7z").exists(), str(dry.errors))

    dropped = pack_folder(
        game64,
        PackOptions(sevenzip=sevenzip, output=tmp / "Game64b.7z", profile="fast",
                    delete_original=True, yes=True),
    )
    checks.check("pack: source deleted after verification",
                 dropped.deleted and not game64.exists(), str(dropped.errors))
    checks.check("pack: no staging folder left behind",
                 not list(tmp.glob("Game64.deleting-*")))
    checks.check("pack: archive survives the deletion", (tmp / "Game64b.7z").is_file())


def _emu_source(emu_dir: Path):
    from .external import find_emu_source

    source = find_emu_source(emu_dir)
    assert source is not None, f"could not read the emulator fixture at {emu_dir}"
    return source


def _strip_bind(src: Path, out: Path) -> None:
    """Rewrite a PE without its `.bind` section, like Steamless would."""
    data = bytearray(src.read_bytes())
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    opt_size = struct.unpack_from("<H", data, e_lfanew + 20)[0]
    table = e_lfanew + 24 + opt_size
    count = struct.unpack_from("<H", data, e_lfanew + 6)[0]
    for index in range(count):
        offset = table + index * 40
        if bytes(data[offset : offset + 6]).rstrip(b"\x00") == b".bind":
            data[offset : offset + 8] = b".stub\x00\x00\x00"
    out.write_bytes(bytes(data))


def _list_archive(sevenzip: Path, archive: Path) -> list[str]:
    import subprocess

    try:
        proc = subprocess.run(
            [str(sevenzip), "l", "-slt", str(archive), "-bso0", "-y"],
            capture_output=True, text=True, check=False, timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return [
        line.split(" = ", 1)[1]
        for line in proc.stdout.splitlines()
        if line.startswith("Path = ")
    ]


if __name__ == "__main__":
    raise SystemExit(run_selftest(keep="--keep" in sys.argv))
