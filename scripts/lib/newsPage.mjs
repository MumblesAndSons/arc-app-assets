// Reading the article list out of https://arcraiders.com/news
//
// This exists because of September 2026. Embark redesigned the news page: the
// cards (news-article-card_*) became rows (news-article-row_*), the old
// parser found nothing, and feeds/news.json stood still for three weeks. The
// app kept showing 1 September while two updates went out.
//
// Two readers, best first, the same shape as scripts/lib/conditionsPage.mjs:
//
//  1. the React payload. It carries every article they have ever published,
//     with the proper 300x200 card image, and it does not care what the page
//     looks like. A redesign cannot break it.
//  2. the rows in the HTML. Only the newest dozen, and only the 3:1 banner
//     image, but it survives the payload being renamed or removed.
//
// Class names carry a build hash (news-article-row_title__e__gM), so every
// selector matches the stable PREFIX only and ignores the hash.
import { clean } from './util.mjs';
import { sliceArray } from './payload.mjs';

const BACKSLASH = String.fromCharCode(92);
const ARTICLES_KEY = BACKSLASH + '"articles' + BACKSLASH + '":';

// What their own page shows for an article published without a card image.
const GENERIC_IMAGE = 'https://assets.arcraiders.com/static/articles/generic-300x200.png';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

/** "2026-09-15T09:00:00.000Z" as the app shows it: "September 15, 2026". */
export function displayDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function card(slug, title, date, image, tags) {
  return {
    id: slug,
    title,
    date,
    image,
    tags,
    url: `https://arcraiders.com/news/${slug}`,
  };
}

/**
 * Every "articles" array in the payload. The page holds two: the featured
 * band, which is a single article, and the full list. The full list LEAVES OUT
 * whatever is featured, so both are needed. Reading only the long one dropped
 * the Frozen Trail announcement, the biggest post of the month.
 */
function articleArrays(html) {
  const found = [];
  let at = 0;
  while ((at = html.indexOf(ARTICLES_KEY, at)) >= 0) {
    const text = sliceArray(html.slice(at), 'articles');
    at += ARTICLES_KEY.length;
    if (!text) continue;
    try {
      const raw = JSON.parse(text);
      if (Array.isArray(raw)) found.push(raw);
    } catch {
      // not the array we are after, keep looking
    }
  }
  return found;
}

export function parsePayload(html) {
  const seen = new Set();
  const out = [];
  for (const a of articleArrays(html).flat()) {
    if (!a || typeof a.slug !== 'string' || !/^[a-z0-9-]+$/.test(a.slug)) continue;
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    if (a._status && a._status !== 'published') continue;
    const title = clean(a.title);
    if (!title) continue;

    const desktop = a.cardImages?.desktop;
    const image = desktop?.thumbnailURL || desktop?.sizes?.desktop?.url || desktop?.url || GENERIC_IMAGE;
    const tags = [];
    for (const t of a.tags ?? []) {
      const name = clean(t?.name);
      if (name && !tags.includes(name)) tags.push(name);
    }
    out.push({ ...card(a.slug, title, displayDate(a.date), image, tags), sortKey: a.date || '' });
  }

  // newest first, whatever order they send
  out.sort((x, y) => (x.sortKey < y.sortKey ? 1 : x.sortKey > y.sortKey ? -1 : 0));
  return out.map(({ sortKey, ...rest }) => rest);
}

function firstMatch(s, re) {
  const m = s.match(re);
  return m ? clean(m[1]) : '';
}

export function parseRows(html) {
  const chunks = html.split(/<a\s+class="news-article-row_row__[^"]*"/).slice(1);
  const out = [];
  for (const chunk of chunks) {
    const slug = firstMatch(chunk, /href="\/news\/([a-z0-9-]+)"/);
    if (!slug) continue;
    // the chunk runs on into the next row's markup, so stop at this row's end
    const row = chunk.split('</a>')[0];

    const title = firstMatch(row, /news-article-row_title__[^"]*">([^<]*)</);
    if (!title) continue;
    const date = firstMatch(row, /news-article-row_date__[^"]*">([^<]*)</);
    // the 2x banner is 600x200; the app draws it 160 tall, so 1x looks soft
    const image =
      firstMatch(row, /srcSet="[^"]*?,\s*([^"\s]+)\s+2x"/) ||
      firstMatch(row, /news-article-row_image__[^"]*"\s+src="([^"]+)"/);

    const tags = [];
    const tagRe = /news-article-tag_tag__[^"]*"[^>]*>([^<]*)</g;
    let tm;
    while ((tm = tagRe.exec(row))) {
      const t = clean(tm[1]);
      if (t && !tags.includes(t)) tags.push(t);
    }
    out.push(card(slug, title, date, image, tags));
  }
  return out;
}

/**
 * The article list, and which reader produced it. `complete` is false when
 * only the rows could be read, because the rows stop at a dozen and the
 * caller must then keep the older articles it already holds.
 */
export function parseNewsPage(html) {
  const payload = parsePayload(html);
  if (payload.length >= 5) return { cards: payload, via: 'payload', complete: true };
  const rows = parseRows(html);
  return { cards: rows, via: 'rows', complete: false };
}
