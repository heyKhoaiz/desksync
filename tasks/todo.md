# Todo: the note editor

**Direction changed (2026-11-20): notes are plain text.** The formatting toolbar,
markdown, checklists, our own undo stack and the "Copy as markdown" / "Hide tick
boxes" / "Ticked items to the bottom" menu entries are gone. The editor is a
`<textarea>` in the extension and a plain `TextField` on the phone, and both save
`format = 'plain'`. [plan.md](plan.md) describes the markdown editor this replaced;
its toolbar, markdown and checklist tasks no longer apply.

## Next: local-first, account optional
Plan: [local-first.md](local-first.md).
- [x] Phase 1: local store, `db` on top of it, push/pull sync, `unlimitedStorage`
- [x] Phase 2: no sign-in required; local vault; background actions work signed out
- [x] Phase 3: sign-in adopts this device's data; sign-out keeps it; vault conflict choice
- [x] Phase 4: export / import
- [ ] Phone app without an account (decided: not now)

## Done
- [x] Draft stashed as you type, replayed by the next popup or the service worker
- [x] Plain-text editor in the extension (textarea, no toolbar)
- [x] Notes read as plain text everywhere; old `html`/`markdown` notes flattened on open
- [x] Phone reads `format` and writes `format = 'plain'`
- [x] Migration `002_plain_text_notes.sql` (allows `plain`); extension falls back to
      `markdown` with a message when it has not been run
- [x] A colour per note, the ⋮ menu (Duplicate, Copy text, Delete)

## Still worth doing
- [ ] Run `supabase/migrations/002_plain_text_notes.sql` on the live database
- [x] `aria-live` off `#detail`, onto the save status
- [x] A save status that tells the truth, with a working retry
- [x] Long notes: word count (scroll shadow not done)

## Dropped with the toolbar
Toolbar keyboard access, task box as a checkbox, links you can edit, fenced code,
nested lists, heading levels, checklist reordering, shortcut sheet.

## Product plan: developers, marketers, daily users (2026-11-20)
Goal: the two-second drawer for everything you would otherwise lose in a tab.

- [x] Side panel (`?view=panel`), stacked layout when narrow; full tab view (`?view=tab`)
- [x] Shortcuts: Alt+Shift+K new note, Alt+Shift+V save clipboard (openPopup, tab fallback)
- [x] Save selection keeps `Source: <url>`
- [x] Welcome as three steps you can click
- [x] Secrets: masked, out of search, *To vault*, skipped by capture (`lib/detect.js`)
- [x] Code clips in monospace
- [x] Address bar keyword `ds`
- [x] Insert into page (Shift+Enter), so notes work as snippets
- [x] Note on a saved link; search covers notes' full text and link notes
- [x] Copy the filtered list as text
- [x] Today filter (Ctrl+0), optional *Start on Today*
- [x] Unread count on the icon
- [x] Rail labels, favicons, note colour edge, Enter hint in the footer, empty states per filter
- [x] PRIVACY.md, docs/STORE_LISTING.md, README
- [ ] Try in real Chrome: side panel, openPopup from a shortcut, omnibox, Insert on Gmail/Docs/Notion
- [ ] Store screenshots (list in docs/STORE_LISTING.md)
- [ ] Support email in PRIVACY.md, and host it
