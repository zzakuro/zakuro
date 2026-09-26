"""Apply the emulator patch to a game folder.

Steps, each one independently skipped when the folder already satisfies it:

1. backup       keep the pre-patch executable/libraries outside the game folder
2. drm_removal  run Steamless when the executable still carries a `.bind` section
3. emu_dll      install the emulator library matching the game bitness
4. steam_settings  build `steam_settings/`, optionally via gse_fork_tools
5. interfaces   generate `steam_settings/steam_interfaces.txt`
6. appid        write `steam_settings/steam_appid.txt`
7. extras       add the extra `.txt` / `.lnk` files
8. marker       record what was done so a re-run is a no-op
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import const, interfaces
from .detect import Detection, detect
from .external import EmuSource
from .probe import GameFacts, probe
from .util import copy2, log, sha256_file, write_json

HASH_SIZE_LIMIT = 512 * 1024 * 1024


@dataclass
class PatchOptions:
    appid: int | None = None
    app_name: str | None = None
    emu_source: EmuSource | None = None
    steamless: Path | None = None
    gen_emu_config: Path | None = None
    settings_mode: str = "auto"  # auto | generator | minimal | copy
    generator_flags: tuple[str, ...] = ("-cdx", "-rne", "-acw", "-clr")
    interfaces_from: Path | None = None
    backup: bool = True
    backup_dir: Path | None = None
    dry_run: bool = False
    force: bool = False
    yes: bool = False
    remove_steamstub: bool = True
    steamless_flags: tuple[str, ...] = ("--realign", "--recalcchecksum")
    all_arches: bool = False
    appid_placement: str = "settings"  # settings | root | both
    txt_file: Path | None = None
    lnk_file: Path | None = None
    lnk_name: str | None = None
    lnk_icon: str | None = None
    lnk_args: str | None = None
    lnk_description: str | None = None
    txt_name: str | None = None
    template_vars: dict[str, str] = field(default_factory=dict)
    personality: dict[str, str] = field(default_factory=dict)
    user_config: dict[str, str] = field(default_factory=dict)
    generator_timeout: int = 900


@dataclass
class PatchResult:
    facts: GameFacts
    detection: Detection
    performed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    changed: bool = False
    backup_dir: Path | None = None

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "root": str(self.facts.root),
            "verdict": self.detection.verdict,
            "performed": self.performed,
            "skipped": self.skipped,
            "files": self.files,
            "errors": self.errors,
            "changed": self.changed,
            "backup_dir": str(self.backup_dir) if self.backup_dir else None,
        }


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _rel_to(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return str(path)


# ---------------------------------------------------------------- step: backup
def _backup_targets(facts: GameFacts, options: PatchOptions) -> Path:
    root = facts.root
    base = options.backup_dir or root.parent / f"{root.name}.autopatch-backup"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = Path(base) / stamp
    targets: list[Path] = []
    if facts.primary and not facts.primary.pe.has_steamstub():
        targets.append(facts.primary.path)
    targets.extend(facts.original_dlls.values())
    if not targets:
        return target
    if options.dry_run:
        log.info(f"[dry-run] would back up {len(targets)} file(s) to {target}")
        return target
    target.mkdir(parents=True, exist_ok=True)
    for path in targets:
        if path.is_file():
            try:
                shutil.copy2(path, target / path.name)
                log.info(f"backed up {path.name}")
            except OSError as exc:
                log.warn(f"could not back up {path.name}: {exc}")
    return target


# ------------------------------------------------------- step: DRM removal
def _run_steamless(
    exe: Path, steamless: Path, flags: tuple[str, ...], timeout: int = 600
) -> tuple[bool, str]:
    cmd = [str(steamless), *flags, str(exe)]
    log.info(f"running: {steamless.name} {' '.join(flags)} {exe.name}")
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(exe.parent),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, "Steamless timed out"
    except OSError as exc:
        return False, f"could not start Steamless: {exc}"
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0 and not (exe.parent / (exe.name + ".unpacked.exe")).is_file():
        tail = "\n".join(output.strip().splitlines()[-6:])
        return False, f"Steamless exit {proc.returncode}\n{tail}"
    return True, output.strip()


def _drm_removal(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    stub_exes = [c for c in facts.exes if c.pe.has_steamstub()]
    if not stub_exes:
        result.skipped.append("drm_removal: no SteamStub `.bind` section found")
        return True
    if not options.remove_steamstub:
        result.skipped.append("drm_removal: disabled")
        return True
    if not options.steamless:
        result.errors.append(
            "SteamStub detected but no Steamless CLI was provided (--steamless PATH)"
        )
        return False

    changed = False
    for cand in stub_exes:
        exe = cand.path
        unpacked = exe.with_name(exe.name + ".unpacked.exe")
        if options.dry_run:
            log.info(f"[dry-run] would run Steamless on {cand.rel}")
            changed = True
            continue
        if unpacked.is_file():
            log.info(f"reusing existing {unpacked.name}")
        else:
            ok, output = _run_steamless(exe, options.steamless, options.steamless_flags)
            if not ok:
                result.errors.append(f"Steamless failed on {cand.rel}: {output}")
                return False
            for line in output.splitlines()[-3:]:
                log.debug(f"  steamless: {line}")
            if not unpacked.is_file():
                candidates = sorted(
                    p for p in exe.parent.glob(exe.name + ".*") if p.suffix.lower() in (".exe", ".unpacked")
                )
                if candidates:
                    unpacked = candidates[0]
                else:
                    result.errors.append(
                        f"Steamless produced no unpacked file for {cand.rel}"
                    )
                    return False
        from .pe import read_pe

        info = read_pe(unpacked)
        if not info.is_pe:
            result.errors.append(f"unpacked file for {cand.rel} is not a valid PE")
            return False
        if info.has_steamstub():
            result.errors.append(f"`.bind` section still present after Steamless on {cand.rel}")
            return False
        shutil.move(str(unpacked), str(exe))
        log.ok(f"SteamStub removed from {cand.rel}")
        changed = True

    if changed:
        result.performed.append("drm_removal")
        result.changed = True
    return True


# ------------------------------------------------------------ step: emu dll
def _emu_dll(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    source = options.emu_source
    if not source or not source.found:
        result.skipped.append("emu_dll: no emulator library folder provided (--emu-dir)")
        return True

    targets: set[int] = {facts.bitness} if facts.bitness else set()
    if options.all_arches:
        targets |= set(source.found)
    targets.discard(0)
    if not targets:
        result.errors.append("could not determine the game bitness")
        return False

    installed = False
    for bitness in sorted(targets):
        dll = source.dll_for(bitness)
        if not dll:
            result.errors.append(
                f"emulator folder {source.root} has no {bitness}-bit library"
            )
            continue
        dest = facts.root / dll.name
        if dest.is_file():
            if sha256_file(dest) == sha256_file(dll):
                result.skipped.append(f"emu_dll: {dll.name} already up to date")
                continue
        if options.dry_run:
            log.info(f"[dry-run] would copy {dll.name} into {facts.root.name}")
            installed = True
            continue
        if dest.is_file():
            backup_dir = result.backup_dir
            if backup_dir:
                try:
                    shutil.copy2(dest, backup_dir / dest.name)
                except OSError as exc:
                    log.warn(f"could not back up {dest.name}: {exc}")
        copy2(dll, dest)
        log.ok(f"installed {dll.name} ({bitness}-bit emulator library)")
        result.files[_rel_to(facts.root, dest)] = f"sha256:{sha256_file(dest)}"
        installed = True
        result.changed = True

    if installed:
        result.performed.append("emu_dll")
    return True


# ------------------------------------------------- step: steam_settings base
def _copy_settings_template(
    facts: GameFacts, options: PatchOptions, result: PatchResult
) -> int:
    source = options.emu_source.settings_example if options.emu_source else None
    if not source or not source.is_dir():
        return 0
    copied = 0
    for item in source.rglob("*"):
        if item.is_dir():
            continue
        rel = item.relative_to(source)
        # GBE ships `name.EXTENSION.EXAMPLE`; the deployed name drops the suffix.
        parts = [p.replace(".EXAMPLE", "") for p in rel.parts]
        dest = facts.root / const.STEAM_SETTINGS_DIR / Path(*parts)
        if dest.exists():
            continue
        if options.dry_run:
            log.info(f"[dry-run] would add {_rel_to(facts.root, dest)}")
            copied += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, dest)
        log.debug(f"template -> {_rel_to(facts.root, dest)}")
        copied += 1
    if copied:
        log.info(f"copied {copied} emulator template file(s) into {const.STEAM_SETTINGS_DIR}/")
    return copied


def _run_generator(
    facts: GameFacts, options: PatchOptions, result: PatchResult
) -> bool | None:
    """Run gse_fork_tools' generate_emu_config. True=ran, False=failed, None=n/a."""
    tool = options.gen_emu_config
    appid = options.appid or facts.appid
    if not tool:
        return None
    if not appid:
        result.errors.append("generate_emu_config needs an app id (--appid)")
        return False
    if options.dry_run:
        log.info(f"[dry-run] would run {tool.name} {appid} in {facts.root.name}")
        return True

    if tool.suffix.lower() == ".py":
        cmd = [sys.executable, str(tool), *options.generator_flags, str(appid)]
    else:
        cmd = [str(tool), *options.generator_flags, str(appid)]
    log.info(f"running: {tool.name} {' '.join(options.generator_flags)} {appid}")
    env = dict(os.environ)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(facts.root),
            capture_output=True,
            text=True,
            timeout=options.generator_timeout,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        result.errors.append("generate_emu_config timed out")
        return False
    except OSError as exc:
        result.errors.append(f"could not start generate_emu_config: {exc}")
        return False

    output = (proc.stdout or "") + (proc.stderr or "")
    settings = facts.root / const.STEAM_SETTINGS_DIR
    if proc.returncode != 0 and not settings.is_dir():
        tail = "\n".join(output.strip().splitlines()[-6:])
        result.errors.append(f"generate_emu_config exit {proc.returncode}\n{tail}")
        return False
    if not settings.is_dir():
        result.errors.append("generate_emu_config produced no steam_settings folder")
        return False
    log.ok("steam_settings generated")
    return True


def _write_user_config(
    facts: GameFacts, options: PatchOptions, result: PatchResult
) -> None:
    if not options.user_config:
        return
    dest = facts.root / const.STEAM_SETTINGS_DIR / "configs.user.ini"
    lines = ["[user]"]
    for key, value in options.user_config.items():
        lines.append(f"{key}={value}")
    if options.dry_run:
        log.info(f"[dry-run] would write {_rel_to(facts.root, dest)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log.info(f"wrote {_rel_to(facts.root, dest)}")


def _steam_settings(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    settings = facts.root / const.STEAM_SETTINGS_DIR
    mode = options.settings_mode
    generated = False

    if mode in ("auto", "generator"):
        outcome = _run_generator(facts, options, result)
        if outcome is True:
            generated = True
            result.performed.append("steam_settings")
            result.changed = True
        elif outcome is False:
            if mode == "generator":
                return False
            log.warn("falling back to the minimal steam_settings layout")

    if not generated:
        if mode == "copy":
            copied = _copy_settings_template(facts, options, result)
            if not copied and not options.dry_run:
                result.errors.append(
                    "no steam_settings template found; use --settings-mode minimal"
                )
                return False
        else:
            if options.dry_run:
                log.info(f"[dry-run] would create {const.STEAM_SETTINGS_DIR}/")
            else:
                settings.mkdir(parents=True, exist_ok=True)
                _copy_settings_template(facts, options, result)
            _write_user_config(facts, options, result)
        result.performed.append("steam_settings")
        result.changed = True
    return True


# ---------------------------------------------------------- step: interfaces
def _interfaces(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    dest = facts.root / const.STEAM_SETTINGS_DIR / "steam_interfaces.txt"
    existing = dest.is_file()
    if existing and not options.force:
        result.skipped.append("interfaces: steam_interfaces.txt already present")
        return True

    sources: list[Path] = []
    if options.interfaces_from:
        sources.append(Path(options.interfaces_from))
    sources.extend(facts.original_dlls.values())  # the genuine Valve library first
    sources.extend(facts.emu_dlls.values())       # then the emulator build
    if facts.primary:
        sources.append(facts.primary.path)        # last resort: the game binary
    # A patched folder no longer ships the original library: use the emu build
    # as a stand-in when the folder holds nothing at all.
    if options.emu_source:
        sources.extend(options.emu_source.all_dlls())

    source_path, names = interfaces.best_source([s for s in sources if s and s.is_file()])
    if not names:
        result.errors.append(
            "could not extract any Steam interface strings; pass --interfaces-from PATH"
        )
        return False

    if options.dry_run:
        log.info(f"[dry-run] would write {len(names)} interfaces to {_rel_to(facts.root, dest)}")
        return True

    interfaces.write_steam_interfaces(dest, names)
    log.ok(f"wrote {len(names)} interfaces (from {source_path.name})")
    result.performed.append("interfaces")
    result.changed = True
    result.files[_rel_to(facts.root, dest)] = f"sha256:{sha256_file(dest)}"
    return True


# --------------------------------------------------------------- step: appid
def _appid_step(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    appid = options.appid or facts.appid
    if not appid:
        result.skipped.append("appid: unknown (pass --appid N)")
        return True
    placements: list[Path] = []
    settings_appid = facts.root / const.STEAM_SETTINGS_DIR / "steam_appid.txt"
    root_appid = facts.root / "steam_appid.txt"
    if options.appid_placement in ("settings", "both"):
        placements.append(settings_appid)
    if options.appid_placement in ("root", "both"):
        placements.append(root_appid)

    wrote = False
    for dest in placements:
        if dest.is_file() and dest.read_text(encoding="utf-8", errors="ignore").strip() == str(appid):
            continue
        if options.dry_run:
            log.info(f"[dry-run] would write app id to {_rel_to(facts.root, dest)}")
            wrote = True
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f"{appid}\n", encoding="utf-8")
        log.info(f"app id {appid} -> {_rel_to(facts.root, dest)}")
        result.files[_rel_to(facts.root, dest)] = f"sha256:{sha256_file(dest)}"
        wrote = True

    if wrote:
        result.performed.append("appid")
        result.changed = True
    else:
        result.skipped.append("appid: already written")
    return True


# -------------------------------------------------------------- step: extras
def _extras(facts: GameFacts, options: PatchOptions, result: PatchResult) -> bool:
    from .extras import install_extras

    return install_extras(facts, options, result)


# ------------------------------------------------------------- step: marker
def _marker(facts: GameFacts, options: PatchOptions, result: PatchResult) -> None:
    files = dict(result.files)
    for rel, path in (
        ("primary_exe", facts.primary.path if facts.primary else None),
        ("steam_interfaces.txt", facts.root / const.STEAM_SETTINGS_DIR / "steam_interfaces.txt"),
    ):
        if not path or not path.is_file():
            continue
        try:
            if path.stat().st_size > HASH_SIZE_LIMIT:
                files.setdefault(_rel_to(facts.root, path), f"size:{path.stat().st_size}")
            else:
                files.setdefault(_rel_to(facts.root, path), f"sha256:{sha256_file(path)}")
        except OSError:
            pass
    for name, path in facts.emu_dlls.items():
        try:
            files.setdefault(name, f"sha256:{sha256_file(path)}")
        except OSError:
            pass

    payload = {
        "tool": const.TOOL_NAME,
        "tool_version": const.TOOL_VERSION,
        "marker_version": const.MARKER_VERSION,
        "patched_at": _now(),
        "appid": options.appid or facts.appid,
        "app_name": options.app_name or facts.app_name,
        "bitness": facts.bitness,
        "primary_exe": facts.primary.rel if facts.primary else None,
        "actions": result.performed,
        "files": files,
        "tools": {
            "steamless": str(options.steamless) if options.steamless else None,
            "emu_source": str(options.emu_source.root) if options.emu_source else None,
            "gen_emu_config": str(options.gen_emu_config) if options.gen_emu_config else None,
        },
        "template_vars": options.template_vars or {},
    }
    dest = facts.root / const.MARKER_FILENAME
    if options.dry_run:
        log.info(f"[dry-run] would write {_rel_to(facts.root, dest)}")
        return
    write_json(dest, payload)
    log.ok(f"wrote {_rel_to(facts.root, dest)}")
    result.performed.append("marker")
    result.changed = True


# ------------------------------------------------------------------ entry
def patch_game(root: str | Path | GameFacts, options: PatchOptions | None = None) -> PatchResult:
    options = options or PatchOptions()
    facts = root if isinstance(root, GameFacts) else probe(root)
    detection = detect(facts)
    result = PatchResult(facts=facts, detection=detection)

    if detection.verdict == "not-steam":
        result.skipped.append("nothing Steam related to patch")
        return result
    if detection.verdict == "unknown":
        result.errors.extend(detection.reasons or ["could not identify the game executable"])
        return result
    if detection.verdict == "patched" and not options.force:
        result.skipped.append("already patched (use --force to run anyway)")
        return result

    if options.appid:
        facts.appid = options.appid
    if options.app_name:
        facts.app_name = options.app_name

    if options.backup and (facts.has_steamstub or facts.original_dlls):
        result.backup_dir = _backup_targets(facts, options)
    else:
        result.backup_dir = None

    steps = (
        _drm_removal,
        _emu_dll,
        _steam_settings,
        _interfaces,
        _appid_step,
        _extras,
    )
    for step in steps:
        if not step(facts, options, result):
            log.error(f"step failed: {step.__name__.strip('_')}")
            break

    facts = probe(facts.root)
    result.detection = detect(facts)
    if result.errors:
        result.skipped.append("marker: not written because a step failed")
        return result
    _marker(facts, options, result)
    return result
