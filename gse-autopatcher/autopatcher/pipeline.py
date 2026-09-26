"""Full pipeline: detect -> patch -> extras -> compress -> delete source."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .detect import NOT_STEAM, PATCHED, Detection, detect, format_report
from .pack import PackOptions, PackResult, pack_folder
from .patch import PatchOptions, PatchResult, patch_game
from .probe import probe
from .util import log


@dataclass
class PipelineOptions:
    patch: PatchOptions = field(default_factory=PatchOptions)
    pack: PackOptions = field(default_factory=PackOptions)
    do_patch: bool = True
    do_pack: bool = True
    verbose: bool = False


@dataclass
class PipelineResult:
    root: Path
    before: Detection
    after: Detection | None = None
    patch: PatchResult | None = None
    pack: PackResult | None = None
    errors: list[str] = field(default_factory=list)
    skipped_reason: str = ""

    @property
    def ok(self) -> bool:
        return not self.errors and (self.patch is None or self.patch.ok) and (
            self.pack is None or self.pack.ok
        )

    def to_dict(self) -> dict:
        return {
            "root": str(self.root),
            "before": self.before.to_dict(),
            "after": self.after.to_dict() if self.after else None,
            "patch": self.patch.to_dict() if self.patch else None,
            "pack": self.pack.to_dict() if self.pack else None,
            "skipped_reason": self.skipped_reason,
            "errors": self.errors,
        }


def run_pipeline(root: str | Path, options: PipelineOptions | None = None) -> PipelineResult:
    options = options or PipelineOptions()
    root = Path(root).expanduser()
    log.rule(f"{root.name}")

    facts = probe(root)
    before = detect(facts)
    result = PipelineResult(root=root, before=before)

    if facts.errors or before.verdict == "unknown":
        result.errors.extend(facts.errors or before.reasons)
        return result

    if before.verdict == NOT_STEAM:
        result.skipped_reason = "no Steam integration found, nothing to do"
        log.warn(result.skipped_reason)
        return result

    if before.verdict == PATCHED and not options.patch.force:
        result.after = before
        if not options.do_pack or options.pack.dry_run:
            result.skipped_reason = "already patched"
            log.ok("already patched, skipping the patch step")
            return result
        log.ok("already patched, continuing to compression")
    elif options.do_patch:
        patch_result = patch_game(facts, options.patch)
        result.patch = patch_result
        result.errors.extend(patch_result.errors)
        result.after = detect(probe(facts.root))
        log.info(
            f"patch result: {result.after.verdict.upper()} "
            f"({len(patch_result.performed)} step(s) run, "
            f"{len(patch_result.skipped)} already satisfied)"
        )
    else:
        result.after = before

    if not options.do_pack:
        return result

    if result.errors and not options.patch.yes:
        log.warn("compression skipped because the patch step reported errors")

    if options.patch.dry_run:
        log.info("[dry-run] skipping compression")
        return result

    log.rule("compress")
    pack_result = pack_folder(facts.root, options.pack)
    result.pack = pack_result
    result.errors.extend(pack_result.errors)
    return result


def report(result: PipelineResult, verbose: bool = False) -> str:
    lines = [format_report(result.before, verbose=verbose)]
    if result.patch:
        if result.patch.performed:
            lines.append("steps run: " + ", ".join(result.patch.performed))
        for skipped in result.patch.skipped:
            lines.append(f"  skipped: {skipped}")
    if result.after:
        lines.append(f"after    : {result.after.verdict.upper()} "
                     f"(confidence {result.after.confidence:.2f})")
    if result.pack and result.pack.archive:
        lines.append(f"archive  : {result.pack.archive}")
        if result.pack.archive_size:
            lines.append(f"size     : {result.pack.archive_size} bytes "
                         f"({result.pack.ratio * 100:.1f}% of source)")
        if result.pack.verified:
            lines.append("verified : yes")
        if result.pack.deleted:
            lines.append("source   : deleted")
    for error in result.errors:
        lines.append(f"ERROR    : {error}")
    return "\n".join(lines)
