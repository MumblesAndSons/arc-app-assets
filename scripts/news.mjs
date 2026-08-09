// Builds feeds/news.json from https://arcraiders.com/news
//
// The list page is server-rendered, so the cards parse from plain HTML.
// Class names carry a build hash (news-article-card_title__7LpPs), so every
// selector here matches the stable PREFIX only and ignores the hash.
//
// Article bodies are only fetched for slugs that are not already published.
// That keeps an hourly run down to one request when nothing has changed.
//
// Every body is rewritten in our own words before it is published, so the app
// never carries somebody else's prose. See scripts/lib/rewrite.mjs. Because a
// body is fetched once and never again, each article is rewritten exactly once.
import { fetchText, publish, readExisting, clean } from './lib/util.mjs';
import { rewriteArticle, rewriteModel } from './lib/rewrite.mjs';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

const LIST = 'https://arcraiders.com/news';
const OUT = 'feeds/news.json'; // index only, kept small so the list loads fast
const BODY_DIR = 'feeds/news'; // one file per article, fetched when tapped
const KEEP = 40; // how many articles the app carries

// Ceiling on rewrites per run. Steady state is one or two new articles a day,
// so this only bites during a backfill, which then spreads over a few hours.
// It also caps the damage if a bad prompt ever ships.
const MAX_NEW = Number(process.env.MAX_NEW) || 12;

// Bump this after any change to the rewrite instructions. Every body below the
// current version is rewritten again, a dozen per run, until they all match.
// That is also how the first batch of scraped bodies got replaced.
const REWRITE_VERSION = 1;

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

/**
 * Cuts the page furniture off the end of an article.
 *
 * Two things sit after the real text on every post. A "More articles:" heading
 * that belongs to the page, not the article, and about 1,560 characters of
 * terms, trademarks and copyright lines. On a short post that footer is 89% of
 * the text. Both are noise in the app, and both would skew the length check
 * the rewriter uses to catch a lossy rewrite.
 */
function stripBoilerplate(text) {
  const markers = [
    /^#+ More articles/m,
    /Internet connection, Embark ID user account/,
    /ARC RAIDERS ©/,
    /Age restrictions apply/,
  ];
  let cut = text.length;
  for (const re of markers) {
    const i = text.search(re);
    if (i >= 0 && i < cut) cut = i;
  }
  let out = text.slice(0, cut).trim();

  // Drop a heading left dangling at the end with nothing underneath it.
  const blocks = out.split('\n\n');
  while (blocks.length && /^#{1,3} /.test(blocks[blocks.length - 1])) blocks.pop();
  return blocks.join('\n\n').trim();
}

/** Pulls the readable body out of an article page as light markdown. */
function parseArticle(html) {
  // the article body sits in a container whose class starts with article_
  let scope = html;
  const m = html.match(/<article[\s\S]*?<\/article>/i);
  if (m) scope = m[0];

  const blocks = [];
  const re =
    /<(h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
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
  return stripBoilerplate(blocks.join('\n\n'));
}

/**
 * The card as the app sees it.
 * The source address is used to fetch the page and then dropped. It never
 * reaches the feed, so nothing in the app sends a reader off to another site.
 */
function publicCard(card, summary) {
  const { url, ...rest } = card;
  return { ...rest, summary };
}

/** True when a body is already published at the current rewrite version. */
function isCurrent(path) {
  if (!existsSync(path)) return false;
  try {
    const f = JSON.parse(readFileSync(path, 'utf8'));
    return (f.rewriteVersion ?? 0) >= REWRITE_VERSION;
  } catch {
    return false; // unreadable file, treat it as missing
  }
}

const listHtml = await fetchText(LIST);
const cards = parseList(listHtml);
if (cards.length < 5) {
  console.error(`only ${cards.length} cards parsed; leaving the previous file alone`);
  process.exit(1);
}

const prev = readExisting(OUT);
const known = new Map((prev?.articles ?? []).map((a) => [a.id, a]));

// No key means no rewrite, and an article we cannot rewrite must not ship.
// The index still refreshes, so the run is useful and the failure is visible.
const canRewrite = Boolean(process.env.ANTHROPIC_API_KEY);
if (!canRewrite) {
  console.error('ANTHROPIC_API_KEY is not set; refreshing the index only, no bodies');
}

mkdirSync(BODY_DIR, { recursive: true });

const articles = [];
let written = 0;
let skipped = 0;
for (const card of cards.slice(0, KEEP)) {
  const bodyPath = `${BODY_DIR}/${card.id}.json`;
  const before = known.get(card.id);

  // An article body never changes once published, so handle each one once.
  if (isCurrent(bodyPath)) {
    articles.push(publicCard(card, before?.summary ?? ''));
    continue;
  }

  if (!canRewrite || written >= MAX_NEW) {
    // Try again next hour. The card still appears, just without a body yet.
    skipped++;
    articles.push(publicCard(card, before?.summary ?? ''));
    continue;
  }

  let body = '';
  try {
    const source = parseArticle(await fetchText(card.url));
    await new Promise((r) => setTimeout(r, 600)); // be gentle on their server
    body = await rewriteArticle(card.title, source);
  } catch (e) {
    console.error(`body failed for ${card.id}: ${e.message}`);
  }

  if (!body) {
    // Nothing trustworthy to publish. Leave the file absent so the next run
    // picks the article up again.
    skipped++;
    articles.push(publicCard(card, before?.summary ?? ''));
    continue;
  }

  writeFileSync(
    bodyPath,
    JSON.stringify(
      {
        id: card.id,
        title: card.title,
        rewriteVersion: REWRITE_VERSION,
        body,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  written++;
  const summary = body.split('\n\n').find((p) => p.length > 40)?.slice(0, 240) ?? '';
  articles.push(publicCard(card, summary));
}
console.log(
  `cards ${cards.length}, bodies written ${written}, waiting for a later run ${skipped}` +
    (canRewrite ? ` (rewritten with ${rewriteModel})` : '')
);

const payload = {
  generatedAt: new Date().toISOString(),
  // where the app finds a body: <bodyBase>/<id>.json
  bodyBase:
    'https://raw.githubusercontent.com/MumblesAndSons/arc-app-assets/main/feeds/news',
  articles,
};

const result = publish(OUT, payload, { minItems: 5, itemsKey: 'articles' });
if (result === 'rejected') process.exit(1);

// The index is saved by this point, so failing here still leaves a useful run.
// A missing key is a misconfiguration and should raise the failure issue.
if (!canRewrite) process.exit(1);
