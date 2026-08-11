// Checks the two rules that keep feeds/map-conditions.json honest.
// Run with: npm test
//
// The numbers in the stale-page tests are taken from real snapshots this
// repository committed on 2026-08-10, when the site replayed a cached page.
import assert from 'node:assert/strict';
import { mergeEntries, missingEntries, staleSnapshotReason } from './lib/schedule.mjs';

const H = 3600000;
const NOW = Date.parse('2026-08-11T20:30:00Z');
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const entry = (condition, map, startsInHours) => ({
  condition,
  map,
  start: NOW + startsInHours * H,
  end: NOW + (startsInHours + 1) * H,
});

console.log('staleSnapshotReason');

check('accepts a live page, which opens with the hour already running', () => {
  const page = [entry('Bird City', 'Buried City', -0.5), entry('Matriarch', 'Spaceport', 1)];
  assert.equal(staleSnapshotReason(page, NOW), null);
});

check('accepts a page whose first entry began 59 minutes ago', () => {
  assert.equal(staleSnapshotReason([entry('Harvester', 'Spaceport', -0.98)], NOW), null);
});

check('rejects the cached page seen on 2026-08-10, 5.8 hours behind', () => {
  const cached = [entry('Husk Graveyard', 'Buried City', -5.8), entry('Locked Gate', 'The Blue Gate', 4)];
  assert.match(staleSnapshotReason(cached, NOW), /cached page/);
});

check('rejects the worst cached page, entirely in the past', () => {
  const cached = [entry('Husk Graveyard', 'Buried City', -24.8), entry('Matriarch', 'Spaceport', -1.8)];
  assert.match(staleSnapshotReason(cached, NOW), /already finished/);
});

check('rejects an empty page', () => {
  assert.equal(staleSnapshotReason([], NOW), 'no entries');
});

console.log('mergeEntries');

check('keeps a future entry the newest page has not listed yet', () => {
  const held = [entry('Locked Gate', 'The Blue Gate', 8)];
  const page = [entry('Bird City', 'Buried City', 1)];
  const out = mergeEntries(held, page, NOW);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((e) => e.condition),
    ['Bird City', 'Locked Gate']
  );
});

check('adds the entries the page announced late', () => {
  const held = [entry('Lush Blooms', 'Riven Tides', 0.5)];
  const page = [
    entry('Lush Blooms', 'Riven Tides', 0.5),
    entry('Bird City', 'Buried City', 0.5),
    entry('Night Raid', 'Stella Montis', 0.5),
  ];
  assert.equal(mergeEntries(held, page, NOW).length, 3);
});

check('drops an entry once it has finished', () => {
  const held = [entry('Hurricane', 'Spaceport', -3), entry('Harvester', 'The Blue Gate', 2)];
  const out = mergeEntries(held, [], NOW);
  assert.deepEqual(
    out.map((e) => e.condition),
    ['Harvester']
  );
});

check('keeps an entry that is running right now', () => {
  const out = mergeEntries([entry('Lush Blooms', 'Riven Tides', -0.5)], [], NOW);
  assert.equal(out.length, 1);
});

check('never lists the same condition, map and start twice', () => {
  const same = entry('Matriarch', 'Spaceport', 2);
  assert.equal(mergeEntries([same], [{ ...same }], NOW).length, 1);
});

check('treats the same condition on two maps as two entries', () => {
  const out = mergeEntries([], [entry('Matriarch', 'Spaceport', 2), entry('Matriarch', 'Dam Battlegrounds', 2)], NOW);
  assert.equal(out.length, 2);
});

check('sorts by start time', () => {
  const out = mergeEntries([entry('Late', 'Spaceport', 6)], [entry('Early', 'Buried City', 1)], NOW);
  assert.deepEqual(
    out.map((e) => e.condition),
    ['Early', 'Late']
  );
});

check('the page wins when it repeats an entry we already held', () => {
  const held = [{ ...entry('Matriarch', 'Spaceport', 2), type: 'minor' }];
  const page = [{ ...entry('Matriarch', 'Spaceport', 2), type: 'major' }];
  assert.equal(mergeEntries(held, page, NOW)[0].type, 'major');
});

check('ignores a row with no usable times', () => {
  const out = mergeEntries([], [{ condition: 'Broken', map: 'Spaceport', start: NaN, end: NaN }], NOW);
  assert.equal(out.length, 0);
});

console.log('missingEntries');

check('says nothing is missing when the file has everything', () => {
  const live = [entry('Bird City', 'Buried City', 1), entry('Matriarch', 'Spaceport', 2)];
  assert.equal(missingEntries(live, live, NOW).length, 0);
});

check('names what the site shows and the app does not', () => {
  const live = [entry('Bird City', 'Buried City', 1), entry('Matriarch', 'Spaceport', 2)];
  const out = missingEntries([live[0]], live, NOW);
  assert.deepEqual(
    out.map((e) => e.condition),
    ['Matriarch']
  );
});

check('catches the real case: a file built before the site announced more', () => {
  const held = [entry('Lush Blooms', 'Riven Tides', 0)];
  const live = [
    entry('Lush Blooms', 'Riven Tides', 0),
    entry('Bird City', 'Buried City', 0),
    entry('Night Raid', 'Stella Montis', 0),
    entry('Electromagnetic Storm', 'Spaceport', 0),
  ];
  assert.equal(missingEntries(held, live, NOW).length, 3);
});

check('ignores an entry that is about to finish', () => {
  const ending = { ...entry('Harvester', 'Spaceport', -1), end: NOW + 60000 };
  assert.equal(missingEntries([], [ending], NOW).length, 0);
});

check('ignores an entry that has already finished', () => {
  assert.equal(missingEntries([], [entry('Harvester', 'Spaceport', -4)], NOW).length, 0);
});

console.log(`\n${passed} checks passed`);
