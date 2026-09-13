import json, re, time, urllib.request, urllib.parse

with open("public/merged.json") as f:
    games = json.load(f)

needs = list(range(len(games)))
print(f"Total games: {len(games)} — need Steam ID: {len(needs)}")
filled = 0

def search_steam(query):
    params = urllib.parse.urlencode({"term": query, "l": "english", "cc": "US"})
    req = urllib.request.Request(
        f"https://store.steampowered.com/api/storesearch/?{params}",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    r = urllib.request.urlopen(req, timeout=10)
    return json.loads(r.read())

def best_match(results, query):
    query_words = set(query.lower().split())
    for item in results.get("items", []):
        name_words = set(item["name"].lower().split())
        if len(query_words & name_words) / max(len(query_words), 1) >= 0.6:
            return item["id"]
    return None

for idx, i in enumerate(needs):
    title = games[i].get("title", "")
    if not title:
        continue

    clean = re.split(r'\s[–\-:]\s', title)[0]
    clean = re.sub(r'[™®©]', '', clean).strip()
    clean2 = re.sub(
        r'\b(complete|definitive|enhanced|remastered|deluxe|goty|gold|'
        r'anniversary|ultimate|directors cut|collectors|premium)\b.*',
        '', clean, flags=re.IGNORECASE
    ).strip()
    clean3 = re.sub(r'\s+(I{1,3}|IV|V|VI{0,3}|IX|X|\d+)$', '', clean2).strip()

    steam_id = None
    for query in dict.fromkeys([clean, clean2, clean3]):
        if not query or steam_id:
            continue
        retries = 3
        while retries > 0:
            try:
                results = search_steam(query)
                steam_id = best_match(results, query)
                time.sleep(0.2)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"\n  Rate limited — sleeping 60s...")
                    time.sleep(60)
                    retries -= 1
                else:
                    retries = 0
            except Exception as e:
                print(f"  Error on '{query}': {e}")
                retries = 0

    if steam_id:
        games[i]["steamId"] = steam_id
        filled += 1
    else:
        games[i]["steamId"] = None  # mark as checked so re-runs skip it

    if (idx + 1) % 200 == 0:
        print(f"  {idx+1}/{len(needs)} done — filled: {filled}")
        with open("public/merged.json", "w") as f:
            json.dump(games, f)

with open("public/merged.json", "w") as f:
    json.dump(games, f)

print(f"\nDone. Filled {filled} new Steam IDs.")
print(f"Still missing: {sum(1 for g in games if not g.get('steamId'))}")
