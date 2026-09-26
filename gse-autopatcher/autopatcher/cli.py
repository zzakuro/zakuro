"""Command line front end."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import const
from .detect import NOT_STEAM, PATCHED, detect, format_report
from .external import find_7z, find_emu_source, find_gen_emu_config, find_steamless, seven_zip_version
from .pack import PROFILES, PackOptions, pack_folder
from .patch import PatchOptions, patch_game
from .pipeline import PipelineOptions, PipelineResult, report, run_pipeline
from .probe import probe
from .select import SelectionOptions, build_selection, inventory, summary, write_list_file
from .util import human_size, log, read_json

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SKIPPED = 2
EXIT_NEEDS_PATCH = 3


def _kv(text: str) -> tuple[str, str]:
    key, _, value = text.partition("=")
    if not _:
        raise argparse.ArgumentTypeError(f"expected KEY=VALUE, got {text!r}")
    return key.strip(), value


def _add_detect_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("folder", help="game folder to inspect")
    parser.add_argument("--max-depth", type=int, default=2,
                        help="how deep to search for executables (default: 2)")
    parser.add_argument("--no-verify-hashes", action="store_true",
                        help="do not re-hash files listed in the patch marker")
    parser.add_argument("--emu-dir",
                        help="compare the deployed library against this emulator build")
    parser.add_argument("-v", "--verbose", action="store_true", help="show every executable")
    parser.add_argument("--json", action="store_true", help="machine readable output")


def _add_selection_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("archive contents")
    group.add_argument("--select", choices=const.SELECT_PRESETS, default="full",
                       help="what goes into the archive: full (default), "
                            "crack-only (emulator payload), or game-only (no payload)")
    group.add_argument("--include", action="append", metavar="PATTERN",
                       help="only include paths matching this glob (repeatable)")
    group.add_argument("-x", "--exclude", action="append", metavar="PATTERN",
                       help="exclude paths matching this glob (repeatable)")
    group.add_argument("--exclude-dir", action="append", metavar="NAME",
                       help="exclude a folder and everything under it (repeatable)")
    group.add_argument("--list", dest="list_file", metavar="FILE",
                       help="read paths/globs from a file ('#' comments, '-pattern' "
                            "excludes, '/name' excludes a folder)")
    group.add_argument("--list-out", metavar="FILE",
                       help="write the resolved selection to a file for --list")
    group.add_argument("--include-junk", action="store_true",
                       help="also archive the tool's own leftovers and system folders")
    group.add_argument("--show-selection", action="store_true",
                       help="print the selection breakdown even for a full archive")


def _add_patch_args(parser: argparse.ArgumentParser, own_safety: bool = True) -> None:
    group = parser.add_argument_group("game identity")
    group.add_argument("--appid", type=int, help="Steam app id (skips the lookup)")
    group.add_argument("--app-name", help="game name used in the .txt template")
    group.add_argument("--lookup-appid", metavar="NAME_OR_ID",
                       help="resolve the app id from the store before patching")

    group = parser.add_argument_group("external tools")
    group.add_argument("--emu-dir", help="folder with the emulator steam_api libraries")
    group.add_argument("--steamless", help="path to Steamless.CLI.exe (SteamStub removal)")
    group.add_argument("--steamless-flags", default="--realign --recalcchecksum",
                       help="flags passed to Steamless")
    group.add_argument("--keep-stub", action="store_true",
                       help="do not remove a SteamStub `.bind` section")
    group.add_argument("--gen-emu-config", help="path to generate_emu_config (.exe or .py)")
    group.add_argument("--settings-mode", choices=("auto", "generator", "minimal", "copy"),
                       default="auto", help="how to build steam_settings (default: auto)")
    group.add_argument("--gen-flags", default="-cdx -rne -acw -clr",
                       help="flags for generate_emu_config (default: -cdx -rne -acw -clr)")
    group.add_argument("--interfaces-from", help="file to extract steam interfaces from")
    group.add_argument("--user-config", type=_kv, action="append", metavar="KEY=VALUE",
                       help="extra key/value for steam_settings/configs.user.ini")

    group = parser.add_argument_group("emulator deployment")
    group.add_argument("--all-arches", action="store_true",
                       help="install both 32 and 64 bit libraries")
    group.add_argument("--appid-placement", choices=("settings", "root", "both"),
                       default="settings", help="where to write steam_appid.txt")

    group = parser.add_argument_group("extra files")
    group.add_argument("--txt-file", help="text file to add (tokens are substituted)")
    group.add_argument("--txt-name", help="rename the added text file")
    group.add_argument("--lnk-file", help="shortcut file to copy in")
    group.add_argument("--lnk-name",
                       help="create a shortcut with this name instead of copying one")
    group.add_argument("--lnk-icon", help="icon location for a generated shortcut")
    group.add_argument("--lnk-args", help="arguments for a generated shortcut")
    group.add_argument("--lnk-description", help="description for a generated shortcut")
    group.add_argument("--var", type=_kv, action="append", metavar="KEY=VALUE",
                       help="extra {TOKEN} for the text template")

    group = parser.add_argument_group("safety")
    group.add_argument("--force", action="store_true", help="patch even if already patched")
    group.add_argument("--no-backup", action="store_true", help="skip the pre-patch backup")
    group.add_argument("--backup-dir", help="where to keep the backup")
    if own_safety:
        group.add_argument("--dry-run", action="store_true",
                           help="show what would happen, change nothing")
        group.add_argument("-y", "--yes", action="store_true", help="assume yes for prompts")


def _add_pack_args(parser: argparse.ArgumentParser, own_safety: bool = True) -> None:
    group = parser.add_argument_group("compression")
    group.add_argument("-o", "--output", help="archive path (default: <folder>.7z)")
    group.add_argument("--sevenzip", help="path to 7z.exe / 7za.exe")
    group.add_argument("--profile", choices=tuple(PROFILES), default="normal",
                       help="compression profile (default: normal)")
    group.add_argument("-mx", dest="level", type=int, help="override the level (0-9)")
    group.add_argument("--dict", dest="dict_size", help="dictionary size, e.g. 256m")
    group.add_argument("--solid", dest="solid_block", help="solid block size, e.g. 256m")
    group.add_argument("--threads", type=int, help="worker threads (default: 70%% of CPUs)")
    group.add_argument("--mem-percent", type=int, help="7-Zip memory use, e.g. 90")
    group.add_argument("-p", "--password", help="encrypt the archive")
    group.add_argument("--encrypt-names", action="store_true",
                       help="also encrypt the archive file names")
    group.add_argument("--no-test", action="store_true", help="skip 7z t after packing")
    group.add_argument("--pack-anyway", action="store_true",
                       help="compress even when a patch step reported errors")
    group.add_argument("--timeout", type=int, default=0, help="abort 7-Zip after N seconds")
    group.add_argument("--delete-original", action="store_true",
                       help="delete the game folder once the archive is verified")
    if own_safety:
        group.add_argument("--dry-run", action="store_true")
        group.add_argument("-y", "--yes", action="store_true", help="assume yes for prompts")


def _add_shared_safety_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("safety")
    group.add_argument("--dry-run", action="store_true",
                       help="show what would happen, change nothing")
    group.add_argument("-y", "--yes", action="store_true", help="assume yes for prompts")


# Global switches are accepted before *and* after the sub command. SUPPRESS
# keeps the sub parser from overwriting a value given ahead of the sub command.
GLOBAL = argparse.ArgumentParser(add_help=False)
GLOBAL.add_argument("--config", default=argparse.SUPPRESS,
                     help="JSON config file providing default values")
GLOBAL.add_argument("--log-level", default=argparse.SUPPRESS,
                     choices=("debug", "info", "warn", "error", "silent"),
                     help="console verbosity (default: info)")
GLOBAL.add_argument("--no-color", action="store_true", default=argparse.SUPPRESS,
                     help="disable coloured output")


def build_parser() -> tuple[argparse.ArgumentParser, dict[str, argparse.ArgumentParser]]:
    parser = argparse.ArgumentParser(
        prog="gse-autopatcher",
        parents=[GLOBAL],
        description=(
            "Detect, patch, package and clean up Goldberg-emulator game folders. "
            "Built around gbe_fork, gse_fork_tools, Steamless and 7-Zip."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  gse-autopatcher detect 'D:\\Games\\Hades' --emu-dir emu\n"
            "  gse-autopatcher files 'D:\\Games\\Hades' --select crack-only\n"
            "  gse-autopatcher patch 'D:\\Games\\Hades' --emu-dir emu --steamless steamless\\Steamless.CLI.exe\n"
            "  gse-autopatcher run 'D:\\Games\\Hades' --emu-dir emu --appid 1145360 \\\n"
            "      --txt-file nfo.txt --lnk-name 'Hades.lnk' --profile high \\\n"
            "      --exclude-dir logs --delete-original -y\n"
        ),
    )
    parser.add_argument("--version", action="version", version=f"{const.TOOL_NAME} {const.TOOL_VERSION}")
    parser.set_defaults(config=None, log_level="info", no_color=False)

    subs = parser.add_subparsers(dest="command", required=True)
    subparsers: dict[str, argparse.ArgumentParser] = {}

    def add(name: str, help_text: str) -> argparse.ArgumentParser:
        sub = subs.add_parser(name, help=help_text, parents=[GLOBAL])
        subparsers[name] = sub
        return sub

    p = add("detect", "report whether a folder is already patched")
    _add_detect_args(p)

    p = add("files", "show what is in a folder and what would be archived")
    p.add_argument("folder")
    p.add_argument("--json", action="store_true")
    _add_selection_args(p)

    p = add("patch", "apply the patch to a folder")
    p.add_argument("folder")
    p.add_argument("--max-depth", type=int, default=2)
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--json", action="store_true")
    _add_patch_args(p)

    p = add("pack", "compress a folder with 7-Zip")
    p.add_argument("folder")
    p.add_argument("--json", action="store_true")
    _add_pack_args(p)
    _add_selection_args(p)

    p = add("run", "detect, patch, then compress in one go")
    p.add_argument("folder")
    p.add_argument("--max-depth", type=int, default=2)
    p.add_argument("--no-pack", action="store_true", help="stop after patching")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--json", action="store_true")
    _add_patch_args(p, own_safety=False)
    _add_pack_args(p, own_safety=False)
    _add_selection_args(p)
    _add_shared_safety_args(p)

    p = add("batch", "run the pipeline over many folders")
    p.add_argument("roots", nargs="+", help="folders or a parent folder to scan")
    p.add_argument("--recursive", action="store_true", help="descend into sub folders")
    p.add_argument("--depth", type=int, default=2, help="scan depth for --recursive")
    p.add_argument("--max-depth", type=int, default=2,
                   help="how deep to look for executables inside each folder")
    p.add_argument("--no-pack", action="store_true", help="patch only, do not compress")
    p.add_argument("--only", choices=("all", "unpatched", "patched", "stale"),
                   default="all",
                   help="filter by current state; 'stale' means patched but changed "
                        "or built with a different emulator (default: all)")
    p.add_argument("--stop-on-error", action="store_true")
    p.add_argument("--continue", dest="keep_going", action="store_true",
                   help="keep going after a folder fails (default)")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--json", action="store_true", help="write a JSON report to stdout")
    _add_patch_args(p, own_safety=False)
    _add_pack_args(p, own_safety=False)
    _add_selection_args(p)
    _add_shared_safety_args(p)

    add("tools", "show which external tools were found")
    p = add("selftest", "build a synthetic game and run the pipeline")
    p.add_argument("--keep", action="store_true", help="keep the temporary folders")
    p.add_argument("--json", action="store_true")
    return parser, subparsers


def _patch_options(args: argparse.Namespace) -> PatchOptions:
    lookup_id = None
    if args.lookup_appid:
        from .steamapi import resolve

        found = resolve(args.lookup_appid)
        if found is None:
            raise SystemExit(f"could not resolve {args.lookup_appid!r} to a Steam app id")
        log.ok(f"store lookup: {found.name} ({found.appid})")
        lookup_id = found.appid

    user_config = dict(args.user_config or [])
    return PatchOptions(
        appid=args.appid or lookup_id,
        app_name=args.app_name,
        emu_source=find_emu_source(args.emu_dir),
        steamless=Path(args.steamless) if args.steamless else find_steamless(),
        gen_emu_config=Path(args.gen_emu_config) if args.gen_emu_config else find_gen_emu_config(),
        settings_mode=args.settings_mode,
        generator_flags=tuple(args.gen_flags.split()),
        interfaces_from=Path(args.interfaces_from) if args.interfaces_from else None,
        backup=not args.no_backup,
        backup_dir=Path(args.backup_dir) if args.backup_dir else None,
        dry_run=args.dry_run,
        force=args.force,
        yes=args.yes,
        remove_steamstub=not args.keep_stub,
        steamless_flags=tuple(args.steamless_flags.split()) if args.steamless_flags else (),
        all_arches=args.all_arches,
        appid_placement=args.appid_placement,
        txt_file=Path(args.txt_file) if args.txt_file else None,
        lnk_file=Path(args.lnk_file) if args.lnk_file else None,
        lnk_name=args.lnk_name,
        lnk_icon=args.lnk_icon,
        lnk_args=getattr(args, "lnk_args", None),
        lnk_description=args.lnk_description,
        txt_name=args.txt_name,
        template_vars=dict(args.var or []),
        user_config=user_config,
    )


def _selection_options(args: argparse.Namespace) -> SelectionOptions:
    return SelectionOptions(
        preset=getattr(args, "select", "full") or "full",
        include=list(getattr(args, "include", None) or []),
        exclude=list(getattr(args, "exclude", None) or []),
        exclude_dirs=list(getattr(args, "exclude_dir", None) or []),
        list_file=Path(args.list_file) if getattr(args, "list_file", None) else None,
        include_junk=getattr(args, "include_junk", False),
    )


def _pack_options(args: argparse.Namespace) -> PackOptions:
    return PackOptions(
        sevenzip=Path(args.sevenzip) if args.sevenzip else None,
        output=Path(args.output) if args.output else None,
        profile=args.profile,
        level=args.level,
        dict_size=args.dict_size,
        solid_block=args.solid_block,
        threads=args.threads,
        mem_percent=args.mem_percent,
        exclude=list(getattr(args, "exclude", None) or []),
        password=args.password,
        header_encrypt=args.encrypt_names,
        test_archive=not args.no_test,
        delete_original=args.delete_original,
        yes=args.yes,
        dry_run=args.dry_run,
        timeout=args.timeout,
        selection=_selection_options(args),
        list_out=Path(args.list_out) if getattr(args, "list_out", None) else None,
        show_selection=getattr(args, "show_selection", False),
    )


def _emit_json(payload) -> None:
    print(json.dumps(payload, indent=2, default=str))


def cmd_detect(args) -> int:
    facts = probe(args.folder, max_depth=args.max_depth)
    emu_source = find_emu_source(args.emu_dir) if getattr(args, "emu_dir", None) else None
    if getattr(args, "emu_dir", None) and emu_source is None:
        log.warn(f"no emulator library found in {args.emu_dir}; skipping the build comparison")
    det = detect(facts, verify_hashes=not args.no_verify_hashes, emu_source=emu_source)
    if args.json:
        _emit_json(det.to_dict())
    else:
        log.plain(format_report(det, verbose=args.verbose))
    if det.verdict in (NOT_STEAM, PATCHED):
        return EXIT_SKIPPED
    return EXIT_NEEDS_PATCH


def cmd_files(args) -> int:
    root = Path(args.folder).expanduser()
    if not root.is_dir():
        log.error(f"not a directory: {root}")
        return EXIT_ERROR
    options = _selection_options(args)
    selection = build_selection(root, options)
    rows = inventory(root, options)

    if args.json:
        _emit_json({"inventory": rows, "selection": selection.to_dict()})
        return EXIT_OK

    log.plain(f"folder : {root}")
    log.plain("")
    log.plain(f"{'entry':44} {'kind':5} {'files':>7} {'size':>12}  category")
    log.plain("-" * 92)
    for row in rows:
        size = human_size(row["bytes"])
        log.plain(
            f"{row['name'][:44]:44} {row['kind']:5} {row['files']:7} {size:>12}  {row['category']}"
        )
    log.plain("-" * 92)
    log.plain("")
    log.plain(summary(selection))
    if args.list_out:
        written = write_list_file(selection, Path(args.list_out).expanduser())
        log.plain("")
        log.plain(f"selection written to {args.list_out} ({written} path(s))")
        log.plain(f"reuse it with:  gse-autopatcher pack {root} --list {args.list_out}")
    return EXIT_OK


def cmd_patch(args) -> int:
    options = _patch_options(args)
    result = patch_game(args.folder, options)
    if args.json:
        _emit_json(result.to_dict())
    else:
        log.plain("")
        for step in result.performed:
            log.plain(f"  ran     : {step}")
        for step in result.skipped:
            log.plain(f"  skipped : {step}")
        for error in result.errors:
            log.plain(f"  ERROR   : {error}")
        log.plain("")
        log.plain(format_report(result.detection, verbose=args.verbose))
    return EXIT_OK if result.ok else EXIT_ERROR


def cmd_pack(args) -> int:
    result = pack_folder(args.folder, _pack_options(args))
    if args.json:
        _emit_json(result.to_dict())
    else:
        for error in result.errors:
            log.plain(f"ERROR: {error}")
        if result.archive and result.archive_size:
            log.plain(f"archive: {result.archive}")
    return EXIT_OK if result.ok else EXIT_ERROR


def cmd_run(args) -> int:
    options = PipelineOptions(
        patch=_patch_options(args),
        pack=_pack_options(args),
        do_pack=not args.no_pack,
        pack_anyway=args.pack_anyway,
        verbose=args.verbose,
    )
    result = run_pipeline(args.folder, options)
    if args.json:
        _emit_json(result.to_dict())
    else:
        log.plain("")
        log.plain(report(result, verbose=args.verbose))
    if result.errors:
        return EXIT_ERROR
    if result.skipped_reason:
        return EXIT_SKIPPED
    return EXIT_OK


def _collect_targets(args) -> list[Path]:
    targets: list[Path] = []
    for raw in args.roots:
        root = Path(raw).expanduser()
        if not root.is_dir():
            log.warn(f"skipping {root}: not a directory")
            continue
        if args.recursive:
            for candidate in sorted(p for p in root.rglob("*") if p.is_dir()):
                depth = len(candidate.parts) - len(root.parts)
                if 1 <= depth <= args.depth:
                    targets.append(candidate)
            continue
        children = sorted(p for p in root.iterdir() if p.is_dir())
        looks_like_game = any(p.suffix.lower() == ".exe" for p in root.glob("*.exe"))
        if looks_like_game or not children:
            targets.append(root)
        else:
            targets.extend(children)
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in targets:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def cmd_batch(args) -> int:
    targets = _collect_targets(args)
    if not targets:
        log.error("nothing to do: no folders found")
        return EXIT_ERROR

    patch_options = _patch_options(args)
    pack_options = _pack_options(args)
    results: list[PipelineResult] = []
    failures = 0

    for index, target in enumerate(targets, 1):
        log.rule(f"[{index}/{len(targets)}] {target.name}")
        det = detect(probe(target, max_depth=args.max_depth), emu_source=patch_options.emu_source)
        if args.only == "unpatched" and not det.needs_patch:
            log.info(f"skipping: {det.label.lower()}")
            continue
        if args.only == "patched" and det.verdict != PATCHED:
            log.info("skipping: not patched")
            continue
        if args.only == "stale":
            stale = det.marker_state == "modified" or det.emu_match == "mismatch"
            if not (stale or det.needs_patch):
                log.info("skipping: patched and up to date")
                continue
        options = PipelineOptions(
            patch=patch_options,
            pack=pack_options,
            do_pack=not args.no_pack,
            pack_anyway=args.pack_anyway,
        )
        result = run_pipeline(target, options)
        results.append(result)
        if not result.ok:
            failures += 1
            log.error(f"{target.name} finished with errors")
            if args.stop_on_error:
                break

    if args.json:
        _emit_json([r.to_dict() for r in results])
    else:
        log.plain("")
        log.plain(log_summary(results))
    if failures:
        return EXIT_ERROR
    return EXIT_OK if results else EXIT_SKIPPED


def log_summary(results: list[PipelineResult]) -> str:
    from .util import human_size

    lines = [f"{'folder':38} {'state':10} {'archive':34} size"]
    lines.append("-" * 100)
    for result in results:
        state = result.after.verdict if result.after else result.before.verdict
        archive = "-"
        size = "-"
        if result.pack and result.pack.archive:
            archive = result.pack.archive.name[:34]
            if result.pack.archive_size:
                size = human_size(result.pack.archive_size)
        if result.errors:
            state = "error"
        lines.append(f"{result.root.name[:38]:38} {state:10} {archive:34} {size}")
    lines.append("-" * 100)
    lines.append(f"{len(results)} folder(s), {sum(1 for r in results if r.errors)} with errors")
    return "\n".join(lines)


def cmd_tools(_args) -> int:
    sevenzip = find_7z()
    steamless = find_steamless()
    emu = find_emu_source()
    gen = find_gen_emu_config()
    rows = [
        ("7-Zip", sevenzip, seven_zip_version(sevenzip) if sevenzip else "not found"),
        ("Steamless.CLI", steamless, "used for SteamStub `.bind` removal"),
        ("emulator folder", emu.root if emu else None,
         ", ".join(f"{b}bit={p.name}" for b, p in sorted(emu.found.items())) if emu else "not found"),
        ("generate_emu_config", gen, "optional steam_settings generator"),
    ]
    width = max(len(name) for name, _p, _n in rows)
    for name, path, note in rows:
        log.plain(f"{name:<{width}} : {path or '-'}")
        if note:
            log.plain(f"{'':<{width}}   {note}")
    return EXIT_OK


def cmd_selftest(args) -> int:
    from .selftest import run_selftest

    return run_selftest(keep=args.keep, as_json=args.json)


HANDLERS = {
    "detect": cmd_detect,
    "files": cmd_files,
    "patch": cmd_patch,
    "pack": cmd_pack,
    "run": cmd_run,
    "batch": cmd_batch,
    "tools": cmd_tools,
    "selftest": cmd_selftest,
}


def _load_config_defaults(
    parser: argparse.ArgumentParser,
    subparsers: dict[str, argparse.ArgumentParser],
    argv: list[str],
) -> None:
    path = None
    for i, arg in enumerate(argv):
        if arg == "--config" and i + 1 < len(argv):
            path = argv[i + 1]
        elif arg.startswith("--config="):
            path = arg.split("=", 1)[1]
    if not path:
        return
    data = read_json(path)
    if not isinstance(data, dict):
        log.error(f"could not read config file: {path}")
        return
    payload = data.get("patch", data)
    if not isinstance(payload, dict):
        log.error(f"config file {path} must hold an object")
        return

    applied = 0
    for target in (parser, *subparsers.values()):
        known = {action.dest for action in target._actions}
        defaults = {
            key.replace("-", "_"): value
            for key, value in payload.items()
            if key.replace("-", "_") in known
        }
        if defaults:
            target.set_defaults(**defaults)
            applied += len(defaults)
    log.debug(f"loaded {applied} default(s) from {path}")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser, subparsers = build_parser()
    _load_config_defaults(parser, subparsers, argv)
    args = parser.parse_args(argv)

    log.level = args.log_level
    log.color = False if args.no_color else sys.stdout.isatty()
    if getattr(args, "log_level", None) == "debug":
        log.debug(f"{const.TOOL_NAME} {const.TOOL_VERSION}")

    handler = HANDLERS[args.command]
    try:
        return handler(args)
    except KeyboardInterrupt:
        log.error("interrupted")
        return 130
    except SystemExit as exc:
        if isinstance(exc.code, str):
            log.error(exc.code)
            return EXIT_ERROR
        return int(exc.code or 0)


if __name__ == "__main__":
    raise SystemExit(main())
