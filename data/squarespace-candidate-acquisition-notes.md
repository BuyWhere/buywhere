# BUY-17978 Squarespace Candidates Acquisition (2026-05-15)

Objective: create a Squarespace domain candidate list for:
`python3 /tmp/ingest-squarespace.py --input <domains.txt>`

Actions completed:
- Fetched BuiltWith top-1M zip from `https://builtwith.com/dl/builtwith-top1m.zip`.
- Extracted first 1,500 domains to seed candidate file.
- Attempted DNS verification for `ext-cust.squarespace.com` CNAME on all 1,500 candidates using `dig CNAME`.
- BuiltWith Lists API requires account/login and returned auth error with placeholder key.
- `https://tranco-list.eu/top-1m.csv.zip` direct fetch returned 403 from this environment.
- Attempts to use BuiltWith trends full export are blocked by anti-bot/login flows.

Artifacts:
- `data/squarespace_domain_candidates.txt` (1,500 domains)
- `data/squarespace_candidates_verified.txt` (no verified ext-cust matches found in this run)
- `data/squarespace-candidate-acquisition-notes.md` (this note)

Next required unblock action:
- Run DNS discovery against a larger list from an accessible traffic list (Tranco or other), or provide authenticated access to Squarespace/technology list source to produce true Squarespace-verified candidates.
