// Builds feeds/map-conditions.json from https://arcraiders.com/map-conditions
//
// The site only publishes about 24 hours ahead, which is why the app fetches
// this file instead of shipping the data.
//
// The file is a running schedule, not a copy of the page. Each run merges what
// the page says into what we already hold, and a page that is plainly a cached
// replay is thrown away. scripts/lib/schedule.mjs has the evidence for both.
// Page reading lives in scripts/lib/conditionsPage.mjs.
import { fetchText, publish, readExisting } from './lib/util.mjs';
import { mergeEntries, staleSnapshotReason } from './lib/schedule.mjs';
import { SOURCE as SRC, parseConditionsPage, slug } from './lib/conditionsPage.mjs';

const OUT = 'feeds/map-conditions.json';

const html = await fetchText(SRC);

const { entries, via, catalogue } = parseConditionsPage(html);
if (!entries) {
  console.error('both parsers failed; leaving the previous file alone');
  process.exit(1);
}

const now = Date.now();

// Their CDN sometimes replays a page from a day earlier. Publishing that would
// put conditions in the app that are not running. Skip the run instead: the
// file we already hold is still right, and the next run picks up where this
// one left off. Exit 0 on purpose, because this is an upstream hiccup that
// heals itself, and the workflow already fails the run if the file ever goes
// more than six hours old.
const stale = staleSnapshotReason(entries, now);
if (stale) {
  console.error(`upstream served a stale page: ${stale}. Keeping the previous file.`);
  process.exit(0);
}

// The page under-reports: the next day or so is thin and fills in later, and
// some conditions are only announced as they begin. So add what the page just
// said to what we already knew, rather than replacing it. The evidence is in
// scripts/lib/schedule.mjs.
const previous = readExisting(OUT);
const kept = previous?.entries ?? [];
const merged = mergeEntries(kept, entries, now);
console.log(
  `page ${entries.length}, already held ${kept.length}, merged to ${merged.length} still to come`
);

const typeOf = new Map(catalogue.map((c) => [c.name, c.type]));
for (const e of merged) {
  // an entry carried over from the previous file keeps its own type if the
  // page has stopped listing that condition
  e.type = typeOf.get(e.condition) || e.type || 'minor';
  // the app ships one icon per condition under assets/images/conditions
  e.icon = slug(e.condition) + '.png';
}
for (const c of catalogue) c.icon = slug(c.name) + '.png';

const payload = {
  generatedAt: new Date().toISOString(),
  source: SRC,
  parsedVia: via,
  // how far ahead the schedule reaches, so the app can say "schedule ends at"
  horizonEnd: new Date(Math.max(...merged.map((e) => e.end))).toISOString(),
  conditions: catalogue,
  entries: merged,
};

const result = publish(OUT, payload, { minItems: 4, itemsKey: 'entries' });
if (result === 'rejected') process.exit(1);
