// Lightweight, dependency-free scored search for the Help page.
//
// Goal: handle natural-language queries ("what does fast download do") and
// typos ("downlod", "cookis"), not just exact tag matches — while staying
// tiny and instant (pure JS over ~60 entries, no ML, no deps).
//
// How: drop filler words, then SCORE + RANK entries (match more words = rank
// higher) instead of requiring every word to match. Hits are weighted by
// field (title > keywords > category > body), tolerant of small typos, and
// expanded through a small synonym map so people can phrase things their way.

import type { HelpCategory, HelpEntry } from "./helpContent";

// Common filler words to ignore so "what does fast download do" reduces to
// the words that carry meaning ("fast", "download"). If a query is ALL
// stopwords we keep them (so "how to" still searches something).
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "am", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "how", "what", "whats", "when", "where", "why",
  "which", "who", "to", "of", "for", "on", "in", "into", "with", "and", "or",
  "i", "my", "me", "it", "its", "this", "that", "these", "those", "you", "your",
  "can", "could", "would", "should", "will", "shall", "get", "got", "use",
  "using", "please", "if", "then", "there", "here", "about", "as", "at", "by",
  "from", "so", "just", "want", "wanna", "need", "some", "any", "thing",
]);

// Synonym boost — maps a word people might type to the vocabulary the entries
// actually use. Applied per query word (the word matches if IT or any of its
// synonyms is found), so it never dilutes ranking, only helps.
const SYNONYMS: Record<string, string[]> = {
  convert: ["transcode"], converting: ["transcode"], conversion: ["transcode"],
  encode: ["transcode"], reencode: ["transcode"], render: ["transcode"],
  proxy: ["transcode", "preview", "editing"],
  song: ["audio", "music"], music: ["audio"], mp3: ["audio"], sound: ["audio"],
  podcast: ["audio"],
  remove: ["delete", "trash"], erase: ["delete", "trash"], del: ["delete"],
  bin: ["trash", "recycle"], undo: ["restore", "trash"], recover: ["restore", "trash"],
  login: ["cookies", "signin", "sign", "account"], signin: ["cookies", "sign"],
  auth: ["cookies", "login"], password: ["cookies", "login"],
  laggy: ["slow"], lag: ["slow"], lags: ["slow"], stutter: ["slow"],
  buffering: ["slow"], choppy: ["slow"], janky: ["slow"],
  fast: ["speed", "aria2", "faster"], quick: ["speed", "fast"],
  faster: ["speed", "fast"], quicker: ["speed", "fast"], accelerate: ["speed"],
  location: ["library", "folder", "root", "path"], save: ["library", "download", "root"],
  where: ["library", "folder", "location"],
  cut: ["segment", "trim", "in", "out"], trim: ["segment"], clip: ["segment", "card"],
  section: ["chapter", "segment"], part: ["chapter", "segment"],
  hide: ["background", "tray", "minimize"], minimize: ["background", "tray"],
  close: ["background", "tray"], keybind: ["shortcut", "keyboard"],
  hotkey: ["shortcut", "keyboard"], keys: ["shortcut", "keyboard"],
  tag: ["tags", "label"], label: ["tags"], color: ["colour", "folder"],
  quality: ["preview", "resolution", "format"], resolution: ["format", "quality"],
  broken: ["repair", "fails", "failed"], fix: ["repair", "troubleshoot"],
  error: ["fails", "failed", "troubleshoot"], crash: ["fails", "failed"],
};

/** Bounded Levenshtein — returns early (max+1) once distance exceeds max. */
function boundedLev(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    let rowBest = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowBest) rowBest = v;
    }
    if (rowBest > max) return max + 1;
    prev = cur;
  }
  return prev[bl];
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type Field = { words: string[]; weight: number };
type IndexedEntry = { entry: HelpEntry; fields: Field[] };
export type HelpIndex = IndexedEntry[];

/** Build the (memoizable) search index once per content set. */
export function buildHelpIndex(entries: HelpEntry[], categories: HelpCategory[]): HelpIndex {
  const catTitle = new Map(categories.map((c) => [c.id, c.title]));
  return entries.map((entry) => ({
    entry,
    fields: [
      { words: words(entry.title), weight: 10 },
      { words: entry.keywords.flatMap((k) => words(k)), weight: 7 },
      { words: words(catTitle.get(entry.category) ?? ""), weight: 3 },
      { words: words(entry.body.join(" ") + (entry.tip ? " " + entry.tip : "")), weight: 2 },
    ],
  }));
}

/** Best match quality (0..1) of one query variant against one field word. */
function wordQuality(token: string, word: string): number {
  if (word === token) return 1;
  if (word.startsWith(token) || token.startsWith(word)) return 0.72;
  if (token.length >= 3 && word.includes(token)) return 0.45;
  if (token.length >= 4) {
    const max = token.length >= 6 ? 2 : 1;
    const d = boundedLev(word, token, max);
    if (d <= max) return d === 1 ? 0.55 : 0.4;
  }
  return 0;
}

/** Score one entry against the meaningful query tokens. 0 = no match. */
function scoreEntry(ix: IndexedEntry, tokens: string[]): number {
  let total = 0;
  let matched = 0;
  for (const token of tokens) {
    const variants = [token, ...(SYNONYMS[token] ?? [])];
    let best = 0;
    for (const field of ix.fields) {
      for (const w of field.words) {
        let q = 0;
        for (const v of variants) {
          const vq = wordQuality(v, w);
          // Synonym hits count slightly less than a direct hit.
          const adj = v === token ? vq : vq * 0.85;
          if (adj > q) q = adj;
        }
        if (q > 0) {
          const s = q * field.weight;
          if (s > best) best = s;
        }
      }
    }
    if (best > 0) {
      total += best;
      matched++;
    }
  }
  if (matched === 0) return 0;
  // Coverage bonus: reward matching more of the distinct query words, so a
  // result hitting both "fast" AND "download" outranks one hitting just one.
  return total * (0.55 + 0.45 * (matched / tokens.length));
}

/**
 * Search the index. Returns entries with score > 0, most relevant first.
 * Empty/whitespace query returns [] (caller shows the full browse view).
 */
export function searchHelp(index: HelpIndex, rawQuery: string): HelpEntry[] {
  const all = words(rawQuery);
  if (all.length === 0) return [];
  let tokens = all.filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) tokens = all; // query was all filler — search it anyway
  // De-dupe tokens.
  tokens = [...new Set(tokens)];

  const scored: { entry: HelpEntry; score: number }[] = [];
  for (const ix of index) {
    const score = scoreEntry(ix, tokens);
    if (score > 0) scored.push({ entry: ix.entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}
