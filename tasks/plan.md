# Implementation Plan: the note editor, after the markdown rewrite

> **Superseded (2026-11-20).** Notes are plain text now: no toolbar, no markdown,
> no checklists. Most of this plan was about the markdown editor and no longer
> applies. See [todo.md](todo.md) for what was done and what is left.

## Overview

The editor now edits the rendered note in place and stores markdown. That change
is good, and it left four kinds of debt behind: a save path that can lose the
last words you typed, an Android app that has never heard of markdown, a toolbar
only a mouse can reach, and a set of everyday editor moves (undo, editing a
link, indenting a list) that are missing or broken.

This plan fixes them in that order: data first, then reach, then the moves
people expect — then, taking Google Keep as the reference for what a checklist
should feel like, the grip, the "+ List item" row, the sinking tick and the
colour per note. Every phase leaves the extension shippable.

## Where the problems are

Audited against the Web Interface Guidelines
(`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`)
and by reading the save path end to end.

**Correctness**

- `extension/popup.js:1121` — the autosave debounce is 700 ms and nothing flushes
  it when the popup goes away. A Chrome popup is dismissed by clicking anywhere
  else in the browser, which is the normal way to leave it. There is no
  `pagehide`, `visibilitychange` or `blur` listener in the file: the last words
  typed are in `state.draft` only, and they go with the window.
- `mobile/lib/data/note_html.dart:15` — the phone parses every note body as HTML
  and knows nothing of the `format` column. A note written in the extension now
  shows on the phone as its own markup: `## Shopping`, `- [ ] milk`. Edit it
  there and `plainToNoteHtml` (`note_html.dart:60`) saves `<br>`-joined HTML
  while the row still says `format: 'markdown'`, so the extension renders the
  tags back as literal text. Notes do not survive a round trip between the two.
- `extension/popup.js` — `tidyEditor` rewrites the DOM after every command, so
  Ctrl+Z walks into the rewritten state rather than the one before the command.
  There is no undo stack of our own.

**Accessibility**

- `extension/popup.js:1037` — the formatting buttons listen on `mousedown` only.
  Tab to Bold, press Enter or Space: nothing happens. The toolbar is unusable
  from the keyboard.
- `extension/popup.js:1029` — the toolbar has no `role="toolbar"` and no roving
  tabindex, so it is twelve separate tab stops between the title and the note.
- `extension/popup.js:1072` — a task checkbox is a `<span>` with a click
  handler: no focus, no key, no `aria-checked`. Click-only is the one way to
  tick something off.
- `extension/popup.html:109` — `#detail` carries `aria-live="polite"` and the
  whole editor is rendered inside it, so a screen reader re-announces the note
  while you type in it. The live region belongs on the save status alone.
- `extension/popup.js:1534` — the link field applies on blur, so clicking away
  commits a half-typed address with no way back (there is no undo).

**Missing, for an editor**

- No fenced code block, though `md.render` makes them and the Android app would
  show them.
- No nested lists: Tab does nothing, and `md.render` only parses flat ones.
- One heading level from the toolbar (H2), though markdown and the renderer
  both do three.
- A link, once made, cannot be opened, changed or removed from the editor.
- `#ed-saved` says "Saved" before anything has been saved, and says nothing
  about when.

## Architecture decisions

- **The service worker owns the last write.** A popup cannot finish an async
  Supabase call while it is being destroyed. The draft goes to the existing
  outbox in `extension/lib/client.js` (`OUTBOX_KEY`), which the service worker
  already replays — the durable path exists, the editor just does not use it.
- **Markdown is the format; the phone learns it.** The alternative — making the
  extension write HTML again — throws away a format that a human can read in the
  database and that the Android share sheet can produce. The phone gets a small
  markdown reader instead, mirroring `extension/lib/markdown.js`.
- **No contenteditable library.** MV3 forbids remote code, a vendored editor is
  a large dependency to carry, and the current approach (render → edit → read
  back) already works. Undo is the one piece worth writing by hand.
- **Nothing new in the markdown dialect until both ends read it.** Nested lists
  and fenced blocks ship only with the phone able to display them.

## Task list

### Phase 1: the note cannot be lost

#### Task 1: Flush the draft when the popup goes away

**Description:** On `pagehide` (and `visibilitychange` → hidden), write any
dirty draft straight into the outbox in `chrome.storage.local` rather than
starting a Supabase call that will be killed. The service worker replays it.
Shorten the debounce to ~400 ms while leaving the single-flight save queue
alone.

**Acceptance criteria:**
- [ ] Typing, then closing the popup, keeps every character.
- [ ] A new note closed mid-typing is created once, not twice (the outbox entry
      and the next popup's save must not both insert).
- [ ] Nothing is queued for a note that was opened and not typed into.

**Verification:**
- [ ] `make test-ui` — new cases: dispatch `pagehide` with a dirty draft, assert
      the outbox holds the row; then boot again and assert it syncs once.
- [ ] Manual: type in a note, click the page behind the popup, reopen.

**Dependencies:** None
**Files:** `extension/popup.js`, `extension/lib/client.js`, `tests/ui/cases.js`,
`tests/ui/fixtures.js`
**Scope:** M

#### Task 2: The phone reads and writes markdown

**Description:** Give the Flutter app the reading half of
`extension/lib/markdown.js`: a `noteSpans`/`noteText` that branch on the row's
`format` column, and a plain-text editor that saves markdown with
`format: 'markdown'` instead of `<br>` HTML. Legacy HTML notes keep rendering as
HTML, exactly as the extension does.

**Acceptance criteria:**
- [ ] A markdown note shows bold, headings, lists and checklists on the phone,
      not its markup.
- [ ] Editing a note on the phone and reopening it in the extension shows the
      same note, still as markdown.
- [ ] A pre-markdown HTML note is unchanged on both ends.

**Verification:**
- [ ] `cd mobile && flutter test` — round-trip cases per block type.
- [ ] Manual: edit one note on each side in turn.

**Dependencies:** None (parallel with Task 1)
**Files:** `mobile/lib/data/note_html.dart` (+ a new `note_markdown.dart`),
`mobile/lib/screens/notes_screen.dart`, `mobile/test/…`
**Scope:** M

### Checkpoint: Phase 1
- [ ] `make test` green (extension + mobile)
- [ ] A note written on either device reads correctly on the other
- [ ] Nothing typed is lost by closing the popup

### Phase 2: everyone can reach it

#### Task 3: The toolbar works from the keyboard

**Description:** Keep `mousedown` for the mouse (it is what preserves the
selection), and add `keydown` for Enter and Space. Make the tools one tab stop:
`role="toolbar"`, arrow keys moving between buttons, `tabindex="-1"` on all but
the active one. Restore the selection before applying when the press came from
the keyboard.

**Acceptance criteria:**
- [ ] Tab from the title reaches the toolbar once, then the note.
- [ ] Arrow keys move along the tools; Enter and Space apply one.
- [ ] A selection in the note survives a keyboard-applied tool.

**Verification:**
- [ ] `make test-ui` — keyboard-only path for bold, bullet, task.
- [ ] Manual: unplug the mouse, format a line.

**Dependencies:** None
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** S

#### Task 4: A checkbox you can tick without a mouse

**Description:** Give each task box `role="checkbox"`, `aria-checked`,
`tabindex="0"`, and Space/Enter to toggle. Keep `contenteditable="false"` and
the existing click target.

**Acceptance criteria:**
- [ ] Space on a focused box ticks it and saves.
- [ ] A screen reader announces "checked"/"not checked".
- [ ] `tidyTasks` keeps the attributes right after any edit.

**Verification:**
- [ ] `make test-ui` — key the box, assert the markdown says `- [x]`.
- [ ] Manual: VoiceOver/NVDA pass over a checklist.

**Dependencies:** None
**Files:** `extension/popup.js`, `extension/lib/markdown.js`, `tests/ui/cases.js`
**Scope:** S

#### Task 5: Stop announcing the note on every keystroke

**Description:** Take `aria-live` off `#detail` and put it on the save status
(`#ed-saved`, `role="status"`), which is the only part that updates by itself.
The detail pane keeps its `aria-label`.

**Acceptance criteria:**
- [ ] Typing in the editor announces nothing.
- [ ] "Saving…"/"Saved"/"Not saved" are announced.
- [ ] Selecting a row still announces what opened.

**Verification:**
- [ ] `make test-ui` — assert the attributes.
- [ ] Manual: screen reader while typing.

**Dependencies:** None
**Files:** `extension/popup.html`, `extension/popup.js`, `tests/ui/cases.js`
**Scope:** XS

### Checkpoint: Phase 2
- [ ] Every editor action is reachable by keyboard
- [ ] A screen reader pass produces no stream of chatter
- [ ] `make test` green

### Phase 3: the moves people expect

#### Task 6: Undo that survives the tidy pass

**Description:** Snapshot the editor's HTML and the caret before each command
and on typing pauses, into a bounded stack (~50). Bind Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z, restore the snapshot and the caret, then `readBack()`.
Coalesce plain typing so one undo is not one character.

**Acceptance criteria:**
- [ ] Undo after a toolbar command restores exactly the previous note.
- [ ] Undo after typing a word removes the word, not the letter.
- [ ] Redo returns to the undone state; the stack is bounded.

**Verification:**
- [ ] `make test-ui` — command, undo, assert markdown; typing, undo, redo.
- [ ] Manual: ten commands, ten undos, back to where you started.

**Dependencies:** Task 3 (shares the apply path)
**Files:** `extension/popup.js`, `tests/ui/cases.js`
**Scope:** M

#### Task 7: Links you can change

**Description:** Clicking a link in the editor opens a small bar under it:
the address, Open, Edit, Remove. Replace the blur-commits behaviour of the link
field with an explicit Enter/✓, and Escape cancelling.

**Acceptance criteria:**
- [ ] A link can be opened, retargeted and removed without retyping the words.
- [ ] Clicking away from the address field cancels rather than committing.
- [ ] The bar is keyboard reachable and closes on Escape.

**Verification:**
- [ ] `make test-ui` — make a link, edit it, remove it, assert the markdown.
- [ ] Manual: a note full of links.

**Dependencies:** Task 6 (so a mistake can be undone)
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** M

### Checkpoint: Phase 3
- [ ] Undo and redo behave as in any other editor
- [ ] `make test` green

### Phase 4: more of markdown, both ends

#### Task 8: Fenced code blocks

**Description:** A code-block tool and a ``` ``` ``` input rule. Enter inside a
fence makes a new line rather than a new block; the fence is left on a
triple-Enter or by the tool.

**Acceptance criteria:**
- [ ] A fenced block round-trips through `fromHtml` unchanged, newlines kept.
- [ ] Markdown inside a fence is not interpreted.
- [ ] The phone shows it as code (after Task 2).

**Verification:** `node tests/markdown.test.js`, `make test-ui`, manual paste of
a snippet.

**Dependencies:** Task 2
**Files:** `extension/popup.js`, `extension/lib/markdown.js`, `extension/popup.css`,
`tests/markdown.test.js`, `tests/ui/cases.js`
**Scope:** M

#### Task 9: Nested lists with Tab and Shift+Tab

**Description:** Tab indents the current item, Shift+Tab outdents. `md.render`
learns two-space indentation and `fromHtml` writes it back. One level of
nesting to start.

**Acceptance criteria:**
- [ ] Tab at the start of an item indents it; Shift+Tab takes it back out.
- [ ] `- a\n  - b` renders and round-trips.
- [ ] Tab anywhere else still moves focus.

**Verification:** `node tests/markdown.test.js` round-trip cases, `make test-ui`,
`flutter test` for the phone's reader.

**Dependencies:** Task 2
**Files:** `extension/lib/markdown.js`, `extension/popup.js`,
`mobile/lib/data/note_markdown.dart`, tests on both sides
**Scope:** M

#### Task 10: Heading levels and highlight

**Description:** The heading tool cycles H1 → H2 → H3 → off instead of toggling
H2, and a highlight tool produces `==text==`, which the renderer and the phone
already understand.

**Acceptance criteria:**
- [ ] Pressing Heading repeatedly walks the levels and off again.
- [ ] The button shows which level the caret is in.
- [ ] Highlight round-trips.

**Verification:** `make test-ui`.

**Dependencies:** Task 3
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** S

### Checkpoint: Phase 4
- [ ] Everything the dialect can express can be written from the toolbar or the
      keyboard, and read on the phone
- [ ] `make test` green

### Phase 5: the checklist, as Keep does it

Google Keep is the reference for what a note app's checklist should feel like:
an item has a grip you can drag, a row at the end that says "+ List item", a
tick that sinks the item out of the way, a colour per note, and everything else
folded into one ⋮ menu so the bar stays short. Four of those are cheap here.
What we deliberately do not take: the masonry card wall (this popup has a list
and a detail pane, which is better at 780px), drawings, images, collaborators
and "Copy to Google Docs".

#### Task 11: Reorder checklist items

**Description:** A grip on each task item (shown on hover, `contenteditable`
false) that drags the item up and down the list, and Alt+↑/↓ doing the same from
the keyboard. The `<li>` nodes move, then `readBack()` writes the new order —
markdown order is the stored order, so the phone sees the same list.

**Acceptance criteria:**
- [ ] Dragging an item moves it; the caret and the tick go with it.
- [ ] Alt+↑/↓ moves the item the caret is in, and keeps focus in it.
- [ ] The markdown's line order matches what is on screen.

**Verification:**
- [ ] `make test-ui` — move by keyboard, assert markdown order; synthesize a
      pointer drag and assert the same.
- [ ] Manual: a ten-item list, dragged around.

**Dependencies:** Task 6 (so a mis-drop can be undone)
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** M

#### Task 12: "+ List item", and ticked items sinking

**Description:** A dimmed "+ List item" row at the end of a checklist that adds
an item when clicked — the affordance Keep has and we leave to Enter. Ticking a
box moves the item below the unticked ones, under a thin "Done" divider; the
move is to the stored order too, so the phone agrees. The sinking is
remembered per note and can be turned off.

**Acceptance criteria:**
- [ ] Clicking "+ List item" adds an empty item with the caret in it.
- [ ] Ticking sinks the item; unticking returns it above the divider.
- [ ] With sinking off, ticking changes nothing but the tick.

**Verification:**
- [ ] `make test-ui` — tick, assert order in the markdown; untick, assert back.
- [ ] Manual: a shopping list, ticked in a random order.

**Dependencies:** Task 11
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** M

#### Task 13: A colour per note

**Description:** `notes.color` has existed since the first schema
(`supabase/schema.sql:14`, default `'yellow'`) and neither end reads it: the
extension paints every note header with the type's yellow, and the phone carries
the field unused. A small palette in the editor footer sets it; the header band,
the row's dot and the phone's card use it. Keep's palette, in our tokens.

**Acceptance criteria:**
- [ ] Choosing a colour shows at once in the header and the list row, and saves.
- [ ] Colours work in light and dark, and pass contrast against the header text.
- [ ] A note with an unknown colour value falls back to yellow.

**Verification:**
- [ ] `make test-ui` — set a colour, assert the row and the band; reopen.
- [ ] `flutter test` — the card uses it.
- [ ] Manual: both themes.

**Dependencies:** Task 2 (the phone is already being touched)
**Files:** `extension/popup.js`, `extension/popup.css`,
`mobile/lib/screens/notes_screen.dart`, tests on both sides
**Scope:** M

#### Task 14: One ⋮ menu, and undo where you can see it

**Description:** Keep's bar is short because everything rare lives behind ⋮. The
editor footer gets the same: Duplicate, Copy as markdown, Hide tick boxes (the
existing task toggle, named as Keep names it), Delete. Undo and redo become
buttons in the toolbar's right-hand group, next to the width toggle, so the
feature from Task 6 is visible rather than only bound to a key.

**Acceptance criteria:**
- [ ] The menu opens from the footer, closes on Escape, returns focus.
- [ ] Duplicate makes a second note and opens it; Copy as markdown puts the
      note on the clipboard.
- [ ] Undo and redo grey out when there is nothing to undo or redo.

**Verification:**
- [ ] `make test-ui` — each menu item; the buttons' disabled states.
- [ ] Manual: keyboard-only pass over the menu.

**Dependencies:** Tasks 3, 6
**Files:** `extension/popup.js`, `extension/popup.css`, `extension/popup.html`,
`tests/ui/cases.js`
**Scope:** M

### Checkpoint: Phase 5
- [ ] A checklist can be reordered, added to and ticked the way Keep's can
- [ ] A note's colour survives a trip through the phone
- [ ] `make test` green

### Phase 6: polish

#### Task 15: A save status that tells the truth

**Description:** "Saving…", "Saved just now", "Saved 3m ago" (one `Intl`
relative formatter, no hardcoded strings), and on failure "Not saved — Retry" as
a button rather than a dead label. Nothing says "Saved" before a save.

**Acceptance criteria:**
- [ ] A fresh note shows no save state until one happens.
- [ ] A failed save offers a retry that works.
- [ ] The label is the live region from Task 5.

**Verification:** `make test-ui` against the slow/failing server fixture.

**Dependencies:** Tasks 1, 5
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** S

#### Task 16: Tell people the shortcuts exist

**Description:** A `?` button in the editor bar opening a short sheet: the
markdown shorthands, the formatting keys, Alt+↑/↓, Esc, Cmd+Enter. Tooltips
already name them one at a time; this is the one place that lists them.

**Acceptance criteria:**
- [ ] Opens from the bar and from `?` when the note is not focused.
- [ ] Closes on Escape, returns focus where it was.
- [ ] Reads correctly on Mac and Windows/Linux.

**Verification:** `make test-ui`, manual on both platforms.

**Dependencies:** Tasks 3, 11
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** S

#### Task 17: Long notes

**Description:** A word count beside the save status, and a shadow under the
toolbar once the note is scrolled, so a long note does not look cut off.

**Acceptance criteria:**
- [ ] The count updates as you type and costs nothing per keystroke.
- [ ] The shadow appears only when scrolled.
- [ ] Nothing shifts the layout when either appears.

**Verification:** `make test-ui` layout assertions; manual with a 5,000-word note.

**Dependencies:** Task 15
**Files:** `extension/popup.js`, `extension/popup.css`, `tests/ui/cases.js`
**Scope:** S

### Checkpoint: Complete
- [ ] `make test` green: extension, markdown, offline, UI, Flutter
- [ ] A note written on the phone, edited in the extension and read back on the
      phone is the same note, in the same colour, with its list in order
- [ ] Keyboard-only and screen-reader passes over the editor are clean

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The outbox path double-writes a new note (Task 1) | High — duplicate notes, the bug the save queue was built for | Client-generated uuid for the row, as the outbox already does for offline rows; test the close-then-reopen path explicitly |
| The phone's markdown reader drifts from `markdown.js` | Med — the two render the same note differently | One list of cases shared by `tests/markdown.test.js` and the Flutter test, as a fixture file both read |
| Hand-written undo fights contenteditable's own (Task 6) | Med — confusing double-undo | Take over Ctrl+Z entirely inside the editor; never call `execCommand('undo')` |
| Nested lists widen the dialect faster than the phone follows | Med | Task 9 ships only after Task 2; renderer and reader land together |
| A roving tabindex traps focus (Task 3) | Low | Escape and Tab out tested in the UI suite |
| Dragging inside `contenteditable` fights the browser's own drag (Task 11) | Med — dropped text, lost caret | Drag the grip only, which is not editable; move `<li>` nodes directly rather than using HTML5 drag-and-drop; Alt+↑/↓ is the tested path |
| Sinking ticked items reorders what is stored (Task 12) | Med — a list looks shuffled on the phone | The stored order is the shown order by design; make it a per-note setting, off for notes that already exist |
| A per-note colour collides with the type colours (Task 13) | Low — a note that looks like a clip | Note colours come from their own token set, tested for contrast in both themes |

## Open questions

1. **Markdown on the phone, or HTML in the extension?** The plan assumes the
   phone learns markdown (Task 2). The cheaper alternative is to have the
   extension keep writing HTML, which would undo the last five commits. I
   recommend the phone: markdown is the smaller, more durable format, and the
   phone only needs the reading half.
2. **How far does the dialect go?** Images and tables are the next requests
   anyone makes. Both are out of scope here; tables in particular do not fit a
   780px popup.
3. **Should a note be openable in a full tab?** There is already a wide mode.
   A real tab would make long notes comfortable but adds a second surface to
   keep in step with this one.
4. **How much further down the Keep road?** Reminders, labels-as-colours,
   archive-as-distinct-from-trash and a card wall are all Keep ideas this plan
   leaves out. Phase 5 takes the four that fit a list-and-detail popup; say if
   any of the others is the one you actually wanted.
