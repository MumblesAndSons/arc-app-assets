// Checks the file the app will actually read against the live site.
//
// Everything else in this repository checks that a RUN went well. This checks
// that the RESULT is right, which is a different question and the one that
// matters. It runs after the commit, re-reads arcraiders.com from scratch, and
// fails if the published file is missing anything the site is publishing.
//
// It catches, without anyone watching:
//  * a file that has gone behind because runs were skipped or kept failing
//  * a parser that has quietly stopped understanding the page
//  * any future change that drops entries on the floor
//
// A failure here goes to the same place as a broken scrape: an assigned GitHub
// issue, which GitHub emails.
import { fetchText, readExisting } from './lib/util.mjs';
import { missingEntries, staleSnapshotReason } from './lib/schedule.mjs';
import { SOURCE, parseConditionsPage } from './lib/conditionsPage.mjs';

const FILE = 'feeds/map-conditions.json';

// An entry can end between the build and this check, so ignore anything within
// five minutes of finishing. Without this the check would flap on the hour.
const GRACE_MS = 5 * 60 * 1000;

// The site announces conditions at any moment, including in the seconds
// between the build and this check, and a file built minutes ago cannot be
// blamed for that. So only judge a file that has had time to be wrong. At four
// runs an hour, 45 minutes means at least two scheduled runs did not land and
// the site has moved on without us, which is worth an email.
const JUDGE_AFTER_MS = 45 * 60 * 1000;

const key = (e) => `${e.condition}|${e.map}|${e.start}`;
const at = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};

const published = readExisting(FILE);
if (!published || !Array.isArray(published.entries)) {
  fail(`${FILE} is missing or has no entries. The app has nothing to show.`);
}

// A network wobble is not this check's business. The build step already fails
// and alerts when the site cannot be reached, so do not raise it twice.
let html;
try {
  html = await fetchText(SOURCE);
} catch (e) {
  console.log(`skipped: could not reach the site to compare (${e.message})`);
  process.exit(0);
}

const { entries: live } = parseConditionsPage(html);
if (!live) {
  fail(
    `neither parser could read ${SOURCE}. The page shape has changed, so the ` +
      `feed will stop updating until scripts/lib/conditionsPage.mjs is fixed.`
  );
}

const now = Date.now();

// Cannot judge the file against a page that is itself a cached replay. Say so
// and stop; if this persists the staleness gate in the workflow fails the run.
const stale = staleSnapshotReason(live, now);
if (stale) {
  console.log(`skipped: the site is serving a cached page (${stale})`);
  process.exit(0);
}

const missing = missingEntries(published.entries, live, now, GRACE_MS);

const age = now - Date.parse(published.generatedAt);
const ageMin = Math.round(age / 60000);
const liveNow = published.entries.filter((e) => e.start <= now && e.end > now);

console.log(`${FILE} was built ${ageMin} min ago and holds ${published.entries.length} entries`);
console.log(`the site is publishing ${live.length}, of which ${missing.length} are missing here`);
console.log(`running right now, per the file: ${liveNow.length}`);

if (missing.length && age < JUDGE_AFTER_MS) {
  console.log(
    `not judged: the file is only ${ageMin} min old, so the site may have ` +
      `announced these in the last few seconds. The next run picks them up.`
  );
  process.exit(0);
}

if (missing.length) {
  for (const e of missing) {
    console.error(`  missing: ${at(e.start)}  ${e.condition} @ ${e.map}`);
  }
  fail(
    `the app is missing ${missing.length} map condition(s) that arcraiders.com ` +
      `is showing. The file was last built ${ageMin} minutes ago.`
  );
}

console.log('OK: the app has everything the site is publishing.');
