# Media Hub — Docs Index

Quick map so nobody (human or Claude) has to guess where a thing lives.

## Active docs (keep current)

| Doc | What it is | Update when… |
|-----|-----------|--------------|
| **ARCHITECTURE.md** | The map — what's actually built and where it lives. Layers, modules, data flow, the extension stack. | A structural decision lands (new module, new layer, schema change). |
| **ROADMAP.md** | Milestone tree + decision log + cut-lines. What shipped, what's next, what we decided against. | A milestone ships or a new one is planned. |
| **NOTES.md** | Living parking lot — dated entries, newest on top. Gotchas, design write-ups, release-process notes, ideas too small for ROADMAP. | Anytime something is worth remembering cold. |
| **FEEDBACK.md** | Collaboration notes (personal, timeless). Honest reflections on how the work is going. | Whenever there's something real to say. |

## history/ — frozen records

Completed plans and point-in-time snapshots. Kept for provenance, **not**
maintained. Don't add new work here; don't trust the version numbers as
current. See `history/README.md` for the contents.

## Conventions

- **Dates** are `YYYY-MM-DD`. NOTES.md and FEEDBACK.md prepend new entries.
- **Status glyphs:** ✅ shipped · 🟡 planned/in-progress · ❌ decided against.
- **Version source of truth:** `package.json` / `src-tauri/tauri.conf.json` /
  `src-tauri/Cargo.toml` (kept in lockstep). Docs describe; code decides.
