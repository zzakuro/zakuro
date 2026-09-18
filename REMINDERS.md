# Reminders

## Scrape more NSFW games
- [ ] Scrape additional adult/NSFW games later from **https://gamebounty.world/?adult=only**
  - Source technique (verified earlier): pull Steam `appid`, then CDN art —
    `logo.png`, `library_hero.jpg`, `header.jpg`, `capsule_616x353.jpg`, `library_600x900.jpg`
    (`https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/...`, newer path `shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/...`).
  - Context: catalog currently has ~270 NSFW titles; EroTorrent.ru has 4,631 games of which
    ~2,623 still lack Steam metadata (no `steamId`, no cover/screenshots).

## Catalog tooling (run from `fitlib/`)
- `npm test` → `server/test_cleanup.ts` (offline regression tests, 57 checks).
- `npm run check:catalog` → `server/checkCatalog.ts` read-only audit; writes
  `data/snapshots/catalog-<stamp>.json` + `latest.json`. Safe while the grind writes.
  Hard-fails on structural corruption (dup ids, pending self-heal); warns on the known
  edition-mismatch backlog (~70 shared appids) and unknown appids (~243).
- Persist-time `selfHealCatalog()` (in `server/sources.ts`) runs before every catalog
  write: prunes foreign filler, folds bilingual dupes, stabilizes same-appid dupes,
  realigns mismatched covers, and strips `classic` from any game with a `steamId`.
- List payload omits `summary` (carries `hasSummary`); client lazy-loads text via
  `GET /api/games/:id/summary`. `/api/games/:id` still returns the full record.
- `npm run fix:appids` → `server/fixAppidIssues.ts` appid resolver (dry-run by default).
  Flags: `--apply` (write), `--online` (verify appids against the live store),
  `--resolve` (re-search cleared titles for the right appid), `--limit N` (cap live calls).
  Refuses to write while `data/.grind-active` exists and backs up the catalog first.
  After the grind: `npm run fix:appids -- --online --apply --resolve`, then re-run the checker.
- Post-grind chain: cover watcher → `ZakuroIgdbCoverFill` (IGDB metadata fill) → catalog checker.
- IGDB fill (`Temp/opencode/igdb-cover-fill.ts`) now also fills `trailers` from IGDB `videos`
  (mapped to YouTube embeds) when a game has none; Steam-sourced mp4 trailers still win.

## UI features
- Detail page (`GameDetailView`) uses the Steam transparent `logo.png` as the title art when a
  `steamId` exists (falls back to the text title), and the trailer lightbox plays both direct
  video files (Steam mp4/webm) and embed URLs (YouTube/Vimeo) via an `<iframe>`.
- `SourcesView` shows a public **Catalog health** panel (field-coverage bars) backed by
  `GET /api/catalog/health`, which serves `data/snapshots/latest.json` (run the checker to refresh).
- Unknown routes render a 404 page (`NotFound` in `App.tsx`).

## Deployment knobs (`fitlib/`)
- `VITE_CATALOG_URL` — absolute games JSON URL (default `/api/games`).
- `VITE_CATALOG_VERSION_URL` — version-string URL; unset/"off" disables change-polling (static).
- `VITE_API_BASE_URL` — origin for comments/ratings API (default same-origin).
- Community persistence goes through `CommunityStore` (`server/communityStore.ts`); JSON files by default.

## Known data-quality backlog
- [ ] ~62 appids are shared across dissimilar titles (edition mismatches); `npm run fix:appids`
  resolves ~58 offline (clears 64 rows) — the other 4 need `--online` or manual review.
- [ ] ~243 `steamId`s absent from `data/steam_apps.json`; `npm run fix:appids -- --online` verifies them.
- [ ] EroTorrent adult titles (~2,600) still need a doujin/adult metadata source.
