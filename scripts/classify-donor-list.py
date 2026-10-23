"""Classify Jenn's donor-tracking list into a reviewable CSV (no database involved).
   python scripts/classify-donor-list.py   ->  data/donor-list-classified.csv
Heuristic only: a human (Jenn) should confirm the status column before anything is seeded."""
import csv, re, pathlib

src = pathlib.Path('data/jenn-donor-list.txt').read_text(encoding='utf8').splitlines()
rows = []
for n, raw in enumerate([l for l in src if l.strip()], 1):
    line = raw.strip()
    touched = line.startswith('✅')
    text = line.lstrip('✅').strip()
    low = text.lower()
    declined = bool(re.search(r'\bdeclined\b', low)) or bool(re.search(r'\?\?\(.*\)\s*no\s*$', low)) or low.endswith(' no')
    yes = bool(re.search(r'\byes\b', low))
    unsure = '??' in text
    if declined:
        status = 'declined'
    elif yes and not unsure:
        status = 'confirmed'
    elif unsure:
        status = 'unconfirmed (??)'
    elif touched:
        status = 'contacted, no answer recorded'
    else:
        status = 'not yet contacted'
    value = re.search(r'\$\s?([\d,]+)', text)
    emails = ';'.join(re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', text))
    phones = ';'.join(re.findall(r'\b\d{3}-\d{3}-\d{4}\b', text))
    # best-effort display name: text before the first status word / bracket
    name = re.split(r'\s+(?:YES|yes|Yes)\b|[-–]\s*(?:YES|Yes|yes)\b|\(|\?\?|\s-\s?[A-Z][a-z]+$', text)[0].strip(' -:')
    done = bool(re.search(r'\bDONE\b', text))
    logistics = ';'.join(k for k, rx in [('picked up/ready', r'ready for pickup|pick up|picked up|pickup'), ('mailing', r'\bmailing\b'), ('dropping off', r'dropping off|drop off')] if re.search(rx, text, re.I))
    rows.append(dict(n=n, status=status, guess_name=name, stated_value_usd=value.group(1).replace(',', '') if value else '', done='yes' if done else '', logistics=logistics, private_emails=emails, private_phones=phones, raw=text))

out = pathlib.Path('data/donor-list-classified.csv')
with out.open('w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)

from collections import Counter
c = Counter(r['status'] for r in rows)
print(len(rows), 'lines'); [print(f'  {k}: {v}') for k, v in c.most_common()]
print('confirmed with a stated dollar value:', sum(1 for r in rows if r['status'] == 'confirmed' and r['stated_value_usd']))
print('confirmed without a stated value:', sum(1 for r in rows if r['status'] == 'confirmed' and not r['stated_value_usd']))
