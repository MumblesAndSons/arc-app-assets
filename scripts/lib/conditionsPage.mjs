// Reading https://arcraiders.com/map-conditions.
//
// The page server-renders the whole schedule inside its React payload as
// "liveEntries". That is far more stable than the HTML, so it is the primary
// parser. A second parser reads the visible card markup as a fallback, so a
// change to one shape does not take the feed down.
//
// This lives on its own so the builder and the after-the-fact check
// (scripts/verify-feed.mjs) read the page exactly the same way.
import { clean } from './util.mjs';

export const SOURCE = 'https://arcraiders.com/map-conditions';

/** Primary: pull liveEntries out of the embedded React payload. */
export function parsePayload(html) {
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
export function parseCards(html) {
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
export function parseCatalogue(html) {
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

/** Both parsers plus the catalogue. entries is null when the page is unreadable. */
export function parseConditionsPage(html) {
  let entries = parsePayload(html);
  let via = 'payload';
  if (!entries) {
    entries = parseCards(html);
    via = 'cards';
  }
  return { entries, via: entries ? via : null, catalogue: parseCatalogue(html) };
}

/** Turns "Close Scrutiny" into "close_scrutiny", matching the asset names. */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
