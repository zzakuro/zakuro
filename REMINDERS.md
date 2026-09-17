# Reminders

## Scrape more NSFW games
- [ ] Scrape additional adult/NSFW games later from **https://gamebounty.world/?adult=only**
  - Source technique (verified earlier): pull Steam `appid`, then CDN art —
    `logo.png`, `library_hero.jpg`, `header.jpg`, `capsule_616x353.jpg`, `library_600x900.jpg`
    (`https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/...`, newer path `shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/...`).
  - Context: catalog currently has ~270 NSFW titles; EroTorrent.ru has 4,631 games of which
    ~2,623 still lack Steam metadata (no `steamId`, no cover/screenshots).
