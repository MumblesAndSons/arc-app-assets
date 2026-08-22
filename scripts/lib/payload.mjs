// Pulling one array out of the React payload on arcraiders.com.
//
// The payload is a JSON string embedded inside a JavaScript string literal, so
// every quote arrives as \" and every backslash as \\. It used to be safe to
// grab an array with a lazy regex up to the first ], and on 18 August 2026 it
// stopped being safe: Embark added regionTimestamps, which holds nested
// arrays, so the lazy match cut the array in half and JSON.parse threw. Both
// parsers then failed and the feed stood still for four days.
//
// This reads the array the only way that survives a new field: decode one
// level of escaping and count brackets until the array closes. Anything they
// add in future is carried along instead of breaking the read.

const BACKSLASH = String.fromCharCode(92);
const QUOTE = '"';

/**
 * The JSON text of the array named by `key`, or null when the key is absent
 * or the array never closes. String contents are respected, so a bracket
 * inside a condition name cannot end the scan early.
 */
export function sliceArray(html, key) {
  const at = html.indexOf(BACKSLASH + QUOTE + key + BACKSLASH + QUOTE + ':');
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  if (start < 0) return null;

  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let i = start;

  while (i < html.length) {
    // decode one character of the JavaScript string literal
    let ch = html[i];
    if (ch === BACKSLASH) {
      const next = html[i + 1];
      if (next === QUOTE || next === BACKSLASH) {
        ch = next;
        i += 2;
      } else if (next === 'n') {
        ch = '\n';
        i += 2;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }

    out += ch;

    // now read that character as JSON
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === BACKSLASH) {
      escaped = true;
      continue;
    }
    if (ch === QUOTE) {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return out;
    }
  }
  return null;
}

/** sliceArray, parsed. Returns an array, or null if it cannot be read. */
export function parseArray(html, key) {
  const text = sliceArray(html, key);
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
