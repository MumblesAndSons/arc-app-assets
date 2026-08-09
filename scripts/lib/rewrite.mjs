// Rewrites a scraped article into original wording before it is published.
//
// The app must never carry somebody else's prose, so this runs between the
// scrape and the file write. Each article passes through here exactly once,
// the hour it first appears, because news.mjs never refetches a body it has.
//
// The rewrite must be a REWRITE, not a summary. Every fact has to survive.
// Two guards enforce that: the instructions below, and a length check in
// rewriteArticle() that rejects anything much shorter than the source.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5';

// Anything shorter than this share of the source is treated as a summary
// and thrown away, so a lossy rewrite never reaches the app.
const MIN_LENGTH_RATIO = 0.7;

const RULES = `You rewrite official game news posts for an unofficial ARC Raiders companion app.

1. KEEP EVERY DETAIL. This matters more than anything else. Every heading, every
   list item, every number, date, time, percentage, item name, weapon name, map
   name, patch note, price, quantity, warning and caveat must appear in your
   version. Never summarise. Never shorten. Never drop something because it
   looks minor or repetitive. If the source has eleven bullet points, yours has
   eleven bullet points. If it names six items, yours names all six. Your
   version should be about as long as the source, or longer.
2. USE YOUR OWN WORDS. Do not reuse the source phrasing or its sentence
   structure. Rebuild every sentence from scratch. Keep proper nouns, in-game
   names and quoted patch strings exactly as written, because those are facts.
3. ADD NOTHING. No extra facts, no opinions, no speculation, no filler, no
   commentary about the source or the studio.
4. WRITE PLAINLY. Short, direct sentences. Active voice. No hype, no marketing
   voice, no exclamation marks.
5. NO ATTRIBUTION AND NO LINKS. No byline, no studio name as an author, no
   "originally posted", no credits. Never write a web address of any kind. If
   the source tells readers to visit a page, say what is on that page instead
   and drop the address. Readers stay in the app.
6. KEEP THE MARKDOWN SHAPE. "# " for a heading, "## " for a sub heading, "* "
   for a list item, "**bold**" for bold, one blank line between blocks.
7. Return only the finished article text. No preamble, no sign-off, no
   explanation of what you changed, no code fence.`;

/**
 * Safety net for rule 5. The instruction handles this, but a stray address
 * must never reach the app, so any that survives is pulled out here and the
 * sentence around it is tidied up.
 */
function stripLinks(text) {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1') // markdown link, keep the words
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]*,?[ \t]+(?=[.,;:!?])/g, '') // space left in front of punctuation
    .replace(/\b(?:visit|see|read more|find out more|check it out)[ \t]*(?=[.\n])/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Returns the rewritten article, or '' if the rewrite could not be trusted.
 * Never throws: a failure must leave the body unpublished, not break the run.
 */
export async function rewriteArticle(title, source, { client } = {}) {
  const text = (source || '').trim();
  if (!text) return '';

  const ai = client ?? new Anthropic(); // reads ANTHROPIC_API_KEY

  let out = '';
  try {
    const res = await ai.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: RULES,
      messages: [
        {
          role: 'user',
          content: `Rewrite the article below. Keep every detail.\n\nTitle: ${title}\n\n${text}`,
        },
      ],
    });

    if (res.stop_reason === 'refusal') {
      console.error(`rewrite refused for "${title}"`);
      return '';
    }
    if (res.stop_reason === 'max_tokens') {
      console.error(`rewrite hit the token cap for "${title}"`);
      return '';
    }

    out = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  } catch (e) {
    console.error(`rewrite failed for "${title}": ${e.message}`);
    return '';
  }

  if (!out) return '';

  out = stripLinks(out);

  // A rewrite that lost a third of the article is a summary. Reject it.
  const ratio = out.length / text.length;
  if (ratio < MIN_LENGTH_RATIO) {
    console.error(
      `rewrite too short for "${title}": ${out.length} vs ${text.length} chars ` +
        `(${Math.round(ratio * 100)}%), needs ${Math.round(MIN_LENGTH_RATIO * 100)}%`
    );
    return '';
  }

  return out;
}

export const rewriteModel = MODEL;
