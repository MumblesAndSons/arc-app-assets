# arc-app-assets

Live data feeds for the Topside companion app, refreshed every 15 minutes by a
GitHub Action. The app reads these files directly, so this data updates without
ever shipping an app release.

## Feeds

| File | What it holds | Size |
|---|---|---|
| `feeds/map-conditions.json` | Every scheduled map condition with its map, start and end time | ~7 KB |
| `feeds/news.json` | Index of the latest 40 news articles, no bodies | ~20 KB |
| `feeds/news/<id>.json` | One article body, fetched only when a reader opens it | up to ~19 KB |

Raw URLs the app uses:

```
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/map-conditions.json
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news.json
https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news/<id>.json
```

## Why every 15 minutes

`arcraiders.com/map-conditions` only publishes about 24 hours of schedule at a
time. Anything baked into the app would be wrong within a day, so the app holds
none of it.

It also announces late. Replaying every snapshot this repository has committed,
27 of 138 conditions were first published less than two hours before they
started, and one turned up only after it had already begun. Hourly runs left the
app behind, so the job runs four times an hour.

## The schedule is built up, not copied

`feeds/map-conditions.json` is a running schedule. Each run MERGES the page into
the file and drops only the entries that have finished.

Two facts from the replay make that the right shape:

1. **The page under-reports.** The far end of its window is nearly empty and
   fills in as the hours approach, so any one snapshot is an under-count. A
   snapshot taken at 17:09 listed one condition for the 20:00 hour; by 20:34
   there were four.
2. **The schedule is append only.** Across 24 consecutive healthy snapshots
   spanning two days, not one future entry was ever withdrawn. So keeping an
   entry we saw earlier can never contradict the site.

A skipped or failed run therefore costs nothing. Nothing is lost, and the next
run carries on.

## Cached pages are thrown away

Their CDN sometimes replays an old copy of the page. 6 of 31 recorded snapshots
carried the schedule as it stood at 2026-08-09T23:00Z, by then up to 25 hours
stale, and one was entirely in the past. Those were published to the app as if
they were real.

A live page always opens with the hour that is running now, so any page opening
more than 3 hours in the past is dropped and the run ends quietly. That is not
treated as a failure, because it heals itself and the staleness gate below still
catches a file that stops updating.

`npm test` covers both rules.

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
8. **A bad page cannot overwrite a good schedule.** Conditions merge in, so the
   worst a failed or skipped run can do is leave the file as it was.

## Running it by hand

```
npm ci
npm test
node scripts/map-conditions.mjs
ANTHROPIC_API_KEY=sk-ant-... node scripts/news.mjs
```

Both write into `feeds/`. Neither takes arguments.

## Article bodies

An article body never changes once published, so `news.mjs` handles each one
once and skips it forever after. A normal hourly run makes exactly one request
to the news list and nothing else.

Every body is **rewritten in our own words before it is published**, so nothing
in the app is copied prose. The rewrite lives in `scripts/lib/rewrite.mjs` and
runs on Claude Sonnet 5, between the scrape and the file write.

Four rules keep that honest:

1. **Detail is the priority.** The instruction is explicit that every heading,
   list item, number, date, item name and patch note must survive. Rewrite,
   never summarise.
2. **A short rewrite is thrown away.** Anything under 70% of the source length
   is treated as a summary and rejected.
3. **A failed rewrite publishes nothing.** No body file is written, so the card
   appears without a body and the next hourly run tries the article again.
4. **No key, no bodies.** Without `ANTHROPIC_API_KEY` the run refreshes the
   index, writes no bodies at all, and then fails so the alert issue is raised.

`MAX_NEW` caps rewrites at 12 per run. Steady state is one or two new articles a
day, so it only matters during a backfill, which then spreads over a few hours.

### Rolling out a prompt change

Each body file carries a `rewriteVersion`. Bump `REWRITE_VERSION` in
`scripts/news.mjs` after changing the instructions and the next few runs redo
every article, twelve at a time, until they all match again.

### What gets cut

Page furniture is removed before the rewrite: the trailing "More articles:"
heading and the ~1,560 character legal footer that ends every post.

The source address is used to fetch the page and is then dropped. It is not in
`news.json` and not in the body files, and the rewriter is told never to write
a web address, so nothing in the app sends a reader off to another site.

### Cost

About 4p an article on Sonnet 5, and Embark publish a handful a month. Refilling
all 40 articles from scratch costs roughly £2, once.
