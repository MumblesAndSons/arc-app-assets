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
import { parseArray } from './payload.mjs';

export const SOURCE = 'https://arcraiders.com/map-conditions';

/** Primary: pull liveEntries out of the embedded React payload. */
export function parsePayload(html) {
  // Read by counting brackets, never by a lazy regex. Embark added
  // regionTimestamps on 18 August 2026 and a regex could not survive it.
  // scripts/lib/payload.mjs has the story.
  const raw = parseArray(html, 'liveEntries');
  if (!raw || raw.length === 0) return null;

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
  const raw = parseArray(html, 'conditionItems');
  if (!raw) return [];
  return raw
    .map((c) => ({ name: clean(c.name), type: clean(c.type) }))
    .filter((c) => c.name);
}

/** Both parsers plus the catalogue. entries is null when the page is unreadable. */
export function parseConditionsPage(html) {
  let entries = parsePayload(html);
  let via = 'payload';
  if (!entries) {
    entries = parseCards(html);
    via = 'cards';
  }
  return {
    entries,
    via: entries ? via : null,
    catalogue: parseCatalogue(html),
    serverNow: parseServerNow(html),
  };
}

/**
 * The clock the page was rendered with, in milliseconds, or null when the
 * payload does not carry one. This is how a cached replay is caught: the copy
 * carries the clock it was built with. scripts/lib/schedule.mjs uses it.
 */
export function parseServerNow(html) {
  const m = html.match(/\\"serverNow\\":(\d{10,})/);
  if (!m) return null;
  const ms = Number(m[1]);
  return Number.isFinite(ms) ? ms : null;
}

/** Turns "Close Scrutiny" into "close_scrutiny", matching the asset names. */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
