// Harness for content-portal.js's visibility/arbitration rules.
// Extracts the three pure-ish geometry functions from the real source
// (no copy — if the source changes, this tests the new code) and runs
// them against fake DOM rects.

const fs = require("fs");
const src = fs.readFileSync("F:/CLAUDE/media-hub/extension/content-portal.js", "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0,
    i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

// Fake DOM: a node is { rect, kids, clips }.
let VW = 1080,
  VH = 950;
global.window = {
  get innerWidth() {
    return VW;
  },
  get innerHeight() {
    return VH;
  },
};
global.Date = Date;
global.WeakMap = WeakMap;
global.getComputedStyle = (n) => ({
  overflow: n.clips ? "hidden" : "visible",
  overflowX: "",
  overflowY: "",
});

function node(rect, opts = {}) {
  return {
    ...opts,
    rect,
    isConnected: true,
    parentElement: null,
    getBoundingClientRect: () => rect,
    querySelectorAll: (sel) => (opts.videos || []),
  };
}
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const code = [extract("clippersFor"), extract("visibleFraction"), extract("isDominantVideo")].join(
  "\n",
);
const ctx = { window: global.window, getComputedStyle: global.getComputedStyle, Date, WeakMap, Math };
const factory = new Function(
  "window",
  "getComputedStyle",
  "document",
  `${"const clipperCache = new WeakMap(); const CLIPPER_TTL_MS = 1000;"}\n${code}\nreturn { visibleFraction, isDominantVideo, clippersFor };`,
);
const { visibleFraction, isDominantVideo } = factory(global.window, global.getComputedStyle, {
  body: {},
  documentElement: {},
});

let pass = 0,
  fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
  ok ? pass++ : fail++;
}
function approx(label, got, want) {
  const ok = Math.abs(got - want) < 0.02;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${got.toFixed(3)}, want ~${want})`);
  ok ? pass++ : fail++;
}

// ---- Scenario 1: the screenshot. Feed column 470px wide at x=300.
// Current slide fills it; the previous slide sits one width to the left,
// half of it off the left edge of the screen. No clipper found (this is
// the case that produced the ghost).
const curR = rect(300, 100, 470, 470);
const prevR = rect(-170, 100, 470, 470);
const cur = node(curR);
const prev = node(prevR);
const article = node(rect(300, 60, 470, 700), { videos: [prev, cur] });
cur.parentElement = null;
prev.parentElement = null;

const fCur = visibleFraction(cur, curR, article);
const fPrev = visibleFraction(prev, prevR, article);
approx("slide atual: fração", fCur, 1.0);
approx("slide anterior (fantasma): fração", fPrev, 0);
check("slide atual mantém o botão", isDominantVideo(cur, fCur, article), true);
check("slide anterior PERDE o botão", isDominantVideo(prev, fPrev, article), false);

// ---- Scenario 2: X/Twitter — two videos side by side, both fully on
// screen. Neither may suppress the other (media_index picks the right one).
const aR = rect(300, 100, 230, 230);
const bR = rect(540, 100, 230, 230);
const a = node(aR),
  b = node(bR);
const tweet = node(rect(300, 60, 470, 400), { videos: [a, b] });
const fa = visibleFraction(a, aR, tweet),
  fb = visibleFraction(b, bR, tweet);
check("X: vídeo esquerdo mantém botão", isDominantVideo(a, fa, tweet), true);
check("X: vídeo direito mantém botão", isDominantVideo(b, fb, tweet), true);

// ---- Scenario 3: portrait reel TALLER than the viewport. Must still
// clear the 0.5 bar, otherwise it never gets a button.
const tallR = rect(400, -100, 500, 1100);
const tall = node(tallR);
const tallPost = node(rect(400, -100, 500, 1100));
const fTall = visibleFraction(tall, tallR, tallPost);
console.log(`      (reel alto: fração ${fTall.toFixed(3)})`);
check("reel mais alto que a tela passa do 0.5", fTall >= 0.5, true);

// ---- Scenario 4: mid-swipe, slide 60/40 across the container edge.
// The more-visible one wins; exactly one button.
const s1R = rect(60, 100, 470, 470); // 60% in
const s2R = rect(530, 100, 470, 470); // trailing
const s1 = node(s1R),
  s2 = node(s2R);
const car = node(rect(300, 60, 470, 700), { videos: [s1, s2] });
const f1 = visibleFraction(s1, s1R, car),
  f2 = visibleFraction(s2, s2R, car);
console.log(`      (swipe: saindo ${f1.toFixed(2)}, entrando ${f2.toFixed(2)})`);
const winners = [
  f1 >= 0.5 && isDominantVideo(s1, f1, car),
  f2 >= 0.5 && isDominantVideo(s2, f2, car),
].filter(Boolean).length;
check("meio do swipe: exatamente um vencedor", winners, 1);

// ---- Scenario 5: single-video post — never arbitrated away.
const solo = node(rect(300, 100, 470, 470));
const soloPost = node(rect(300, 60, 470, 700), { videos: [solo] });
check("post de 1 vídeo mantém o botão", isDominantVideo(solo, 1, soloPost), true);

// ---- Scenario 6: no scope (reels viewer, no <article>) — no arbitration.
check("sem escopo: mantém o botão", isDominantVideo(solo, 1, null), true);

// ---- Scenario 7: slide fully off screen to the left.
const goneR = rect(-500, 100, 470, 470);
const gone = node(goneR);
approx("slide totalmente fora da tela: fração 0", visibleFraction(gone, goneR, article), 0);

function baseRuleOnly(css) {
  // Drop the .mh-hidden rule so the base-rule assertion can't match it.
  return css.replace(/\.mh-overlay-btn\.mh-hidden\s*\{[^}]*\}/g, "");
}

// ---- Root-cause guard (1.13.4). Every rule in content-overlay.css is
// !important to beat host-site resets, and an !important stylesheet
// declaration outranks an element's INLINE style. So hiding the overlay
// button with `btn.style.display = "none"` was inert for the whole life
// of the feature: "hidden" buttons stayed rendered at stale coordinates,
// held back only by opacity — and surfaced as the ghost whenever
// .mh-visible got stuck on one (a slide leaving from under the cursor
// fires no pointerleave). Verified live on instagram.com: 6 of 6 buttons
// computed `display: flex` while the JS believed 4 were hidden.
const css = fs.readFileSync("F:/CLAUDE/media-hub/extension/content-overlay.css", "utf8");
check(
  "CSS ainda tem display !important no botao (a armadilha)",
  /\.mh-overlay-btn\s*\{[^}]*display:[^;]*!important/.test(baseRuleOnly(css)),
  true,
);
check(
  "CSS tem a regra que realmente esconde",
  /\.mh-overlay-btn\.mh-hidden\s*\{[^}]*display:\s*none\s*!important/.test(css),
  true,
);
check(
  "menu rapido tambem esconde por classe",
  /\.mh-menu-row\.mh-row-off\s*\{[^}]*display:\s*none\s*!important/.test(css),
  true,
);
// Strip comments — the explanation of the bug quotes the old line.
const srcNoComments = src.replace(/^\s*\/\/.*$/gm, "");
check("JS nao esconde o botao por style.display (seria inerte)", /btn\.style\.display\s*=/.test(srcNoComments), false);
check("JS usa a classe mh-hidden", /classList\.toggle\("mh-hidden"/.test(src), true);
check("esconder tira o hover-reveal grudado", /classList\.remove\("mh-visible"\)/.test(src), true);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
