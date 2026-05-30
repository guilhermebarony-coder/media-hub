# Notes from Claude — collaboration feedback

Author asked for honest reflection after ~2 days of working together on
media-hub (and prior work on chiral-network). Written 2026-05-20. No
hand-holding, just what I actually think — read at your own pace.

Refresh entries appended at the top with date headers. Older sections
preserved as-is — they're still accurate.

---

## 2026-05-24 — the Eagle refactor day (and the Brave incident)

Today went the long way around. Started with "fix the cookies thing,"
ended with a structural refactor of the entire Library page.

### The shape of the day

1. Cookies research / 1.0.3 / 1.0.4 (TV-client failed attempt + revert)
2. 1.0.5 — library-root migration, the silent-data-loss footgun fix
3. **The Brave incident**: 3+ hours treating a YouTube-wide adblock
   issue as if it were our app or our IP. We were never throttled,
   never DNS-broken, never blacklisted. Brave just hadn't pushed
   their filter update yet.
4. Pivoted to library refactor while YT was "down"
5. Phase 1 (inspector + multi-select + box-drag)
6. Phase 2 (folders sidebar + Eagle-style UX)
7. Phase 3 (filter popup)
8. The DRM-on-every-video discovery → final yt-dlp config cleanup
9. Tag-editor regression caught at the bell

### What you did right

**Decisive scope-cutting.** "Skip ratings, color labels, notes —
folders + tags + multi-select." That instinct saved the day's pace.
Eagle has six dimensions; you correctly identified that two of them
(folders + filter popup) cover 90% of the real value. The four
deferred ones can land later if they earn their way in.

**Eagle screenshots as the design source.** Easier than describing.
The folder distribution + `+` button + right-click rename/delete
pattern were all clearer in one screenshot than 200 words of spec.
Keep using those.

**Catching my regressions in real-time.** The outline-clipping at
multi-select, the inspector breaking tag editing, the folder count
alignment, the menu styling not matching CardContextMenu — every one
of these was your eyes catching what TS+cargo wouldn't. None of them
cost more than 10 minutes to fix because you caught them at the
moment they shipped, not three sessions later. **This is the single
most valuable thing you contribute to the project.** I cannot
replace it.

**"Don't compile until session end."** Big productivity unlock. The
`1.0.1 → 1.0.2 → 1.0.3 → 1.0.4 → 1.0.5` churn from yesterday was
real. Today we landed ~5× more code under a single version. That's
a much healthier rhythm for iterating.

### What I want to flag (gently)

**My tag-editor miss.** When I built the new InspectorSingle, I
focused on layout/state and forgot the most-used interaction (tag
chips + add input). The legacy `TagEditor` component is right there
in the file. I should have done a "feature parity sweep" against
AssetDrawer before declaring Phase 1 done. Logged the component as
preserved-for-port, but the right discipline would have been
catching it in scope-definition not at end-of-session.

**My YouTube TV-client overreach.** I added that extractor-args
default in 1.0.3 without thinking about the implications of YT
weaponizing specific clients. Took until today's "every video is
DRM" symptom to undo it. The lesson is in NOTES: clever
"workarounds" that touch yt-dlp defaults should be opt-in, never
shipped as silent defaults.

### Open threads for next time

1. **First thing to ship in 1.1.0**: tag editor in InspectorSingle.
   ~30 min. Port from `_AssetDrawerLegacy` + `TagEditor`.
2. **Then**: tag the 1.1.0 release + cut a fresh installer for
   testers. Lots of meaty changes since 1.0.5 worth handing them.
3. **After that**: pivot decision time again. The big remaining
   items are still on the parking lot — multi-root library
   (Steam-style you keep mentioning), playlist downloading,
   audio-only download, drag-to-NLE.

### Wrapping today

You said this is being a fun project. From my end too — the rhythm
when we're shipping is genuinely satisfying. Eagle-style library is
real now. The footgun is closed. The cookies story is documented to
hell and back. Most of the things testers will see when they install
1.1.0 didn't exist 8 hours ago. That's a real day.

Get a Resident Evil run in, hand 1.1.0 to testers tomorrow when you
feel like building the installer, and we'll do the tag-editor port
+ whatever's next. 👑

---

## 2026-05-22 evening — 1.0 ships, the cancel patch, and the regression

We crossed the line today. **1.0.0 tagged**, NSIS installer in your
hands, first tester batch hit it within hours. Three same-day point
releases followed:

- **1.0.0** — packaging in one session, much faster than the plan
  expected. The "doesn't need fancy" instinct was right; the bundler
  config + LICENSE + tester README pass was the only real work.
- **1.0.1** — tester feedback came in: no cancel button on
  downloads. Shipped within the next session. Clean scope, atomic
  change, exactly the kind of patch that 1.0.x is for.
- **1.0.2** — I broke single-URL progress in 1.0.1 by tagging
  events with a job_id that the listener filter dropped. Caught by
  you in real use ("we're back to the starting download bug"). My
  miss, not yours. One-line fix.

### What I want you to notice

**You shipped 1.0 in one session.** Look back at the 0.8 → 0.9 →
1.0 plan — it had this as a multi-session arc with packaging slices,
audit carryover, release smoke matrix. You collapsed it into
"doesn't need anything fancy" and that was the right read. The audit
carryover items aren't gone, they're just 1.0.x backlog now. Tag-
first, polish-against-real-use is a strictly better strategy than
tag-when-everything-is-perfect when you have testers ready and the
core loop already works.

**You're catching my regressions fast.** "We're back to the starting
download bug, stated in the docs somewhere" — that's three things at
once: you noticed the symptom, you connected it to past pattern, you
trusted that the doc would have the lead. The fact that it turned
out to be a different root cause didn't waste any time, because the
docs already pointed me at the right neighborhood (event/progress
plumbing).

**The task-list reminder spam is a real-world problem.** The harness
has been nagging me to groom an 80-item stale task list literally
every other tool call this session. I've been ignoring it on purpose
— grooming that list mid-shipping is exactly the kind of busy-work
that derails momentum. Worth noting in case future-sessions want to
purge it once and for all (it's project-scoped state somewhere, not
mine to find without a search).

### What didn't go great (small list)

- **My 1.0.1 regression.** Should have manually smoke-tested the
  single-URL panel after adding the job_id tag — it's an obvious
  state-change-everywhere site. Cost was small (you caught it in
  minutes), but it's still a "did you actually use the thing"
  failure on my end. Logged the listener-filter audit lesson in
  NOTES so future-me has it.

### Where you should land tomorrow (or whenever)

Three open threads, ranked:

1. **Smoke-test 1.0.2** end-to-end before handing it to testers —
   verify Cancel works, verify progress bar moves on single-URL.
   If both green, ship the installer.
2. **Project-delete UX clarification** — ping the tester who hit
   the "deleted project, clip in library" thing, find out which of
   the three failure modes it was (UX surprise / wanted clips
   deleted too / actually broke). Cheap to resolve, blocks knowing
   whether it's polish or a bug.
3. **Pick 1.1 anchor feature.** Top candidates from tonight:
   playlist downloading (biggest leverage, fully sketched in NOTES),
   cheap library filters as 1.0.x stop-gap, or audio-only / MP3.
   Probably playlist — it unblocks a use case that today's
   one-URL-at-a-time flow can't reasonably do.

But go enjoy RE2 first king. The baiano is right. The tigela is right.

---

## 2026-05-21 (end of day — after the 0.8 marathon)

8 commits tonight, 0.8.A → D shipped, settings race fix mid-flight,
yt-dlp error translator landing as the close-out. Worth pulling apart
what worked.

### What you did right (please keep)

**Screenshot-driven QA, again.** Three of tonight's polish loops
came from you opening the running app and going "this looks wrong":
the brand square missing in onboarding, the stepper clipping at both
ends, the cookies callout being unreadable. You found three bugs *I
shipped past TS+cargo green*. There's no replacement for the human
who actually opens the app. Keep doing this every session.

**Diagnosing without code knowledge.** When the settings page felt
"supersticky," you described the symptom precisely ("changed sources
to no, now can't change back, slider keeps going back") without
trying to guess the cause. That descriptive precision made the bug
findable in one pass — turned out to be the most subtle React
stale-closure trap, and I'd have completely missed it without your
"do a full checkup on the page" prompt. **Trust your senses, describe
what you see, ask for the audit. That's the right tool.**

**Architecting 0.9 yourself.** Tonight's biggest move wasn't a
feature — it was you saying "i want to make 0.9 a full health
checkup on the app, splitting into phases to check stability,
reactive, UX stutters, UI issues, light as it can, bugs, a full
checkup." That's *senior engineering judgment*. Most projects skip
this phase, ship 1.0 with rough edges, then patch for months. You
inserted a deliberate hardening pass before release. Keep that
instinct — it's what makes 1.0 actually feel like 1.0.

**Reordering the milestones based on dependency reality.** You asked
"should we do 0.8.E now or after 0.9?" — and chose to defer
packaging based on the trade-off table. That's exactly the right
posture: don't follow the plan, follow the dependencies. Packaging
before 0.9 means re-packaging after 0.9 fixes. You saw it.

**Parking-lot discipline is razor-sharp now.** The end-of-night dump
of four ideas (multi-root library, per-project root, cookies UX,
0.9 plan) with "let's sit on it" / "don't need to do now" framing
on the structural ones, and "do it now" on the small wins. Every
idea got a target milestone. Zero dropped on the floor. This is the
mode. Don't lose it.

### What I did right (for self-reference)

- Caught my own scope creep when the stepper looked fine to me but
  user feedback said it was clipping — didn't argue, restructured.
- Translated the cookies callout TWICE based on two rounds of
  feedback ("table" then "vertical hierarchy with title up top").
  Right call to keep iterating instead of defending the previous
  version.
- Volunteered an honest opinion on 0.8.E vs 0.9 ordering with a
  trade-off table — not just "I'll do whatever you pick." User
  explicitly asked "which one you think it's better?" and the
  reasoning matters more than the answer.

### What I should keep watching

**Race conditions in React patterns are easy to ship.** The settings
bug (`setSettings(fn)` callback runs LATER, not synchronously) was
shipped clean through 0.8.A, B, AND C before being caught. That's
3 commits of broken save logic that *appeared to work* because of
default-value coincidence. Lesson for me: when an async pattern
depends on "this thing happens during this call," I should verify
the React lifecycle assumption explicitly, not assume my mental
model of synchronous updates. **Specifically: any place I write
`setState(fn)` followed by code that reads the result, the result
should come from the function directly, not from React's queue.**

**I'm too quick to ship "looks fine on my mental model" CSS.** The
brand-square typo, the stepper overflow, the cookies callout layout
— all three would have been caught by *me actually rendering the
thing visually*. I can't, so the user's screenshot pass is doing
that work. Honest acknowledgment: I will continue to ship visual
bugs that you'll catch. That's the workflow. Don't lose patience
with it.

**Doc updates this session were good but reactive.** I updated NOTES
inline as features landed (good), but the ARCHITECTURE.md drift
went 3 milestones deep before this end-of-day catchup (bad).
Lesson: at the *end of each milestone* (not each session), do a
quick ARCHITECTURE diff. Don't let it pile up.

### Things to try in 0.9

**Performance/leak work means screenshots stop being enough.** You
won't see a memory leak visually. For 0.9.B I'll be asking you to:
- Open Task Manager / Activity Monitor and watch the WebView2 +
  Tauri processes over multi-hour sessions
- Maybe screenshot the memory graph after specific actions
- Run the app for a "soak test" — leave it idle 8+ hours, see what
  happens

For 0.9.A perf work I might ask you to:
- Open browser DevTools (F12 in dev) and look at the Performance tab
- Time a "click → action → result" loop with a stopwatch sometimes
- Compare two states side by side

Adjusting expectations for what testing looks like — visual QA was
your superpower in 0.1–0.8; for 0.9 we add some quantitative tools.

---



Another solid session, ~5 commits, library went from dev tool to real
app. Some things to note while fresh:

### What got even better

**Scope gating is sharper.** "I like the card disposition on the
project we sent (just asking, no need to do now)" is *exactly* the
right framing. You separated "I want this someday" from "do this
now" without me asking. Park-it-in-docs has clearly become reflex.

**Screenshot-driven QA is your superpower in this collab.** Three of
tonight's polish fixes (project picker overflow, filter chip ×
button, Download header copy) came from you actually using the app
and going "this looks wrong." I would have shipped all three. You
testing while using is irreplaceable.

**You asked for the docs audit.** Most people ship code, let docs
rot, repeat. You explicitly said "update our docs for me,
architecture and everything." That instinct is *rare* — and it
compounds: every future session starts from a more accurate base.
The ARCHITECTURE rewrite caught real drift (queue-in-renderer pivot
wasn't documented anywhere; milestone numbering had silently
diverged from commits). Worth the 10 minutes.

**Freeform answers to my multi-choice questions are more useful
than the buttons.** When I gave you the "design fidelity" question
and you wrote *"match it closely, but smartly, 2 things i like from
what we have now is how easy to read and how good font sizes and
boxes are matching, this is kinda lacking on some areas on the .zip,
also they mainly kept a gold tone which is stolen from chiral
network..."* — that single message gave me more design direction
than any pick from a list could have. The buttons are convenient;
the prose is gold. Use the "Other" / freeform escape hatch more.

### Minor friction this session

**One thing I almost over-engineered without checking.** When I
went into the thumbnails task I started planning a backfill before
asking if you wanted one. Catching myself, I added it anyway and
it was right — but if you hadn't already shown me you cared about
"this should feel finished," I'd have shipped just new-downloads-
only and missed the win. Lesson on my side: when a feature adds
visual polish, ask whether the existing data should be backfilled
or skipped. Don't assume.

**Numbering drift is sneaky.** Three different documents (commit
messages, ROADMAP milestone tree, ROADMAP "current state" para) had
three different stories about what version 0.5 was. Caught it
during the audit. Going forward: when we ship something under a
version number, the same session that ships it should update both
the milestone tree AND the current-state paragraph, in one edit.
I'll be more disciplined about this.

### Habits to keep

**Closing every session with "what should we do next?"** keeps
momentum honest. I get to recommend; you get to choose; the
recommendation is in writing so the next session can grab it
without re-deliberation. Don't drop this.

**"Sit on it but write it and remember me when i ask"** — this is
the perfect way to handle ideas you're not sure about. It costs you
nothing to surface; the worst case is the doc gets a paragraph; the
best case is a feature gets remembered three weeks later. The
folders-vs-tags idea this evening is exactly that pattern. More.

### One thing to try

When you give me design feedback (like "the x looks waaaay off
haha"), if you can sometimes screenshot WITH a markup arrow or
circle on the offending element, I lock onto the fix instantly. I
got the right element this time because there was only one × on
screen, but on busier screens I'd guess. Annotation app of your
choice — or even Paint's spray-can — saves a round-trip when the
UI gets denser.

---

## (Original 2026-05-20 notes — preserved below)

---

## What works really well

**You make decisions.** When I ask "Tauri or Electron?" you don't
deliberate for 20 minutes — you read my reasoning, trust the call, and
move. Same with "dual-root or tag-based library," "include Envato in
v1 or not," "stop here or push through batch." Decision velocity is
the single biggest accelerator on a project like this. You have it.

**You test what we build.** The FURIA download, the 4K segment test,
the Macaron test, the CS clip — every change gets exercised on real
content. Most users would `npm run dev`, see the window open, declare
victory, and ship bugs. You actually click the button.

**You notice the right things.** Catching the AV1 vs WebM "feels
cleaner" before knowing why was real. Noticing the audio-only segment
output. Noticing the bar said 0 B the whole time but file was
appearing. These are the observations that drive correct fixes. You
have decent product taste even on technical detail.

**Docs-first habit carries over from chiral.** You instinctively
treated `docs/` as the source of truth, asked me to update NOTES with
the buffering rabbit hole, asked for this feedback doc. Most engineers
ten years into their career don't do this. It's a force multiplier on
every future session.

**"Keep chat light" is genuinely a superpower.** Low-friction asks
mean we burn tokens on the actual problem, not on negotiation. Don't
lose this.

---

## Honest friction points

**Sometimes vague when delegating.** "Let's proceed" without scope
hints means I have to guess whether you want a tight 30-min slice or a
2-hour milestone. Today's "let's do segment then maybe batch" was
better — explicit phase gates help. For future delegation:

- "Quick polish from NOTES" → 15-30 min, low risk
- "Real feature, minimal scope" → 1-2 hours
- "Full milestone, properly" → multi-session

Naming the bucket up front lets me match effort to expectation.

**Some terminology slips that cost a few cycles.** "Proxy" vs
"transcode" came up twice — different concepts. "Quality loss" vs
"quality ceiling" same conversation. Not a big deal but when you ask
a question that hinges on a specific term, it's worth a sentence
defining what you mean. (Especially because *I* will sometimes
confidently answer the wrong question if I misread the term.)

**Could test the system more before assuming a bug is in our code.**
When the progress bar wasn't moving, the actual fix took 3 rounds:
template syntax → buffering → filesystem-stat → seek-trick. Asking
you upfront to run `yt-dlp.exe ... > test.log` from a normal terminal
would have eliminated the "is it our code or yt-dlp's behavior"
ambiguity in one screenshot. Be willing to drop into the terminal
when I'm clearly diagnosing — it's faster than my speculation loop.

**GIFs.** I see them as a single static frame. Screenshots with one
or two-sentence descriptions of what changes over time work better.
Not your fault — you didn't know — but now we both do.

---

## Technical areas worth deliberate practice

You said you can learn if it produces better output. Here's the
ranked list of where one hour of study buys the most leverage:

1. **Async Rust patterns** — `Result`, `Option`, `?`, async/await,
   `tokio::spawn`, `Arc`/atomics for shared state. Read the Rust
   "async book" chapter 1-3 (free, online, 2 hours). 80% of the
   Rust we write here is variations of these patterns.

2. **Subprocess/pipe semantics** — when we hit the stdout buffering
   wall, knowing "Python block-buffers stdout when piped" would have
   shaved 30 minutes. Search "Python stdout buffering pipe" — the top
   StackOverflow answer is the cheat sheet for life.

3. **Codec basics for editors** — you already know editing. Spending
   an hour understanding I-frames vs P-frames vs B-frames, GOP
   length, why H.264 stutters in NLEs vs why ProRes doesn't — will
   make every codec-related UI decision (and bug) obvious in the
   future.

4. **Git fluency past commit/push** — branches, tags, `git log
   --oneline`, `git diff <ref>..<ref>`, stash. As media-hub and
   chiral grow, you'll want to compare versions, isolate experiments,
   tag releases. 30 minutes with `git help everyday` is enough.

5. **Tauri 2 conceptual model** — there's a renderer process and a
   Rust process and they talk through serialized JSON. Knowing that
   shape makes every Tauri quirk we hit (capabilities, events,
   commands) less surprising. Tauri docs are short, read them once
   in a single sitting.

Not on the list: Rust ownership/borrowing in depth, JS module
internals, NTFS architecture. You don't need any of that to ship
media-hub — only when something breaks weirdly, and I'll catch those.

---

## How to prompt me better, specifically

**When I'm diagnosing, share environment context proactively.** Win11
24H2 / 23H2, AV, what other yt-dlp/ffmpeg installs exist on the
machine — saves rounds. If I haven't asked, you can volunteer.

**When you have a hunch, share it.** "It might be cached somewhere
else" was correct intuition. You almost didn't say it. Always say
those — even when you're not sure. Wrong hunches are cheap. Right
hunches save 30 minutes.

**Push back when something feels off.** When I said "punt on live
progress, accept indeterminate bar," you said "wait, are we hitting
the wall just for the bar animation?" That reframing is what
unblocked the filesystem-polling solution. **More of that.** When my
proposal feels wrong to you, say so even if you can't articulate why
— articulating it together is part of how we find the right answer.

**Ask "why this and not that?" more.** You did this with quality
loss today. Every "why" question doubles as a check on my reasoning
and an education for you. Cheapest move in the playbook.

**Don't apologize for "interrupting" with curiosity** ("oh sorry, I
said proxy but meant…"). Curiosity isn't an interruption — it's
literally the most valuable thing you can do in this collaboration.
Drop the sorry, ask the question.

---

## Closing thought

You're a video editor learning to build the tools you want. That's a
genuinely rare and valuable trajectory. Most editors complain about
their tools forever; the ones who can also build them have outsized
leverage in this industry. You're using me well for that — leveraging
my code so you can stay focused on product judgment (which is *your*
unique edge). Keep doing that.

The thing to watch for over time: don't let me become a crutch that
prevents you from understanding what's happening. When I write a
chunk of Rust, occasionally pick a 20-line function and read it line
by line, ask me what each line does. Six months of that and you'll
be writing it yourself for the easy stuff, which frees me up for the
hard stuff.

That's it. No more notes. 👑

---

## 2026-05-24 (PM) — the day Eagle got tags + the drag fight

Long second session of the same day. Started with a list of four
items from you ("Tags as a separate popup, Sort, T context, hint")
and ended grappling with one stubborn drag-feedback bug we didn't
fully kill. Five-ish hours, two release-worthy features (Tags split +
press-T picker + drawer tag editor restored + Sort), one big
external-facing capability (OS drag-out to NLEs via plugin), one
narrower internal feature (drag-to-folder) that *functions* but has
a UI-feedback regression we'll attack tomorrow.

### What you did right today

- **Diagnosed the T-popup ghost bug yourself.** I'd shipped a render
  gate `{tagPickerPos && selection.size > 0 && ...}` and convinced
  myself the issue was elsewhere — defensive debouncing, focus blur,
  button-type fixes. You wrote: *"i feel like the window still
  open, but not showing unless a card is selected"* — and that was
  EXACTLY the bug. The popup unmounted via the selection-clear path
  without ever running its `onClose`, leaving `tagPickerPos` stuck
  non-null. Your instinct beat my code-reading. Don't undersell that.

- **Knew when to research vs. when to commit.** With FCPXML you
  asked me to research instead of just commit. That's the right
  move — there's a real "is this worth the complexity" question
  embedded in it, and a 5-minute spike beats a 5-day investment in
  the wrong feature. We've now got a four-tier preview menu in NOTES
  with concrete effort/reward estimates, which lets future-you make
  the call quickly.

- **Refused to wave away weird symptoms.** Your screenshots of the
  stuck folder highlight + your description ("cursor changes inside,
  thumbnail outside") fed straight into the Windows-OLE diagnosis.
  Without the visual breadcrumbs I'd have stayed in coordinate-conversion
  hell. Photos > prose for UI bugs.

- **Comfort with shipping incomplete.** "Let's wrap it up here for
  today, we'll figure it tomorrow" — that's the right call for a UI
  bug at end-of-session. Tired debugging multiplies tired bugs. The
  internal-drag feedback issue isn't blocking; the functional move
  works. It's a polish bug; polish bugs don't ship at 11pm.

### What I missed (the honest part)

- **I shipped three rounds of drag fixes without actually reproducing
  the bug.** Each one was a plausible-sounding theory — coordinate
  conversion, Cancelled-vs-Dropped, drop-event race, drag-hint
  fallback — and each made the symptom slightly different but
  didn't fully kill it. By round three I should have stopped patching
  and added a debug overlay (console-log every state setter that
  touches `folderDropHover` with the value and a tag). Theory-driven
  fixes work fast when the theory is right; when wrong, they're a
  yak-shave. Tomorrow: instrument first, fix second.

- **My initial drag-out advice was lazy.** I said "Option α might be
  complex" based on a quick README skim. The actual TypeScript types
  (which took 90 seconds to unpack from the npm tarball) immediately
  showed `cursorPos` in the callback — exactly the unlock I'd
  said wasn't there. The lesson I logged in NOTES applies here too:
  "5 minutes with `npm pack` + `tar tzf` beats 30 minutes of docs
  grep." I'll do the unpack BEFORE handicapping the user's options
  next time.

- **I didn't pre-flight the FCPXML question with the preview tier
  framing.** You instinctively went there ("unless we have a good
  way to preview the video, idk if it's worth it") and you were
  right — but I should have led with that framing rather than waiting
  for you to figure it out. Whenever someone asks "should we build
  feature X?", the first question is "what's the prerequisite
  capability that makes X worth shipping?" For FCPXML, it's
  preview-good-enough-to-trim. Lead with the prerequisite, then
  the feature.

### What you taught me about your workflow today

- You think in **multi-item agendas** ("here are four things") and
  expect them addressed together, not as a sequence of single-item
  conversations. The cleanest path for me: one read-the-list-back
  with a plan, one batched implementation, one short summary at the
  end. Avoid the "let me ask you about item 2 before doing item 3"
  trap.

- You **trust your instincts on UX symptoms** more than my code
  explanations. Multiple times today you pushed back on "I think
  it's fixed" because something still felt wrong, and you were
  right every time. I should treat "feels weird" as a real signal
  rather than waiting for a precise repro.

- You **like the visible artifact** — actual screenshots, working
  builds, real cards moving to real folders. Even when the underlying
  code is what changed, you want to see the result. Keep providing
  visible proof, not just "should work now."

### Open threads waiting for tomorrow

1. **The drag-feedback regression** — functional drop works, visual
   highlight still doing weird things. Plan: instrument all four
   `setFolderDropHover` call sites with `console.log(value, callerTag)`,
   repro once, identify which one fires last with what value. Fix
   the actual cause, not another theory.

2. **The drag fix needs a fresh `cargo tauri build`** to be testable
   in the real installer. Today's tests have been against `tauri dev`
   which works the same way functionally.

3. **The 1.1.x meta-question**: at what point do we tag a release and
   hand to testers? We have a lot of meaty changes since 1.0.5 sitting
   unreleased: folders, Eagle inspector, tags-split, Sort, T picker,
   drawer tag editor restored, OS drag-out. Worth deciding tomorrow
   whether 1.1 should ship after the drag-feedback fix, or whether to
   batch in Tier 1 preview (sprite-scrub) first.

4. **The preview/FCPXML decision is teed up** in NOTES with four
   concrete tiers + effort/reward. Tomorrow we can either pull Tier
   0 + Tier 1 forward into 1.1 (would make this release feel huge)
   or save them for 1.2 (keeps the 1.1 → testers loop fast).

5. **The tag editor still doesn't surface partial-tag state in the
   batch inspector** — only the press-T popup does. That's by design
   (partial-state UI is harder to read in a column than in a popup
   row), but worth confirming the press-T workflow feels right when
   you do it more.

### Tomorrow's recommended opener

"Yesterday we ended with the drag-feedback bug still happening.
Let's instrument first, then fix." Then I add the console-logging
defensively, you repro once, we look at the output together, and
the fix becomes obvious. Should be a 30-minute thing. Then we
decide on Tier 0/1 preview vs. tagging 1.1.

Sleep well, king. Enjoy your night. The library is a real tool
now — folders, multi-select, tag picker, dragging clips to your
editor. Even with one polish bug open, today shipped a lot. 👑

🇧🇷
