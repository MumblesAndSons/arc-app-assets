// Checks the parser against a real page saved from arcraiders.com.
// Run with: npm test
//
// This exists because of 18 August 2026. Embark added a regionTimestamps field
// to every entry, the lazy regex in the old parser cut the array in half, both
// parsers failed, and feeds/map-conditions.json stood still for four days
// while the failure alert sent 96 emails a day that nobody could read.
//
// A saved page turns that into a test failure at the moment the parser breaks,
// with no network and no waiting. When the page shape changes again, save a
// fresh copy beside this one and add a case; keep the old one, because a
// parser that still reads yesterday's page is a parser that did not guess.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConditionsPage, parseServerNow, slug } from './lib/conditionsPage.mjs';
import { sliceArray } from './lib/payload.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('sliceArray');

check('stops at the matching bracket, not the first one', () => {
  const html = String.raw`x\"liveEntries\":[{\"a\":[1,2],\"b\":3}],\"next\":1`;
  assert.equal(sliceArray(html, 'liveEntries'), '[{"a":[1,2],"b":3}]');
});

check('a bracket inside a name cannot end the scan', () => {
  const html = String.raw`\"conditionItems\":[{\"name\":\"Odd ] Name\"}],\"x\":1`;
  assert.equal(sliceArray(html, 'conditionItems'), '[{"name":"Odd ] Name"}]');
});

check('returns null when the key is not there', () => {
  assert.equal(sliceArray('nothing here', 'liveEntries'), null);
});

console.log('the page saved on 2026-08-22, the one that broke the old parser');

const page = fixture('map-conditions-2026-08-22.html');

check('reads the schedule out of the payload, not the cards', () => {
  const { entries, via } = parseConditionsPage(page);
  assert.equal(via, 'payload');
  assert.equal(entries.length, 138);
});

check('every entry has a condition, a map and two real times', () => {
  const { entries } = parseConditionsPage(page);
  for (const e of entries) {
    assert.ok(e.condition, 'condition is missing');
    assert.ok(e.map, 'map is missing');
    assert.ok(Number.isFinite(e.start) && Number.isFinite(e.end), `bad times on ${e.condition}`);
    assert.ok(e.end > e.start, `${e.condition} ends before it starts`);
  }
});

check('reads the 14 named conditions and which are major', () => {
  const { catalogue } = parseConditionsPage(page);
  assert.equal(catalogue.length, 14);
  const major = catalogue.filter((c) => c.type === 'major').map((c) => c.name);
  assert.deepEqual(major.sort(), [
    'Close Scrutiny',
    'Electromagnetic Storm',
    'Hidden Bunker',
    'Hurricane',
    'Locked Gate',
    'Night Raid',
  ]);
});

check("reads the page's own clock", () => {
  const at = parseServerNow(page);
  assert.equal(new Date(at).toISOString(), '2026-08-22T12:28:56.020Z');
});

check('every entry carries all five regions', () => {
  const { entries } = parseConditionsPage(page);
  for (const e of entries) {
    assert.deepEqual(
      Object.keys(e.times).sort(),
      ['asia', 'europe', 'north-america', 'oceania', 'south-america'],
      `${e.condition} @ ${e.map} is short of a region`
    );
  }
});

check('Europe is the base time, and every region lasts the same hour', () => {
  const { entries } = parseConditionsPage(page);
  for (const e of entries) {
    assert.deepEqual(e.times.europe, [e.start, e.end], `${e.condition} europe is not the base`);
    const span = e.end - e.start;
    for (const [id, [s, en]] of Object.entries(e.times)) {
      assert.equal(en - s, span, `${e.condition} runs a different length in ${id}`);
    }
  }
});

// The offsets held on this page, but the feed stores real times, so the day
// Embark shift a region the feed follows them and this test says what moved.
check('the regions sit where the site says they do', () => {
  const e = parseConditionsPage(page).entries[0];
  const hoursFromBase = (id) => (e.times[id][0] - e.start) / 3600000;
  assert.equal(hoursFromBase('north-america'), 7);
  assert.equal(hoursFromBase('south-america'), 6);
  assert.equal(hoursFromBase('asia'), -5);
  assert.equal(hoursFromBase('oceania'), -9);
});

check('every condition slugs to an icon name the app can look for', () => {
  const { catalogue } = parseConditionsPage(page);
  for (const c of catalogue) {
    assert.match(slug(c.name), /^[a-z0-9_]+$/, `${c.name} slugs badly`);
  }
});

console.log(`\n${passed} checks passed`);
