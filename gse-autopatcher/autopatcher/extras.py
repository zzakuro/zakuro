"""Add the two extra payload files: a text file and a Windows shortcut."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from . import const
from .util import log, sha256_file

LNK_MAGIC = b"L\x00\x00\x00"  # HeaderSize of an IShellLink stream


def render_template(text: str, values: dict[str, str]) -> str:
    """Replace {TOKEN} placeholders; unknown tokens are left untouched."""
    out: list[str] = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch == "{" and i + 1 < length and text[i + 1] == "{":
            out.append("{")
            i += 2
            continue
        if ch == "}" and i + 1 < length and text[i + 1] == "}":
            out.append("}")
            i += 2
            continue
        if ch == "{":
            end = text.find("}", i)
            if end != -1:
                token = text[i + 1 : end]
                if token in values:
                    out.append(str(values[token]))
                    i = end + 1
                    continue
        out.append(ch)
        i += 1
    return "".join(out)


def template_values(facts, options) -> dict[str, str]:
    appid = options.appid or facts.appid
    game = options.app_name or facts.app_name or facts.root.name
    values = {
        "GAME": game,
        "GAME_NAME": game,
        "FOLDER": facts.root.name,
        "APPID": str(appid or ""),
        "EXE": facts.primary.path.name if facts.primary else "",
        "EXE_PATH": str(facts.primary.path) if facts.primary else "",
        "DATE": time.strftime("%Y-%m-%d"),
        "TIME": time.strftime("%H:%M:%S"),
        "DATETIME": time.strftime("%Y-%m-%d %H:%M:%S"),
        "VERSION": const.TOOL_VERSION,
        "BITNESS": f"{facts.bitness}-bit" if facts.bitness else "",
        "STEAM_SETTINGS": const.STEAM_SETTINGS_DIR,
    }
    for key, val in (options.template_vars or {}).items():
        values[key.upper()] = str(val)
    return values


def _ps_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def create_shortcut(
    dest: Path,
    target: Path,
    working_dir: Path | None = None,
    icon: str | None = None,
    description: str | None = None,
    arguments: str | None = None,
) -> tuple[bool, str]:
    """Create `dest` (.lnk) pointing at `target` using WScript.Shell."""
    if os.name != "nt":
        return False, "shortcut creation needs Windows (WScript.Shell)"
    if not target.is_file():
        return False, f"target does not exist: {target}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        try:
            dest.unlink()
        except OSError as exc:
            return False, f"cannot replace existing shortcut: {exc}"

    icon_location = icon or f"{target},0"
    script = "\n".join(
        [
            "$ErrorActionPreference = 'Stop'",
            "$shell = New-Object -ComObject WScript.Shell",
            f"$sc = $shell.CreateShortcut({_ps_quote(str(dest))})",
            f"$sc.TargetPath = {_ps_quote(str(target))}",
            f"$sc.WorkingDirectory = {_ps_quote(str(working_dir or target.parent))}",
            f"$sc.IconLocation = {_ps_quote(icon_location)}",
            f"$sc.Description = {_ps_quote(description or f'Play {target.stem}')}",
            f"$sc.Arguments = {_ps_quote(arguments or '')}",
            "$sc.Save()",
        ]
    )
    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8") as fh:
        fh.write(script)
        script_path = fh.name
    try:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                script_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"could not run PowerShell: {exc}"
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
    if proc.returncode != 0:
        return False, (proc.stderr or proc.stdout or "PowerShell failed").strip()
    if not dest.is_file():
        return False, "PowerShell reported success but no shortcut was written"
    return True, "created"


def is_valid_lnk(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            return fh.read(4) == LNK_MAGIC
    except OSError:
        return False


def _lnk_dest(facts, options) -> Path:
    name = options.lnk_name or (facts.primary.path.stem if facts.primary else "game")
    if not name.lower().endswith(".lnk"):
        name += ".lnk"
    return facts.root / name


def install_extras(facts, options, result) -> bool:
    """Write the .txt and the .lnk. Returns False on a hard failure."""
    ok = True

    # -- text file -----------------------------------------------------
    if options.txt_file:
        src = Path(options.txt_file)
        if not src.is_file():
            result.errors.append(f"extra .txt not found: {src}")
            ok = False
        else:
            dest = facts.root / (options.txt_name or src.name)
            if options.dry_run:
                log.info(f"[dry-run] would add {dest.name}")
            else:
                try:
                    text = src.read_text(encoding="utf-8", errors="replace")
                except OSError as exc:
                    result.errors.append(f"cannot read {src}: {exc}")
                    ok = False
                else:
                    rendered = render_template(text, template_values(facts, options))
                    dest.write_text(rendered, encoding="utf-8", newline="\r\n")
                    log.ok(f"added {dest.name} ({dest.stat().st_size} bytes)")
                    result.performed.append("extras:txt")
                    result.changed = True
                    result.files[str(dest.relative_to(facts.root)).replace("\\", "/")] = (
                        f"sha256:{sha256_file(dest)}"
                    )
    else:
        result.skipped.append("extras: no .txt provided (--txt-file)")

    # -- shortcut ------------------------------------------------------
    if options.lnk_file:
        src = Path(options.lnk_file)
        if not src.is_file():
            result.errors.append(f"shortcut template not found: {src}")
            ok = False
        else:
            dest = _lnk_dest(facts, options)
            if options.dry_run:
                log.info(f"[dry-run] would create {dest.name}")
            else:
                shutil.copy2(src, dest)
                if is_valid_lnk(dest):
                    log.ok(f"added {dest.name} (copied)")
                else:
                    log.warn(f"{dest.name} is not a Windows shortcut file")
                result.performed.append("extras:lnk")
                result.changed = True
                result.files[str(dest.relative_to(facts.root)).replace("\\", "/")] = (
                    f"sha256:{sha256_file(dest)}"
                )
    elif options.lnk_name or (facts.primary and options.txt_file):
        if not facts.primary:
            result.errors.append("cannot create a shortcut: no game executable found")
            ok = False
        else:
            dest = _lnk_dest(facts, options)
            if options.dry_run:
                log.info(f"[dry-run] would create {dest.name}")
            else:
                done, message = create_shortcut(
                    dest,
                    facts.primary.path,
                    working_dir=facts.root,
                    icon=options.lnk_icon,
                    description=options.lnk_description,
                    arguments=getattr(options, "lnk_args", None),
                )
                if done:
                    log.ok(f"added {dest.name} -> {facts.primary.rel}")
                    result.performed.append("extras:lnk")
                    result.changed = True
                    result.files[str(dest.relative_to(facts.root)).replace("\\", "/")] = (
                        f"sha256:{sha256_file(dest)}"
                    )
                else:
                    result.errors.append(f"shortcut not created: {message}")
                    ok = False
    else:
        result.skipped.append("extras: no shortcut requested (--lnk-name/--lnk-file)")

    return ok
