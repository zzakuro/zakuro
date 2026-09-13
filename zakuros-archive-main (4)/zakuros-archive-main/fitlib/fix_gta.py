#!/usr/bin/env python3
"""
Surgical fix for GTA entries in merged_enriched.json.

Problems found:
1. "Grand Theft Auto" (original 1997) absorbed GTA V sources
2. Several duplicate/variant entries need merging into canonical cards
3. GTA II has wrong steamId (GTA III's ID)

Run from fitlib/ directory:
    python3 fix_gta.py
"""
import json, urllib.parse
from pathlib import Path

INPUT_PATH = Path("public/merged_enriched.json")

def get_dn(url):
    if 'dn=' in url:
        dn = url.split('dn=')[1].split('&')[0]
        return urllib.parse.unquote_plus(dn).lower()
    return url.lower()

def is_gta5_source(src):
    name = get_dn(src.get('url', ''))
    return ('grand theft auto v' in name or 'gta v' in name or
            'gta 5' in name or 'grand theft auto 5' in name)

def move_sources(from_game, to_game, filter_fn=None):
    existing_urls = {s['url'] for s in to_game['downloadSources']}
    moved = 0
    keep = []
    for src in from_game['downloadSources']:
        if filter_fn and not filter_fn(src):
            keep.append(src)
            continue
        if src['url'] not in existing_urls:
            to_game['downloadSources'].append(src)
            existing_urls.add(src['url'])
            moved += 1
    from_game['downloadSources'] = keep
    return moved

def merge_all_into(from_game, to_game):
    """Move all sources from from_game into to_game."""
    existing_urls = {s['url'] for s in to_game['downloadSources']}
    moved = 0
    for src in from_game['downloadSources']:
        if src['url'] not in existing_urls:
            to_game['downloadSources'].append(src)
            existing_urls.add(src['url'])
            moved += 1
    from_game['downloadSources'] = []
    return moved

def main():
    print(f"Loading {INPUT_PATH}...")
    games = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    by_id = {g['id']: g for g in games}
    print(f"  {len(games)} games loaded")

    drop_ids = set()

    # ── Fix 1: Move GTA V sources out of "Grand Theft Auto" (original) ──────
    gta1 = by_id.get('grand-theft-auto')
    gta5_legacy = by_id.get('grand-theft-auto-v-legacy')
    if gta1 and gta5_legacy:
        moved = move_sources(gta1, gta5_legacy, filter_fn=is_gta5_source)
        print(f"Moved {moved} GTA V sources from 'Grand Theft Auto' -> 'GTA V Legacy'")
        print(f"  'Grand Theft Auto' now has {len(gta1['downloadSources'])} sources remaining")

    # ── Fix 2: Merge GTA San Andreas duplicates ──────────────────────────────
    sa = by_id.get('grand-theft-auto-san-andreas')
    for dup_id in [
        'grand-theft-auto-san-andreas-definitive-remastered-edition',
        'gtagrand-theft-auto-san-andreas',
    ]:
        dup = by_id.get(dup_id)
        if sa and dup:
            moved = merge_all_into(dup, sa)
            print(f"Merged {moved} sources from '{dup_id}' -> San Andreas")
            drop_ids.add(dup_id)

    # ── Fix 3: Merge GTA Trilogy duplicates ──────────────────────────────────
    trilogy = by_id.get('grand-theft-auto-the-trilogy---the')
    for dup_id in [
        'grand-theft-auto-the-original-trilogy',
        'grand-theft-auto-the-trilogy---the-definitive-barbra-streisand-edition',
        'grand-theft-auto-the-trilogy-the-barbra-streisand-edition-windows-7-fix',
    ]:
        dup = by_id.get(dup_id)
        if trilogy and dup:
            moved = merge_all_into(dup, trilogy)
            print(f"Merged {moved} sources from '{dup_id}' -> Trilogy")
            drop_ids.add(dup_id)

    # ── Fix 4: Merge Vice City anniversary into Vice City ────────────────────
    vc = by_id.get('grand-theft-auto-vice-city')
    vc_ann = by_id.get('grand-theft-auto-vice-city-10-year-anniversary-pc-edition')
    if vc and vc_ann:
        moved = merge_all_into(vc_ann, vc)
        print(f"Merged {moved} sources from Vice City Anniversary -> Vice City")
        drop_ids.add('grand-theft-auto-vice-city-10-year-anniversary-pc-edition')

    # ── Fix 5: Merge NVE modpack into GTA V Legacy ───────────────────────────
    nve = by_id.get('grand-theft-auto-v-gta-5-170-nve-platinum-modpack')
    if gta5_legacy and nve:
        moved = merge_all_into(nve, gta5_legacy)
        print(f"Merged {moved} sources from NVE Modpack -> GTA V Legacy")
        drop_ids.add('grand-theft-auto-v-gta-5-170-nve-platinum-modpack')

    # ── Fix 6: Fix GTA II wrong steamId ──────────────────────────────────────
    gta2 = by_id.get('grand-theft-auto-ii')
    if gta2:
        # GTA II's real Steam appid - it's free on Steam
        gta2['steamId'] = 12210  # actually this is GTA IV's ID
        # GTA II is free/not on Steam as a paid product, clear the wrong ID
        gta2['steamId'] = None
        gta2['coverImage'] = ''
        print("Cleared wrong steamId from GTA II")

    # Remove empty/merged cards
    games = [g for g in games if g['id'] not in drop_ids]
    # Also remove cards that ended up with 0 sources after fixes
    before = len(games)
    games = [g for g in games if len(g.get('downloadSources', [])) > 0
             or not g['id'].startswith('grand-theft-auto')]
    removed = before - len(games)
    if removed:
        print(f"Removed {removed} empty GTA card(s)")

    print(f"\nFinal GTA cards:")
    for g in games:
        if 'grand theft auto' in g['title'].lower() or g['title'].lower().startswith('gta'):
            print(f"  {g['title']} | sources: {len(g.get('downloadSources',[]))} | steamId: {g.get('steamId')}")

    INPUT_PATH.write_text(json.dumps(games, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved. {len(games)} total games.")

if __name__ == "__main__":
    main()
