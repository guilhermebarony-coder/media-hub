/**
 * Platform detection + URL-shape helpers.
 *
 * Lifted out of Download.tsx (1.3.x) so the download orchestrator in
 * lib/downloads.tsx can stamp each library row with the correct
 * `platform` instead of hardcoding "youtube". The same predicates also
 * gate auto-fetch in the Download page so a pasted Pinterest URL kicks
 * off the same paste-to-fetch flow as YouTube.
 *
 * Adding a new source = one line in PLATFORM_PATTERNS. Both the URL
 * sniffer and the library platform stamp pick it up automatically.
 */

export type Platform =
  | "youtube"
  | "twitter"
  | "tiktok"
  | "pinterest"
  | "other";

/**
 * Patterns are matched against the lowercased URL, in order. First
 * match wins. The trailing entry has to be `other` as a fallback so
 * the helpers always return something — even an unknown URL goes
 * through yt-dlp; worst case it errors out with a clear message and
 * we land in the same failure path as before.
 */
const PLATFORM_PATTERNS: ReadonlyArray<{
  platform: Platform;
  test: (lowerUrl: string) => boolean;
}> = [
  {
    platform: "youtube",
    test: (u) =>
      u.includes("youtube.com") ||
      u.includes("youtu.be") ||
      u.includes("youtube-nocookie.com"),
  },
  {
    platform: "twitter",
    test: (u) => u.includes("twitter.com") || u.includes("x.com"),
  },
  {
    platform: "tiktok",
    test: (u) => u.includes("tiktok.com"),
  },
  {
    platform: "pinterest",
    // Both /pin/<id>/ and short pin.it/<id> need to match. The bare
    // "pinterest." matcher would over-match (profile pages aren't
    // downloadable), so we keep it tight to pin URLs.
    // pinimg.com (Pinterest's CDN) gets matched too — the extension's
    // Layer 1 fallback hands us direct pinimg.com URLs when it reads
    // the live <video>.src, and we want those library rows to show
    // the Pinterest badge, not "OTHER".
    test: (u) =>
      /pinterest\.[a-z.]+\/pin\//.test(u) ||
      /(^|\/\/)pin\.it\//.test(u) ||
      /\bpinimg\.com\//.test(u),
  },
];

export function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  for (const { platform, test } of PLATFORM_PATTERNS) {
    if (test(u)) return platform;
  }
  return "other";
}

/**
 * Used by the Download page to decide whether a freshly-pasted URL is
 * worth auto-fetching. Returns true only for known shapes so an
 * accidental partial paste doesn't fire yt-dlp.
 */
export function isLikelyVideoUrl(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("http://") && !t.startsWith("https://")) return false;
  return detectPlatform(t) !== "other";
}

/**
 * Pinterest (and to a lesser extent Twitter) sometimes shoves
 * `blob:https://...` URLs into the user's clipboard when they
 * right-click a video element inside the in-page lightbox preview.
 * Those URLs are JS-only handles that vanish the moment the tab
 * closes — yt-dlp can't touch them. Detect early and bail out with
 * an actionable message so the user knows to grab the real pin URL.
 */
export function isUndownloadablePreviewUrl(url: string): boolean {
  return /^blob:/i.test(url.trim());
}

/**
 * 1.3.x — URL looks like a direct media file we can pull over plain
 * HTTP without yt-dlp's extractor. Used as the gate for the
 * "Download as-is" fallback button: when the user pastes a CDN URL
 * that yt-dlp's generic extractor can't enumerate formats for, we
 * still know it's downloadable if the path ends in a known media
 * extension.
 *
 * Conservative on purpose — false negatives are fine (user just
 * doesn't see the fallback button), false positives offer the
 * button on a URL that won't actually return media bytes.
 */
const DIRECT_MEDIA_EXT_RE =
  /\.(mp4|m4v|mov|webm|mkv|avi|flv|m4a|mp3|aac|wav|flac|ogg|opus)(\?|#|$)/i;

export function isDirectMediaUrl(url: string): boolean {
  const t = url.trim();
  if (!t.startsWith("http://") && !t.startsWith("https://")) return false;
  return DIRECT_MEDIA_EXT_RE.test(t);
}
