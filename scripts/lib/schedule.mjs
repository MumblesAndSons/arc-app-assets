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
//     that is a straight lie to the app. staleSnapshotReason spots it.
//
// How that second test is made changed on 22 August 2026. It used to say a
// live page always opens with the hour that is running now, so an earliest
// entry more than three hours old meant a replay. Then Embark added per region
// times, and the base window widened to open about nine hours back so the
// Oceania column has an hour to show. Every live page then looked cached.
//
// The page carries its own clock, serverNow, in the same payload. That is the
// honest test: a replay carries the clock it was built with. So compare
// serverNow against ours and stop inferring anything from the window.

/**
 * How far the page's own clock may sit behind ours before it is a replay.
 * The cached copies were 5.8 hours behind or worse. Three hours sits clear of
 * that and clear of any ordinary CDN lag.
 */
export const STALE_LEAD_MS = 3 * 60 * 60 * 1000;

/**
 * Why this snapshot cannot be trusted, or null when it is fine.
 *
 * `serverNow` is the clock the page was rendered with, in milliseconds. Pass
 * null when the page does not carry one: the replay test is then skipped,
 * because nothing else on the page tells us the truth, and refusing to publish
 * on a guess is how the feed stood still for four days.
 */
export function staleSnapshotReason(entries, now, serverNow = null) {
  if (!entries || entries.length === 0) return 'no entries';

  const latestEnd = Math.max(...entries.map(entryEnd));
  if (latestEnd <= now) {
    return `every entry has already finished (last one ended ${hours(now - latestEnd)}h ago)`;
  }

  if (Number.isFinite(serverNow) && now - serverNow > STALE_LEAD_MS) {
    return `the page was rendered ${hours(now - serverNow)}h ago, so it is a cached page`;
  }
  return null;
}

/**
 * When an entry is over EVERYWHERE, which is the only moment it is safe to
 * forget. Europe is the base time, North America runs 7 hours behind it, so an
 * hour that finished in Europe can still be 6 hours away in New York. Pruning
 * on the base end alone would drop entries a North American player has not had
 * yet. Falls back to the base end for an entry saved before regions existed.
 */
export function entryEnd(e) {
  const ends = Object.values(e?.times ?? {})
    .map((pair) => Number(pair?.[1]))
    .filter(Number.isFinite);
  return Math.max(e.end, ...ends);
}

/**
 * Union of what we already knew and what the page just said, minus anything
 * that has finished in every region. Same entry from both sides keeps the
 * fresher copy.
 */
export function mergeEntries(previous = [], fresh = [], now = Date.now()) {
  const byKey = new Map();
  for (const e of [...previous, ...fresh]) {
    if (!Number.isFinite(e?.start) || !Number.isFinite(e?.end)) continue;
    if (entryEnd(e) <= now) continue;
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

/**
 * What the site is publishing that the file does not carry. An entry about to
 * finish is ignored, because it can end between the build and the check. "About
 * to finish" means in the last region to run it, for the reason in entryEnd.
 */
export function missingEntries(published = [], live = [], now = Date.now(), graceMs = 300000) {
  const have = new Set(published.map((e) => `${e.condition}|${e.map}|${e.start}`));
  return live.filter(
    (e) => entryEnd(e) > now + graceMs && !have.has(`${e.condition}|${e.map}|${e.start}`)
  );
}
