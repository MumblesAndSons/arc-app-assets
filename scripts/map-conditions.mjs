// Builds feeds/map-conditions.json from https://arcraiders.com/map-conditions
//
// The page server-renders the whole schedule inside its React payload as
// "liveEntries". That is far more stable than the HTML, so it is the primary
// parser. A second parser reads the visible card markup as a fallback, so a
// change to one shape does not take the feed down.
//
// The site only publishes about 24 hours ahead, which is why the app fetches
// this file instead of shipping the data.
//
// The file is a running schedule, not a copy of the page. Each run merges what
// the page says into what we already hold, and a page that is plainly a cached
// replay is thrown away. scripts/lib/schedule.mjs has the evidence for both.
import { fetchText, publish, readExisting, clean } from './lib/util.mjs';
import { mergeEntries, staleSnapshotReason } from './lib/schedule.mjs';

const SRC = 'https://arcraiders.com/map-conditions';
const OUT = 'feeds/map-conditions.json';

/** Primary: pull liveEntries out of the embedded React payload. */
function parsePayload(html) {
  // the payload is escaped JSON inside self.__next_f.push(...)
  const m = html.match(/\\"liveEntries\\":\[(.*?)\](?=,\\"|\})/s);
  if (!m) return null;
  let raw;
  try {
    raw = JSON.parse('[' + m[1].replace(/\\"/g, '"') + ']');
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out = [];
  for (const e of raw) {
    const name = clean(e.conditionName);
    const map = clean(e.mapDisplayName);
    const start = Number(e.startTimestamp);
    const end = Number(e.endTimestamp);
    if (!name || !map || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ condition: name, map, start, end });
  }
  return out.length ? out : null;
}

/** Fallback: read the rendered cards. Coarser, but keeps the feed alive. */
function parseCards(html) {
  const out = [];
  const re =
    /href="\/map-conditions\/([a-z0-9-]+)"[\s\S]{0,600}?data-start="(\d+)"[\s\S]{0,200}?data-end="(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({
      condition: m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      map: '',
      start: Number(m[2]),
      end: Number(m[3]),
    });
  }
  return out.length ? out : null;
}

/** The named conditions and whether each is major or minor. */
function parseCatalogue(html) {
  // the payload calls this list conditionItems
  const m = html.match(/\\"conditionItems\\":\[(.*?)\](?=,\\"|\})/s);
  if (!m) return [];
  try {
    const raw = JSON.parse('[' + m[1].replace(/\\"/g, '"') + ']');
    return raw
      .map((c) => ({ name: clean(c.name), type: clean(c.type) }))
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

/** Turns "Close Scrutiny" into "close_scrutiny", matching the asset names. */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const html = await fetchText(SRC);

let entries = parsePayload(html);
let via = 'payload';
if (!entries) {
  entries = parseCards(html);
  via = 'cards';
}
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

const catalogue = parseCatalogue(html);
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
