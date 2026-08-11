// Schedule bookkeeping for feeds/map-conditions.json.
//
// Two things about arcraiders.com/map-conditions drove this file, both found
// by replaying every snapshot this repository has committed:
//
//  1. The schedule is APPEND ONLY. Across 24 consecutive healthy snapshots
//     spanning two days, not one future entry was ever withdrawn. What does
//     happen is that entries appear late: the far end of the window is thin
//     and fills in as the hour approaches, and 27 of 138 entries were first
//     published less than two hours before they started. So a single snapshot
//     is always an UNDER-count of the real schedule, and replacing the file
//     with the newest snapshot throws away everything learned earlier.
//     mergeEntries keeps the union instead, and drops an entry only once it
//     has actually finished.
//
//  2. Their CDN sometimes serves a CACHED copy of the page. 6 of 31 snapshots
//     carried the schedule as it stood at 2026-08-09T23:00Z, by then up to 25
//     hours out of date, and one of them was entirely in the past. Published,
//     that is a straight lie to the app. staleSnapshotReason spots it, because
//     a real page always opens with the hour that is running now.

/**
 * A live page starts with the hour in progress, so its earliest entry began
 * less than an hour ago. The cached copies were 5.8 hours behind or worse.
 * Three hours sits well clear of both.
 */
export const STALE_LEAD_MS = 3 * 60 * 60 * 1000;

/** Why this snapshot cannot be trusted, or null when it is fine. */
export function staleSnapshotReason(entries, now) {
  if (!entries || entries.length === 0) return 'no entries';

  const earliest = Math.min(...entries.map((e) => e.start));
  const latestEnd = Math.max(...entries.map((e) => e.end));

  if (latestEnd <= now) {
    return `every entry has already finished (last one ended ${hours(now - latestEnd)}h ago)`;
  }
  if (earliest < now - STALE_LEAD_MS) {
    return `it opens ${hours(now - earliest)}h in the past, so it is a cached page`;
  }
  return null;
}

/**
 * Union of what we already knew and what the page just said, minus anything
 * that has finished. Same entry from both sides keeps the fresher copy.
 */
export function mergeEntries(previous = [], fresh = [], now = Date.now()) {
  const byKey = new Map();
  for (const e of [...previous, ...fresh]) {
    if (!Number.isFinite(e?.start) || !Number.isFinite(e?.end)) continue;
    if (e.end <= now) continue;
    byKey.set(`${e.condition}|${e.map}|${e.start}`, e);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.start - b.start ||
      a.map.localeCompare(b.map) ||
      a.condition.localeCompare(b.condition)
  );
}

function hours(ms) {
  return (ms / 3600000).toFixed(1);
}
