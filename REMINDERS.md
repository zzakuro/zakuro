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
- Post-grind chain: cover watcher → `ZakuroIgdbCoverFill` (IGDB metadata fill) → catalog checker.

## Deployment knobs (`fitlib/`)
- `VITE_CATALOG_URL` — absolute games JSON URL (default `/api/games`).
- `VITE_CATALOG_VERSION_URL` — version-string URL; unset/"off" disables change-polling (static).
- `VITE_API_BASE_URL` — origin for comments/ratings API (default same-origin).
- Community persistence goes through `CommunityStore` (`server/communityStore.ts`); JSON files by default.

## Known data-quality backlog
- [ ] ~70 games share a `steamId` with a dissimilar title (edition mismatches) — see checker snapshot.
- [ ] ~243 `steamId`s absent from `data/steam_apps.json`.
- [ ] EroTorrent adult titles (~2,600) still need a doujin/adult metadata source.
