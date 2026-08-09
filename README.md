# arc-app-assets

Live data feeds for the Topside companion app, refreshed hourly by a GitHub
Action. The app reads these files directly, so this data updates without ever
shipping an app release.

## Feeds

| File | What it holds | Size |
|---|---|---|
| `feeds/map-conditions.json` | Every scheduled map condition with its map, start and end time | ~7 KB |
| `feeds/news.json` | Index of the latest 40 news articles, no bodies | ~22 KB |
| `feeds/news/<id>.json` | One article body, fetched only when a reader opens it | up to ~21 KB |

Raw URLs the app uses:

```
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/map-conditions.json
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news.json
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news/<id>.json
```

## Why hourly

`arcraiders.com/map-conditions` only publishes about 24 hours of schedule at a
time. Anything baked into the app would be wrong within a day, so the app holds
none of it.

## How it stays up without anyone watching

1. **A bad scrape writes nothing.** Each script checks it parsed a sane number
   of items before saving. Below the threshold it exits non-zero and the last
   good file stays exactly as it was.
2. **Two parsers for map conditions.** The primary one reads the JSON embedded
   in the page. If that shape changes, a second one reads the rendered cards.
3. **No churn.** A run that produces identical data makes no commit.
4. **Failures are loud.** A broken run opens a GitHub issue labelled
   `feed-failure`, and comments on it rather than opening duplicates.
5. **Staleness is an error.** The run fails if `map-conditions.json` is more
   than 6 hours old, so silence is treated as breakage.
6. **The schedule cannot be auto-disabled.** GitHub turns off cron workflows in
   repositories that see no activity for 60 days. This one commits most hours.
7. **The app degrades gracefully.** It caches the last good copy, so a failure
   here shows slightly old conditions rather than an empty screen.

## Running it by hand

```
node scripts/map-conditions.mjs
node scripts/news.mjs
```

Both write into `feeds/`. Neither takes arguments.

## Article bodies

An article body never changes once published, so `news.mjs` fetches each one
once and skips it forever after. A normal hourly run makes exactly one request
to the news list and nothing else.
