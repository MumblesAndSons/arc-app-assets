// Builds feeds/news.json from https://arcraiders.com/news
//
// The list page is server-rendered, so the cards parse from plain HTML.
// Class names carry a build hash (news-article-card_title__7LpPs), so every
// selector here matches the stable PREFIX only and ignores the hash.
//
// Article bodies are only fetched for slugs that are not already published.
// That keeps an hourly run down to one request when nothing has changed.
import { fetchText, publish, readExisting, clean } from './lib/util.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const LIST = 'https://arcraiders.com/news';
const OUT = 'feeds/news.json'; // index only, kept small so the list loads fast
const BODY_DIR = 'feeds/news'; // one file per article, fetched when tapped
const KEEP = 40; // how many articles the app carries

/** Splits the list page into one chunk per article card. */
function cardChunks(html) {
  const parts = html.split(/<a\s+class="news-article-card_container__[^"]*"/);
  return parts.slice(1);
}

function firstMatch(s, re) {
  const m = s.match(re);
  return m ? clean(m[1]) : '';
}

function parseList(html) {
  const out = [];
  for (const chunk of cardChunks(html)) {
    const slug = firstMatch(chunk, /href="\/news\/([a-z0-9-]+)"/);
    if (!slug) continue;

    const title = firstMatch(chunk, /news-article-card_title__[^"]*">([^<]*)</);
    const date = firstMatch(chunk, /news-article-card_date__[^"]*">([^<]*)</);
    // prefer the 300x200 card image over the 300x100 mobile crop
    const image = firstMatch(chunk, /news-article-card_image__[^"]*"\s+src="([^"]+)"/);

    const tags = [];
    const tagRe = /news-article-tag_tag__[^"]*"[^>]*>([^<]*)</g;
    let tm;
    while ((tm = tagRe.exec(chunk))) {
      const t = clean(tm[1]);
      if (t && !tags.includes(t)) tags.push(t);
    }

    if (!title) continue;
    out.push({
      id: slug,
      title,
      date,
      image,
      tags,
      url: `https://arcraiders.com/news/${slug}`,
    });
  }
  return out;
}

/** Pulls the readable body out of an article page as light markdown. */
function parseArticle(html) {
  let scope = html;
  const m = html.match(/<article[\s\S]*?<\/article>/i);
  if (m) scope = m[0];

  const blocks = [];
  const re = /<(h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let b;
  while ((b = re.exec(scope))) {
    const tag = b[1].toLowerCase();
    let text = b[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<[^>]+>/g, '');
    text = clean(text);
    if (!text) continue;
    if (tag === 'h2') blocks.push('# ' + text);
    else if (tag === 'h3') blocks.push('## ' + text);
    else if (tag === 'li') blocks.push('* ' + text);
    else blocks.push(text);
  }
  return blocks.join('\n\n');
}

const listHtml = await fetchText(LIST);
const cards = parseList(listHtml);
if (cards.length < 5) {
  console.error(`only ${cards.length} cards parsed; leaving the previous file alone`);
  process.exit(1);
}

const prev = readExisting(OUT);
const known = new Map((prev?.articles ?? []).map((a) => [a.id, a]));

mkdirSync(BODY_DIR, { recursive: true });

const articles = [];
let fetched = 0;
for (const card of cards.slice(0, KEEP)) {
  const bodyPath = `${BODY_DIR}/${card.id}.json`;
  const before = known.get(card.id);

  // An article body never changes once published, so fetch each one once.
  if (before && existsSync(bodyPath)) {
    articles.push({ ...before, ...card, summary: before.summary });
    continue;
  }

  let body = '';
  try {
    body = parseArticle(await fetchText(card.url));
    fetched++;
    await new Promise((r) => setTimeout(r, 600)); // be gentle on their server
  } catch (e) {
    console.error(`body fetch failed for ${card.id}: ${e.message}`);
  }
  if (body) {
    writeFileSync(
      bodyPath,
      JSON.stringify({ id: card.id, title: card.title, url: card.url, body }, null, 2) + '\n',
      'utf8'
    );
  }
  const summary = body ? body.split('\n\n').find((p) => p.length > 40)?.slice(0, 240) ?? '' : '';
  articles.push({ ...card, summary });
}
console.log(`cards ${cards.length}, new bodies fetched ${fetched}`);

const payload = {
  generatedAt: new Date().toISOString(),
  source: LIST,
  // where the app finds a body: <bodyBase>/<id>.json
  bodyBase:
    'https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news',
  articles,
};

const result = publish(OUT, payload, { minItems: 5, itemsKey: 'articles' });
if (result === 'rejected') process.exit(1);
