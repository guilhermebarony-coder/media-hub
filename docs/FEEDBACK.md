# Notes from Claude — collaboration feedback

Author asked for honest reflection after ~2 days of working together on
media-hub (and prior work on chiral-network). Written 2026-05-20. No
hand-holding, just what I actually think — read at your own pace.

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
