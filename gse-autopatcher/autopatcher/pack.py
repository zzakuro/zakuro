"""Compress the patched game with 7-Zip, verify it, then drop the source."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from .external import default_threads, find_7z, seven_zip_version
from .select import Selection, SelectionOptions, build_selection, summary, write_list_file
from .util import confirm, dir_size, human_size, log, safe_rmtree

PROFILES: dict[str, dict] = {
    # name: 7-Zip switches. dict_size/solid_block stay unset so 7-Zip picks.
    "store": {"switches": ["-mx=0"]},
    "fast": {"switches": ["-mx=1", "-m0=LZMA2:d=64m"]},
    "normal": {"switches": ["-mx=6", "-m0=LZMA2:d=128m"]},
    "high": {"switches": ["-mx=7", "-m0=LZMA2:d=256m"]},
    "max": {"switches": ["-mx=9", "-m0=LZMA2:d=384m"]},
}

@dataclass
class PackOptions:
    sevenzip: Path | None = None
    output: Path | None = None
    profile: str = "normal"
    level: int | None = None
    dict_size: str | None = None
    solid_block: str | None = None
    threads: int | None = None
    mem_percent: int | None = None
    exclude: list[str] = field(default_factory=list)
    password: str | None = None
    header_encrypt: bool = False
    test_archive: bool = True
    delete_original: bool = False
    yes: bool = False
    dry_run: bool = False
    timeout: int = 0  # 0 = no timeout
    selection: SelectionOptions = field(default_factory=SelectionOptions)
    list_out: Path | None = None
    show_selection: bool = False


@dataclass
class PackResult:
    root: Path
    archive: Path | None = None
    source_size: int = 0
    archive_size: int = 0
    verified: bool = False
    deleted: bool = False
    seconds: float = 0.0
    errors: list[str] = field(default_factory=list)
    sevenzip: Path | None = None
    selection: Selection | None = None

    @property
    def ratio(self) -> float:
        if not self.archive_size or not self.source_size:
            return 0.0
        return self.archive_size / self.source_size

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "root": str(self.root),
            "archive": str(self.archive) if self.archive else None,
            "source_size": self.source_size,
            "archive_size": self.archive_size,
            "ratio": round(self.ratio, 4),
            "verified": self.verified,
            "deleted": self.deleted,
            "seconds": round(self.seconds, 1),
            "sevenzip": str(self.sevenzip) if self.sevenzip else None,
            "selection": self.selection.to_dict() if self.selection else None,
            "errors": self.errors,
        }


def build_command(
    sevenzip: Path,
    root: Path,
    archive: Path,
    options: PackOptions,
    list_file: Path | None = None,
) -> list[str]:
    profile = PROFILES.get(options.profile, PROFILES["normal"])
    cmd = [str(sevenzip), "a", str(archive)]
    if list_file is not None:
        cmd.append(f"@{list_file}")
    else:
        cmd.append(str(root / "*"))

    if options.level is not None:
        cmd.append(f"-mx={options.level}")
    else:
        cmd.extend(profile["switches"])

    dict_size = options.dict_size
    solid = options.solid_block
    if dict_size or solid:
        pieces = ["LZMA2"]
        if dict_size:
            pieces.append(f"d={dict_size}")
        if solid:
            pieces.append(f"bs={solid}")
        cmd.append("-m0=" + ":".join(pieces))
    if solid and not dict_size and options.level is None:
        cmd.append(f"-ms={solid}")

    if options.password:
        cmd.append(f"-p{options.password}")
    if options.header_encrypt:
        cmd.append("-mhe=on")
    for pattern in options.exclude:
        cmd.append(f"-xr!{pattern}")
    cmd.append(f"-mmt={options.threads or default_threads()}")
    if options.mem_percent:
        cmd.append(f"-mmemuse=p{options.mem_percent}")
    cmd.append("-bsp1")  # progress on stdout
    cmd.append("-y")
    return cmd


def _run(cmd: list[str], timeout: int = 0, cwd: Path | None = None) -> tuple[int, str]:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=None,  # let 7-Zip draw its progress bar
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        timeout=timeout or None,
        check=False,
    )
    return proc.returncode, (proc.stderr or "").strip()


def verify_archive(sevenzip: Path, archive: Path, timeout: int = 0) -> tuple[bool, str]:
    cmd = [str(sevenzip), "t", str(archive), "-bso0", "-bsp0", "-y"]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, errors="replace",
            timeout=timeout or None, check=False,
        )
    except subprocess.TimeoutExpired:
        return False, "archive test timed out"
    except OSError as exc:
        return False, str(exc)
    if proc.returncode == 0:
        return True, "archive integrity ok"
    detail = (proc.stdout or "") + (proc.stderr or "")
    tail = "\n".join([ln for ln in detail.splitlines() if ln.strip()][-6:])
    return False, tail or f"7z t exit {proc.returncode}"


def archive_entries(sevenzip: Path, archive: Path) -> int:
    cmd = [str(sevenzip), "l", "-slt", str(archive), "-bso0", "-y"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=300)
    except (OSError, subprocess.SubprocessError):
        return 0
    return proc.stdout.count("Path = ")


def default_output(root: Path) -> Path:
    return root.parent / f"{root.name}.7z"


def _guard_output(archive: Path, root: Path) -> str | None:
    try:
        archive.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    return "the archive must not be created inside the source folder"


def pack_folder(root: str | Path, options: PackOptions | None = None) -> PackResult:
    options = options or PackOptions()
    root = Path(root).expanduser().resolve()
    result = PackResult(root=root)

    if not root.is_dir():
        result.errors.append(f"not a directory: {root}")
        return result

    sevenzip = find_7z(options.sevenzip)
    result.sevenzip = sevenzip
    if not sevenzip:
        result.errors.append(
            "7-Zip not found; pass --sevenzip PATH or set the SEVENZIP environment variable"
        )
        return result
    log.debug(f"7-Zip: {sevenzip} ({seven_zip_version(sevenzip)})")

    archive = Path(options.output).expanduser() if options.output else default_output(root)
    archive = archive.resolve()
    if guard := _guard_output(archive, root):
        result.errors.append(guard)
        return result

    result.source_size = dir_size(root)

    selection = build_selection(root, options.selection)
    result.selection = selection
    if selection.count == 0:
        result.errors.append(
            "the selection is empty: nothing would be archived (check --select/--include/--exclude)"
        )
        return result

    # The plain "everything, nothing to leave out" case is handed to 7-Zip as a
    # wildcard, which is both faster and closer to what people expect. Anything
    # else - and any folder that has to be held back - goes through an explicit
    # list file, so what `files` prints is exactly what lands in the archive.
    plain = (
        selection.options.preset == "full"
        and not selection.options.include
        and not selection.options.exclude
        and not selection.options.exclude_dirs
        and selection.options.list_file is None
        and not selection.skipped_junk
    )
    if plain and not options.show_selection:
        log.info(
            f"selection: everything ({len(selection.files)} file(s), "
            f"{human_size(selection.bytes_total)})"
        )
    else:
        log.plain(summary(selection))

    if options.list_out:
        written = write_list_file(selection, Path(options.list_out).expanduser())
        log.info(f"selection list written to {options.list_out} ({written} lines)")

    tmp_dir: Path | None = None
    list_file: Path | None = None
    if not plain:
        tmp_dir = Path(tempfile.mkdtemp(prefix="gse-autopatcher-pack-"))
        list_file = tmp_dir / "files.lst"
        written = write_list_file(selection, list_file)
        log.info(f"packing an explicit selection of {written} path(s)")

    cmd = build_command(sevenzip, root, archive, options, list_file=list_file)
    log.info("compressing with: " + " ".join(cmd[1:]))
    log.info(f"source: {human_size(result.source_size)} -> {archive.name}")

    if options.dry_run:
        log.info("[dry-run] would create the archive; nothing written")
        result.archive = archive
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return result

    if archive.exists():
        log.warn(f"{archive.name} already exists, overwriting")
        try:
            archive.unlink()
        except OSError as exc:
            result.errors.append(f"cannot replace archive: {exc}")
            return result

    started = time.time()
    try:
        # With a list file the paths are relative, so 7-Zip must run from the
        # game folder to resolve them.
        code, stderr = _run(cmd, timeout=options.timeout, cwd=root if list_file else None)
    except subprocess.TimeoutExpired:
        result.errors.append("7-Zip timed out")
        return result
    except OSError as exc:
        result.errors.append(f"could not start 7-Zip: {exc}")
        return result
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    result.seconds = time.time() - started

    if code != 0 or not archive.is_file():
        result.errors.append(f"7z a exit {code}{': ' + stderr if stderr else ''}")
        return result

    result.archive = archive
    result.archive_size = archive.stat().st_size
    log.ok(
        f"packed {human_size(result.source_size)} into {human_size(result.archive_size)} "
        f"({result.ratio * 100:.1f}%) in {result.seconds:.0f}s"
    )

    if options.test_archive:
        ok, detail = verify_archive(sevenzip, archive, timeout=options.timeout)
        result.verified = ok
        if ok:
            log.ok("archive verified with 7z t")
        else:
            result.errors.append(f"archive test failed: {detail}")
            return result

    if not options.delete_original:
        log.info("source kept (use --delete-original to remove it)")
        return result

    if not result.verified and options.test_archive:
        result.errors.append("refusing to delete the source: archive was not verified")
        return result
    if not confirm(
        f"Delete {root} and keep only {archive.name}?", options.yes, default=False
    ):
        log.info("source kept: deletion not confirmed")
        return result

    trash = root.with_name(f"{root.name}.deleting-{time.strftime('%H%M%S')}")
    staged = False
    try:
        os.replace(root, trash)
        staged = True
    except OSError as exc:
        log.warn(f"could not stage the source for deletion ({exc}); deleting in place")
    target = trash if staged else root
    try:
        if target.is_dir():
            safe_rmtree(target)
    except OSError as exc:
        result.errors.append(f"could not delete {target}: {exc}")
        return result

    result.deleted = not root.exists() and not target.exists()

    if result.deleted:
        log.ok(f"deleted source folder, only {archive.name} remains")
    return result
