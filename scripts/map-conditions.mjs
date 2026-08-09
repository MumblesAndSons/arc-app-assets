// Builds feeds/map-conditions.json from https://arcraiders.com/map-conditions
//
// The page server-renders the whole schedule inside its React payload as
// "liveEntries". That is far more stable than the HTML, so it is the primary
// parser. A second parser reads the visible card markup as a fallback, so a
// change to one shape does not take the feed down.
//
// The site only publishes about 24 hours ahead, which is why the app fetches
// this file instead of shipping the data.
import { fetchText, publish, clean } from './lib/util.mjs';

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

entries.sort((a, b) => a.start - b.start || a.map.localeCompare(b.map));

const catalogue = parseCatalogue(html);
const typeOf = new Map(catalogue.map((c) => [c.name, c.type]));
for (const e of entries) {
  e.type = typeOf.get(e.condition) || 'minor';
  // the app ships one icon per condition under assets/images/conditions
  e.icon = slug(e.condition) + '.png';
}
for (const c of catalogue) c.icon = slug(c.name) + '.png';

const payload = {
  generatedAt: new Date().toISOString(),
  source: SRC,
  parsedVia: via,
  // how far ahead this snapshot reaches, so the app can say "schedule ends at"
  horizonEnd: new Date(Math.max(...entries.map((e) => e.end))).toISOString(),
  conditions: catalogue,
  entries,
};

const result = publish(OUT, payload, { minItems: 4, itemsKey: 'entries' });
if (result === 'rejected') process.exit(1);
