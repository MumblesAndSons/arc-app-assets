// Watches the freshly built feeds for things a person needs to act on.
//
// Two questions this answers, neither of which the app can answer by itself:
//
//  * Embark published something. A new article is how a game update is
//    announced, so this is the nudge to go and check the data.
//  * Embark introduced a map condition the app has never seen. The app will
//    still show its name and countdown, but with a question mark where the
//    picture belongs, until an icon and a description ship in an app update.
//
// It runs BEFORE the commit step, so "what changed" is simply the difference
// between the working tree and the last commit. That needs no state file of
// its own, which is one less thing to go stale.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

// The conditions the app ships an icon and a description for, in
// ArcRaidersApp/assets/conditions.json. Add to this list in the same change
// that adds the artwork, otherwise the alert keeps firing.
const APP_KNOWS = [
  'Beachcombing',
  'Bird City',
  'Close Scrutiny',
  'Cold Snap',
  'Electromagnetic Storm',
  'Harvester',
  'Hidden Bunker',
  'Hurricane',
  'Husk Graveyard',
  'Launch Tower Loot',
  'Locked Gate',
  'Lush Blooms',
  'Matriarch',
  'Night Raid',
  'Prospecting Probes',
  'Uncovered Caches',
];

const known = new Set(APP_KNOWS.map((n) => n.toLowerCase()));

/** The version of a file in the last commit, or null when it is new. */
function committed(path) {
  try {
    return JSON.parse(execSync(`git show HEAD:${path}`, { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

function working(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Every condition name the schedule and the catalogue mention. */
function conditionNames(feed) {
  const out = new Set();
  if (!feed) return out;
  for (const e of feed.entries ?? []) if (e.condition) out.add(e.condition);
  for (const c of feed.conditions ?? []) if (c.name) out.add(c.name);
  return out;
}

const alerts = [];

// ---- a new article, which is how an update gets announced ----------------
const newsBefore = committed('feeds/news.json');
const newsAfter = working('feeds/news.json');

if (newsAfter && newsBefore) {
  const seen = new Set((newsBefore.articles ?? []).map((a) => a.id));
  for (const a of newsAfter.articles ?? []) {
    if (seen.has(a.id)) continue;
    alerts.push({
      label: 'new-article',
      title: `Embark published: ${a.title}`,
      body: [
        `**${a.title}**`,
        a.date ? `Published ${a.date}.` : '',
        '',
        a.summary || '',
        '',
        'A new article usually means a game update. Worth checking whether any',
        'app data changed: items, weapons, quests, blueprints, traders, maps,',
        'enemies or map conditions.',
        '',
        'Close this issue once you have checked it.',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    });
  }
} else if (newsAfter && !newsBefore) {
  console.log('news.json is new to git, so no article alerts on this run');
}

// ---- a condition the app cannot draw yet ---------------------------------
const conditionsAfter = working('feeds/map-conditions.json');
const unknown = [...conditionNames(conditionsAfter)].filter(
  (n) => !known.has(n.toLowerCase())
);

if (unknown.length) {
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  alerts.push({
    label: 'new-condition',
    title: `App needs artwork for ${unknown.length} map condition(s)`,
    body: [
      'Embark are running a map condition the app has never seen.',
      '',
      'The app still shows the name and the countdown. It shows a question mark',
      'instead of a picture, and says "No description for this condition yet."',
      '',
      'To fix it, for each name below add a 512 x 512 icon to',
      '`assets/images/conditions/` and an entry to `assets/conditions.json`,',
      'then add the name to `APP_KNOWS` in `scripts/watch.mjs` here.',
      '',
      ...unknown.map((n) => `- **${n}** needs \`${slug(n)}.png\``),
      '',
      'The data integrity tests in the app will fail until both are in place.',
    ].join('\n'),
  });
}

// ---- a deliberate test, so the email route can be proved ------------------
if (process.env.TEST_ALERT === 'true') {
  alerts.push({
    label: 'alert-test',
    title: 'Test alert from the feed watcher',
    body: [
      'This issue was raised on purpose, to prove the alert reaches your inbox.',
      '',
      'If you are reading this in an email from GitHub, the watcher works.',
      'You will get the same kind of email when Embark publish an article, and',
      'when a map condition turns up that the app has no artwork for.',
      '',
      'Nothing is wrong. Close this issue.',
    ].join('\n'),
  });
}

// ---- hand the list to the workflow ---------------------------------------
console.log(`watch: ${alerts.length} alert(s)`);
for (const a of alerts) console.log(` - ${a.title}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `alerts<<WATCH_EOF\n${JSON.stringify(alerts)}\nWATCH_EOF\n`,
    'utf8'
  );
}
