# Notes from Claude — collaboration feedback

Author asked for honest reflection after ~2 days of working together on
media-hub (and prior work on chiral-network). Written 2026-05-20. No
hand-holding, just what I actually think — read at your own pace.

Refresh entries appended at the top with date headers. Older sections
preserved as-is — they're still accurate.

---

## 2026-05-20 (evening refresh — after UI overhaul session)

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
