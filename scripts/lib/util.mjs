// Shared helpers for the feed builders.
//
// Everything here exists to make the job survive unattended for months:
// retries, a hard sanity gate before any file is written, and never
// overwriting a good file with a worse one.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const UA =
  'Mozilla/5.0 (compatible; TopsideFeedBot/1.0; +https://github.com/MumblesAndSons/arc-app-assets)';

/** GET with retries and exponential backoff. Throws only after all tries. */
export async function fetchText(url, { tries = 4, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw new Error(`fetch failed for ${url}: ${lastErr?.message}`);
}

/** Reads the JSON already published, or null if there is none yet. */
export function readExisting(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes only if the new payload passes its sanity check.
 * A scrape that returns nothing must never wipe a good file.
 * Returns 'written' | 'unchanged' | 'rejected'.
 */
export function publish(path, next, { minItems, itemsKey }) {
  const count = Array.isArray(next[itemsKey]) ? next[itemsKey].length : 0;
  if (count < minItems) {
    console.error(
      `REJECTED ${path}: only ${count} ${itemsKey}, need at least ${minItems}. Keeping the previous file.`
    );
    return 'rejected';
  }

  const prev = readExisting(path);
  if (prev) {
    // Compare everything except the timestamp, so an unchanged upstream
    // does not produce a commit every hour.
    const a = JSON.stringify({ ...prev, generatedAt: null });
    const b = JSON.stringify({ ...next, generatedAt: null });
    if (a === b) {
      console.log(`unchanged ${path} (${count} ${itemsKey})`);
      return 'unchanged';
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`wrote ${path} (${count} ${itemsKey})`);
  return 'written';
}

/** Collapses whitespace and decodes the handful of entities we see. */
export function clean(s) {
  if (!s) return '';
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
