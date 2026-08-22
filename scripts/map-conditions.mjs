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
import { REGIONS, SOURCE as SRC, parseConditionsPage, slug } from './lib/conditionsPage.mjs';

const OUT = 'feeds/map-conditions.json';

const html = await fetchText(SRC);

const { entries, via, catalogue, serverNow } = parseConditionsPage(html);
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
const stale = staleSnapshotReason(entries, now, serverNow);
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

// How far ahead the schedule reaches in each region, so the app can say
// "schedule ends at" honestly to whoever is reading it. North America runs 7
// hours behind Europe, so its horizon is 7 hours further out, and a single
// number would be wrong for four regions out of five.
const horizonEnds = {};
for (const r of REGIONS) {
  const ends = merged.map((e) => e.times?.[r.id]?.[1]).filter(Number.isFinite);
  if (ends.length) horizonEnds[r.id] = new Date(Math.max(...ends)).toISOString();
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: SRC,
  parsedVia: via,
  // Europe, kept under the old name because the app already live on Google
  // Play reads this field and knows nothing about regions.
  horizonEnd: new Date(Math.max(...merged.map((e) => e.end))).toISOString(),
  horizonEnds,
  // the picker on the Map Conditions screen is built from this list, in this
  // order, so a region Embark rename does not need an app release
  regions: REGIONS.map((r) => ({ id: r.id, name: r.name })),
  conditions: catalogue,
  entries: merged,
};

const result = publish(OUT, payload, { minItems: 4, itemsKey: 'entries' });
if (result === 'rejected') process.exit(1);
