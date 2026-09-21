// Checks the news reader against a real page saved from arcraiders.com.
// Run with: npm test
//
// This exists because of September 2026. Embark redesigned the news page, the
// old parser found no cards, and the app's News screen stood still for three
// weeks. When the page changes again, save a fresh copy beside this one and
// add a case; keep the old one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNewsPage, parsePayload, parseRows, displayDate } from './lib/newsPage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, 'fixtures', 'news-2026-09-21.html'), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log('the news page saved on 2026-09-21, after the redesign');

check('reads the full list out of the payload, not the featured band', () => {
  const { cards, via, complete } = parseNewsPage(page);
  assert.equal(via, 'payload');
  assert.equal(complete, true);
  assert.ok(cards.length >= 90, `only ${cards.length} articles`);
});

check('the newest article comes first, in the shape the app expects', () => {
  const [first] = parsePayload(page);
  assert.equal(first.id, 'store-update-1-46-0');
  assert.equal(first.title, 'Store Update 1.46.0');
  assert.equal(first.date, 'September 15, 2026');
  assert.deepEqual(first.tags, ['Store Update']);
  assert.match(first.image, /^https:\/\/assets\.arcraiders\.com\/.+300x200\.png$/);
  assert.equal(first.url, 'https://arcraiders.com/news/store-update-1-46-0');
});

check('every article has an id, a title, a date and an image', () => {
  for (const c of parsePayload(page)) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.ok(c.title, `${c.id} has no title`);
    assert.ok(c.date, `${c.id} has no date`);
    assert.ok(c.image, `${c.id} has no image`);
  }
});

check('no article appears twice', () => {
  const ids = parsePayload(page).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

check('the rows reader agrees with the payload on the newest dozen', () => {
  const rows = parseRows(page);
  const payload = parsePayload(page);
  assert.equal(rows.length, 12);
  rows.forEach((r, i) => {
    assert.equal(r.id, payload[i].id);
    assert.equal(r.title, payload[i].title);
    assert.equal(r.date, payload[i].date);
    assert.deepEqual(r.tags, payload[i].tags);
    assert.ok(r.image.startsWith('https://assets.arcraiders.com/'));
  });
});

check('falls back to the rows when the payload is gone', () => {
  const noPayload = page.split('\\"articles\\":').join('\\"renamed\\":');
  const { cards, via, complete } = parseNewsPage(noPayload);
  assert.equal(via, 'rows');
  assert.equal(complete, false);
  assert.equal(cards.length, 12);
});

check('a page with neither gives nothing, so the old file is left alone', () => {
  assert.equal(parseNewsPage('<html><body>maintenance</body></html>').cards.length, 0);
});

check('dates read the way the app has always shown them', () => {
  assert.equal(displayDate('2026-09-08T09:00:00.000Z'), 'September 8, 2026');
  assert.equal(displayDate('not a date'), '');
});

console.log(`\n${passed} passed`);
