# gse-autopatcher

Detects whether a game folder is already patched with a Goldberg-style Steam
emulator, patches it when it is not, drops in your two extra files (a `.txt`
and a Windows shortcut), compresses the result with 7-Zip and removes the
source folder once the archive has been verified.

Zero third-party Python dependencies. Windows-first, but the detection and
compression parts work anywhere; only the `.lnk` creation needs Windows.

## What it is built from

| Upstream project | Role here |
| --- | --- |
| [Detanup01/gbe_fork](https://github.com/Detanup01/gbe_fork) | the emulator itself: `steam_api*.dll`, `steam_settings/` layout, `steam_interfaces.txt` format, and the 7-Zip packing style (`-t7z -m0=LZMA2 -mmt`) |
| [alex47exe/gse_fork_tools](https://github.com/alex47exe/gse_fork_tools) | `generate_emu_config`, optionally driven to build a full `steam_settings/` (`-cdx -rne -acw -clr <appid>`, run in the game folder) |
| [atom0s/Steamless](https://github.com/atom0s/Steamless) | SteamStub `.bind` section detection and removal, invoked through `Steamless.CLI.exe` |
| [Mush-iii/RUNEAutoCracker](https://github.com/Mush-iii/RUNEAutoCracker) | the shape of the tool: folder in, app id lookup, profile choice, SHA-256 self-update, crack-only export |
| 7-Zip (`7z.exe` / `7za.exe`) | the compressor and the archive integrity check |

The tool never downloads anything. It only *drives* binaries and folders you
already have, which you point it at.

## Install

```bat
python -m autopatcher selftest        :: 73 self checks, builds its own test game
python -m autopatcher tools           :: shows which external tools were found
```

Or from a checkout, `gse-autopatcher.cmd` wraps `python -m autopatcher %*`.

## Commands

```
detect <folder>     report patched / partial / unpatched with the evidence
files   <folder>    show what is in the folder and what would be archived
patch  <folder>     apply the patch (idempotent, re-runs are no-ops)
pack   <folder>     compress with 7-Zip, verify, optionally delete the source
run    <folder>     detect -> patch -> extras -> compress -> delete
batch  <root...>    the same pipeline over many folders
tools               show discovered 7-Zip / Steamless / emulator / generator
selftest            build a synthetic game and run the whole pipeline on it
```

Exit codes: `0` done, `1` error, `2` nothing to do (not a Steam game / already
patched), `3` `detect` says a patch is needed — handy in CI.

## Choosing what goes into the archive

Every compression command (`pack`, `run`, `batch`) takes the same selection
flags, and `files` shows the result without writing anything.

```bat
:: what is in here, and what would be archived?
gse-autopatcher files "D:\Games\Hades"

:: only the emulator payload (the "crack only" export)
gse-autopatcher files "D:\Games\Hades" --select crack-only

:: skip the noise
gse-autopatcher run "D:\Games\Hades" --exclude-dir logs --exclude-dir "*.pdb" -x "*.bk"

:: only these paths
gse-autopatcher run "D:\Games\Hades" --include "Hades.exe" --include "data/*"

:: save the current selection, then reuse it later
gse-autopatcher files "D:\Games\Hades" --exclude-dir logs --list-out keep.txt
gse-autopatcher pack  "D:\Games\Hades" --list keep.txt
```

| Flag | Meaning |
| --- | --- |
| `--select full` | everything (default) |
| `--select crack-only` | only `steam_settings/`, the emulator libraries and their config — no game files, no marker (it gets copied into other people's folders, where its hashes would be wrong) |
| `--select game-only` | everything except the emulator payload |
| `--include PATTERN` | only include what matches (repeatable). A pattern with `/` matches the path relative to the game folder, without it matches a file name anywhere |
| `-x, --exclude PATTERN` | exclude what matches (repeatable) |
| `--exclude-dir NAME` | exclude a folder and everything under it |
| `--list FILE` | read paths/globs from a file: `# comment`, `-pattern` excludes, `/folder` excludes a folder |
| `--list-out FILE` | write the resolved selection so it can be replayed with `--list` |
| `--include-junk` | also archive the tool's own leftovers (`*.autopatch-backup`, `*.deleting-*`, `_autopatcher`) and system folders |
| `--show-selection` | print the breakdown even for a full archive |

Anything other than a plain full archive is handed to 7-Zip as an explicit
list file, so what `files` prints is exactly what lands in the `.7z`. A
selection that ends up empty is refused instead of quietly archiving nothing.
An impossible `--include` is an error, never a silent "archive everything".

## Detection: is it already patched?

`detect` answers this from several independent signals and shows its work —
every claim in `evidence:` is a fact it read from the folder.

```
folder : D:\Games\Hades
name   : Hades
appid  : 1145360  [steam_appid.txt, marker]
bits   : 64-bit primary
state  : ALREADY PATCHED (confidence 0.99)
patcher: gse-autopatcher - patched by this tool
marker : verified - v1, all 6 hashed file(s) match
emu    : match
```

* **which patcher** — `gse-autopatcher`, `gbe-fork`, `goldberg-classic`
  (pre-fork), `rune` (`.rne` / `steam_emu.ini`), `drm-removed-only` (SteamStub
  gone, no emulator) or `unknown-emulator`, decided from the layout on disk.
* **marker state** — `absent`, `verified` (every recorded SHA-256 still matches),
  `modified` (a patched file was edited or removed) or `foreign` (a marker from
  another tool). A `modified` marker is *not* treated as "already patched".
* **emulator build** — with `--emu-dir` the deployed `steam_api*.dll` is
  compared byte for byte with the build you configured: `match`, `mismatch`
  (the folder is patched with an older/other emu, so `emu_dll` shows up as
  missing work) or `unknown`.
* `.bind` section, imports, bitness, `steam_settings` contents, appid sources —
  as described above.

A patched folder is skipped by `run` and `batch` unless you pass `--force`;
`batch --only` accepts `all`, `unpatched`, `patched` and `stale` (patched but
modified, or built with a different emulator).

## How detection works

`detect` never guesses from a single signal. Every claim in the `evidence:`
list is a fact it read from the folder:

* **`.bind` section in the game executable** — the marker every SteamStub
  variant (1.0 → 3.1) leaves behind, and the same one Steamless refuses to
  work without. Read straight out of the PE section table.
* **imports** — the game executable is parsed for `steam_api64.dll` /
  `steam_api.dll` / `steamclient*.dll` (static *and* delay imports), so
  dynamically loaded Steam API is noticed too.
* **PE bitness** — decides whether the 32- or 64-bit emulator library is the
  right one to install.
* **emulator vs. original library** — the `steam_api*.dll` next to the game is
  classified by Authenticode signature, size and embedded emulator strings, so
  "half patched" folders are visible.
* **`steam_settings/` content** — `steam_interfaces.txt`, `configs.*.ini`,
  `appinfo.vdf`, … each one is a required piece.
* **which patcher** — the layout on disk identifies gbe_fork, pre-fork
  Goldberg, RUNE, a bare Steamless run, or this tool (see above).
* **the marker file** `.gse_autopatch.json` written by this tool, including
  SHA-256 hashes, so a re-run knows the folder is already done *and* has not
  been modified since.
* **the configured emu build** — with `--emu-dir` the deployed library is
  compared byte for byte, so "patched, but with last month's build" is visible.
* **app id sources** — `steam_appid.txt`, `appinfo.vdf`, `configs.app.ini`,
  `appmanifest_*.acf` from a Steam library layout, or the marker.

Verdicts (`state:` in the report, `verdict` in JSON): `patched`, `partial`
(some pieces present), `unpatched`, `not-steam` (no Steam integration at all),
`unknown` (no game executable).

## The patch steps

| Step | What happens |
| --- | --- |
| `backup` | the pre-patch executable and any original Steam libraries are copied to `<game>.autopatch-backup/<timestamp>/` — outside the game folder, so they never end up in the archive |
| `drm_removal` | if a `.bind` section is present, `Steamless.CLI.exe` is run on the executable and `<exe>.unpacked.exe` replaces it; the result is re-parsed to confirm the section is gone |
| `emu_dll` | the emulator library matching the game bitness is copied in, overwriting (and backing up) a previous one |
| `steam_settings` | `generate_emu_config` is driven when available, otherwise the folder is created and the emulator's `steam_settings.EXAMPLE` template is copied over |
| `interfaces` | `steam_settings/steam_interfaces.txt` is generated — a pure-python port of gbe_fork's `generate_interfaces`, reading the *original* Valve library first, then the emulator build, then the game binary as a last resort |
| `appid` | `steam_settings/steam_appid.txt` (or the root, or both) |
| `extras` | your `.txt` and your shortcut, see below |
| `marker` | `.gse_autopatch.json` with app id, bitness, steps run and file hashes |

Every step is skipped when the folder already satisfies it, which is what makes
a second `run` a no-op.

## The two extra files

**Text file** — `--txt-file payload.txt` copies it in and substitutes tokens,
so one template serves every game:

```
Game   : {GAME}          FOLDER   : {FOLDER}
AppID  : {APPID}         EXE      : {EXE}
Bitness: {BITNESS}       DATE     : {DATE}
```

`{{` and `}}` produce literal braces, unknown tokens are left alone, and
`--var KEY=VALUE` adds your own (they become `{KEY}`).

**Shortcut** — either copy yours in with `--lnk-file`, or let the tool build
one with `--lnk-name "Play.lnk"` (plus `--lnk-icon`, `--lnk-args`,
`--lnk-description`). Generation goes through `WScript.Shell` via a temporary
PowerShell script, so no `pywin32` needed; the result is verified to be a real
shell link before the step is reported as done.

## Compression and cleanup

```bat
gse-autopatcher run "D:\Games\Hades" --profile high --delete-original -y
```

* profiles: `store`, `fast`, `normal` (default, `-mx=6 d=128m`), `high`
  (`-mx=7 d=256m`), `max` (`-mx=9 d=384m`) — the LZMA2/dictionary layout
  mirrors gbe_fork's own `package_win.bat`.
* `--threads`, `--mem-percent`, `--dict`, `--solid`, `-p PASSWORD`,
  `--encrypt-names`, `--timeout` are all exposed, plus the selection flags
  above.
* the archive is tested with `7z t` before anything is deleted;
  `--no-test` turns that off and then deletion is refused.
* the archive may not be written inside the source folder, and the source is
  only removed after a successful verification and a confirmation (`-y` skips
  the prompt).
* if a patch step failed, compression is skipped unless you pass
  `--pack-anyway`.

## Examples

```bat
:: what state is this folder in, and is it the emu build I configured?
gse-autopatcher detect "D:\Games\Hades" --emu-dir "D:\tools\emu" -v

:: what would go into the archive?
gse-autopatcher files "D:\Games\Hades" --select crack-only

:: patch only, no compression, from an emulator build folder
gse-autopatcher patch "D:\Games\Hades" ^
  --emu-dir "D:\tools\gbe_fork\emu-win-x86-64\release" ^
  --steamless "D:\tools\steamless\Steamless.CLI.exe" ^
  --appid 1145360 --txt-file payload.txt --lnk-name "Hades.lnk"

:: full pipeline for a whole library, only the unpatched ones
gse-autopatcher batch "D:\Games" --recursive --only unpatched ^
  --config config.json -y

:: keep the archive, keep the folder
gse-autopatcher pack "D:\Games\Hades" -o "D:\Releases\Hades.7z" --profile max
```

### Defaults from a file

`--config config.json` fills in every option (see `config.example.json`);
command line flags always win.

### Environment variables

`SEVENZIP`, `STEAMLESS`, `GBE_EMU_DIR`, `GSE_GEN_EMU_CONFIG` are used when the
matching flag is not given.

### App id lookup

`--appid N` skips the network entirely. `--lookup-appid "Hades"` (or a bare app
id) asks the Steam store and fills in the id and name.

## Layout

```
autopatcher/
  pe.py          zero-dependency PE reader (sections, imports, signatures, overlay)
  probe.py       finds the game executable and collects every fact about a folder
  detect.py      state + confidence + evidence, patcher fingerprint, missing steps
  patch.py       the patch steps, backups and the marker
  interfaces.py  port of gbe_fork's generate_interfaces
  extras.py      .txt templating and .lnk creation
  select.py      presets, glob include/exclude, list files, the `files` inventory
  pack.py        7-Zip command building, selection list file, verification, deletion
  pipeline.py    detect -> patch -> compress orchestration
  cli.py         argparse front end, config file, exit codes
  external.py    discovery of 7-Zip / Steamless / emulator / generator
  steamapi.py    optional store lookups
  selftest.py    synthetic PE builder + 73 end-to-end checks
```

## Notes

* Point it at games you own. Emulator patching is for offline play and backup
  workflows; redistributing patched commercial builds is not legal.
* The backups live next to the game folder on purpose: `<game>.autopatch-backup/`.
  Keep them until you have tested the archive.
* `--dry-run` prints the whole plan — including the exact 7-Zip command — and
  writes nothing.
