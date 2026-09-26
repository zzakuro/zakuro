"""Minimal, dependency-free PE (Portable Executable) reader.

Only what the patcher needs: bitness, section table, import tables,
Authenticode presence, overlay detection and the `.bind` section that
SteamStub-based Steam DRM (variants 1.0 - 3.1) always carries.

Everything is read with seeks so multi-hundred-megabyte game binaries are
never fully loaded into memory.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

IMAGE_DOS_SIGNATURE = 0x5A4D  # 'MZ'
IMAGE_NT_SIGNATURE = 0x00004550  # 'PE\0\0'

MACHINE_I386 = 0x014C
MACHINE_AMD64 = 0x8664
MACHINE_ARM64 = 0xAA64
MACHINE_ARMNT = 0x01C4

MACHINE_NAMES = {
    MACHINE_I386: "x86",
    MACHINE_AMD64: "x64",
    MACHINE_ARM64: "arm64",
    MACHINE_ARMNT: "arm",
}

OPTIONAL_MAGIC_PE32 = 0x10B
OPTIONAL_MAGIC_PE32PLUS = 0x20B

# Data directory indices we care about.
DD_EXPORT = 0
DD_IMPORT = 1
DD_SECURITY = 4
DD_DELAY_IMPORT = 13

_ORDINAL_FLAG_32 = 0x80000000
_ORDINAL_FLAG_64 = 0x8000000000000000

# Section name used by every SteamStub variant. Steamless refuses to touch
# binaries without it, so it is our primary "DRM still packed" signal.
STEAMSTUB_SECTION = ".bind"


class PEError(Exception):
    """Raised when a file is not a parseable PE image."""


@dataclass(frozen=True)
class Section:
    name: str
    virtual_size: int
    virtual_address: int
    raw_size: int
    raw_pointer: int
    characteristics: int

    @property
    def end_of_raw_data(self) -> int:
        return self.raw_pointer + self.raw_size


@dataclass
class PEInfo:
    path: Path
    is_pe: bool = False
    is_64bit: bool = False
    machine: int = 0
    bitness: int = 0
    entry_point: int = 0
    image_base: int = 0
    timestamp: int = 0
    characteristics: int = 0
    sections: list[Section] = field(default_factory=list)
    imports: dict[str, list[str]] = field(default_factory=dict)
    delay_imports: dict[str, list[str]] = field(default_factory=dict)
    has_signature: bool = False
    overlay_offset: int = 0
    overlay_size: int = 0
    file_size: int = 0
    error: str = ""

    @property
    def arch(self) -> str:
        return MACHINE_NAMES.get(self.machine, f"unknown(0x{self.machine:04x})")

    def section_names(self) -> list[str]:
        return [s.name for s in self.sections]

    def has_section(self, name: str) -> bool:
        wanted = name.lower()
        return any(s.name.lower() == wanted for s in self.sections)

    def imports_of(self, dll_name: str) -> list[str]:
        wanted = dll_name.lower()
        for table in (self.imports, self.delay_imports):
            for dll, funcs in table.items():
                if dll.lower() == wanted:
                    return funcs
        return []

    def imports_any(self, dll_names: Iterable[str]) -> list[str]:
        found: list[str] = []
        for name in dll_names:
            found.extend(self.imports_of(name))
        return found

    def has_steamstub(self) -> bool:
        """True when the `.bind` section (SteamStub) is still in the image."""
        return self.has_section(STEAMSTUB_SECTION)

    def looks_dotnet(self) -> bool:
        return bool(self.imports_of("mscoree.dll")) or bool(
            self.delay_imports.get("mscoree.dll")
        )


class PEFile:
    """Read-only PE view over a file on disk."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._fh = None
        self._size = 0

    def __enter__(self) -> PEFile:
        self._fh = self.path.open("rb")
        self._size = self.path.stat().st_size
        return self

    def __exit__(self, *exc) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None

    def _read(self, offset: int, size: int) -> bytes:
        if self._fh is None:
            raise PEError("PEFile used outside of a context manager")
        if offset < 0 or size <= 0:
            return b""
        self._fh.seek(offset)
        return self._fh.read(size)

    def _unpack(self, fmt: str, offset: int):
        raw = self._read(offset, struct.calcsize(fmt))
        if len(raw) < struct.calcsize(fmt):
            raise PEError("unexpected end of file while reading PE headers")
        return struct.unpack(fmt, raw)

    # -- public API ----------------------------------------------------
    def parse(self) -> PEInfo:
        info = PEInfo(path=self.path, file_size=self._size)
        if self._size < 0x40:
            info.error = "file too small to be a PE image"
            return info

        (mz,) = self._unpack("<H", 0)
        if mz != IMAGE_DOS_SIGNATURE:
            info.error = "missing MZ signature (not a PE file)"
            return info

        (lfanew,) = self._unpack("<I", 0x3C)
        if not 0 < lfanew < self._size - 4:
            info.error = "invalid e_lfanew"
            return info

        (signature,) = self._unpack("<I", lfanew)
        if signature != IMAGE_NT_SIGNATURE:
            info.error = "missing PE signature"
            return info

        fh_off = lfanew + 4
        machine, num_sections, timestamp, _sym_ptr, _num_sym, size_opt, chars = (
            self._unpack("<HHIIIHH", fh_off)
        )
        opt_off = fh_off + 20

        magic, = self._unpack("<H", opt_off)
        if magic == OPTIONAL_MAGIC_PE32:
            is_64 = False
            image_base, = self._unpack("<I", opt_off + 28)
            dd_off, num_rva_off = opt_off + 96, opt_off + 92
        elif magic == OPTIONAL_MAGIC_PE32PLUS:
            is_64 = True
            image_base, = self._unpack("<Q", opt_off + 24)
            dd_off, num_rva_off = opt_off + 112, opt_off + 108
        else:
            info.error = f"unknown optional header magic 0x{magic:04x}"
            return info

        entry_point, = self._unpack("<I", opt_off + 16)

        num_dirs, = self._unpack("<I", num_rva_off)

        def directory(index: int) -> tuple[int, int]:
            if index >= num_dirs:
                return 0, 0
            return self._unpack("<II", dd_off + index * 8)

        sec_off = opt_off + size_opt
        sections: list[Section] = []
        for i in range(num_sections):
            raw = self._read(sec_off + i * 40, 40)
            if len(raw) < 40:
                break
            name_raw = raw[:8].split(b"\x00", 1)[0]
            name = name_raw.decode("ascii", "replace")
            vsize, vaddr, raw_size, raw_ptr = struct.unpack_from("<IIII", raw, 8)
            characteristics, = struct.unpack_from("<I", raw, 36)
            sections.append(
                Section(name, vsize, vaddr, raw_size, raw_ptr, characteristics)
            )

        info.is_pe = True
        info.is_64bit = is_64
        info.bitness = 64 if is_64 else 32
        info.machine = machine
        info.timestamp = timestamp
        info.characteristics = chars
        info.entry_point = entry_point
        info.image_base = image_base
        info.sections = sections

        # The import readers need the image base and section table to translate
        # RVAs into file offsets.
        self.image_base = image_base
        self.parse_sections_cache = sections

        sec_rva, sec_size = directory(DD_SECURITY)
        info.has_signature = sec_size > 0 and sec_rva > 0

        info.imports = self._read_imports(directory(DD_IMPORT), is_64)
        info.delay_imports = self._read_delay_imports(
            directory(DD_DELAY_IMPORT), is_64
        )

        overlay_start = 0
        for s in sections:
            if s.raw_size:
                overlay_start = max(overlay_start, s.end_of_raw_data)
        # Section data can be smaller than the declared headers; fall back to
        # the first raw pointer so truncated files still get a sane answer.
        if not overlay_start:
            overlay_start = min(
                (s.raw_pointer for s in sections if s.raw_size), default=0
            )
        if info.has_signature and sec_rva + sec_size > overlay_start:
            overlay_start = sec_rva + sec_size
        info.overlay_offset = overlay_start
        info.overlay_size = max(0, self._size - overlay_start)

        return info

    # -- internals -----------------------------------------------------
    def _rva_to_offset(self, rva: int, info_sections: list[Section] | None = None) -> int:
        for s in info_sections or []:
            span = max(s.virtual_size, s.raw_size)
            if s.virtual_address <= rva < s.virtual_address + span:
                return s.raw_pointer + (rva - s.virtual_address)
        return 0

    def _read_cstring(self, offset: int, limit: int = 512) -> str:
        raw = self._read(offset, limit)
        raw = raw.split(b"\x00", 1)[0]
        return raw.decode("ascii", "replace")

    def _read_thunks(
        self, table_rva: int, is_64: bool, sections: list[Section], limit: int = 4096
    ) -> list[str]:
        if not table_rva:
            return []
        fmt = "<Q" if is_64 else "<I"
        ordinal_flag = _ORDINAL_FLAG_64 if is_64 else _ORDINAL_FLAG_32
        width = 8 if is_64 else 4
        names: list[str] = []
        offset = self._rva_to_offset(table_rva, sections)
        for i in range(limit):
            (value,) = self._unpack(fmt, offset + i * width)
            if value == 0:
                break
            if value & ordinal_flag:
                names.append(f"#{value & 0xFFFF}")
                continue
            hint_off = self._rva_to_offset(value & 0x7FFFFFFF, sections)
            if not hint_off:
                continue
            names.append(self._read_cstring(hint_off + 2))
        return names

    def _read_imports(
        self, directory: tuple[int, int], is_64: bool
    ) -> dict[str, list[str]]:
        table_rva, table_size = directory
        if not table_rva:
            return {}
        sections = [s for s in self.parse_sections_cache]
        table_off = self._rva_to_offset(table_rva, sections)
        if not table_off:
            return {}
        result: dict[str, list[str]] = {}
        max_entries = max(1, table_size // 20 if table_size else 256)
        for i in range(max_entries):
            desc_off = table_off + i * 20
            int_rva, _ts, _fwd, name_rva, first_thunk = self._unpack("<IIIII", desc_off)
            if not any((int_rva, name_rva, first_thunk)):
                break
            name_off = self._rva_to_offset(name_rva, sections)
            if not name_off:
                continue
            dll = self._read_cstring(name_off)
            funcs = self._read_thunks(int_rva, is_64, sections)
            if not funcs and first_thunk != int_rva:
                # A bound or clobbered INT is not unheard of; the IAT still has
                # the names until the loader resolves them.
                funcs = self._read_thunks(first_thunk, is_64, sections)
            result[dll] = funcs
        return result

    def _read_delay_imports(
        self, directory: tuple[int, int], is_64: bool
    ) -> dict[str, list[str]]:
        table_rva, table_size = directory
        if not table_rva:
            return {}
        sections = [s for s in self.parse_sections_cache]
        table_off = self._rva_to_offset(table_rva, sections)
        if not table_off:
            return {}
        result: dict[str, list[str]] = {}
        max_entries = max(1, table_size // 32 if table_size else 256)
        for i in range(max_entries):
            off = table_off + i * 32
            attrs, name_rva, _mod, _iat, int_rva = self._unpack("<IIIII", off)
            if not name_rva:
                break
            if attrs & 1:  # RVA-based (new-style) descriptor
                name_off = self._rva_to_offset(name_rva, sections)
                thunk_rva = int_rva
            else:  # VA-based (old-style) descriptor
                name_off = name_rva - self.image_base
                thunk_rva = int_rva - self.image_base if int_rva else 0
            if not name_off:
                continue
            result[self._read_cstring(name_off)] = self._read_thunks(
                thunk_rva, is_64, sections
            )
        return result

    image_base = 0
    parse_sections_cache: list[Section] = []


def read_pe(path: str | Path) -> PEInfo:
    """Parse `path` and return a :class:`PEInfo` (never raises for bad input)."""
    path = Path(path)
    if not path.is_file():
        return PEInfo(path=path, error="not a file")
    try:
        with PEFile(path) as pe:
            return pe.parse()
    except PEError as exc:
        return PEInfo(path=path, error=str(exc))
    except OSError as exc:
        return PEInfo(path=path, error=f"OS error: {exc}")
