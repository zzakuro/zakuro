import json
with open(r"zakuros-archive-main (4)\zakuros-archive-main\fitlib\merged_enriched.json") as f:
    data = json.load(f)

# Find all Silent Hill entries
silent_hill_entries = [e for e in data if 'silent' in (e.get('title') or '').lower() or 'silent' in (e.get('slug') or '').lower()]
print(f'Total Silent Hill entries: {len(silent_hill_entries)}')
for e in silent_hill_entries:
    print(f"slug={e.get('slug')}, gogId={e.get('gogId')}, title={e.get('title')}, quality={e.get('summary_quality')}, classic={e.get('classic_flag')}")