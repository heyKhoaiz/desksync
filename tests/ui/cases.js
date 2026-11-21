// UI tests for the extension popup.
//
// These drive the real popup.js against the test doubles in fixtures.js. They
// exist because every bug found by hand in this UI — notes lost to the autosave
// debounce, a new note killed by the previous editor's close, a write thrown away
// because the database lacked a column — was a behaviour no unit test could see.
//
//   make test-ui          (headless)
//   tests/ui/runner.html  (in a browser, to watch it happen)

(async () => {
  const report = document.getElementById('report');
  let pass = 0, fail = 0;
  const lines = [];

  const group = (name) => lines.push(`<span class="grp">${name}</span>`);
  const ok = (name, cond, detail) => {
    if (cond) { pass++; lines.push(`<span class="ok">  ok  </span>${name}`); }
    else {
      fail++;
      // On the same line: the runner script keeps one line per result.
      const d = detail === undefined ? '' : ` — got: ${JSON.stringify(detail)}`.replace(/</g, '&lt;');
      lines.push(`<span class="no">  FAIL</span> ${name}${d}`);
    }
  };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), got);

  // ---------- helpers ----------
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const SAVE_DEBOUNCE = 700;                       // must outlast queueSave in popup.js
  const settled = () => wait(SAVE_DEBOUNCE + 250);

  const $$ = (s) => [...document.querySelectorAll(s)];
  const q = () => document.getElementById('q');
  const type = (v) => { q().value = v; q().dispatchEvent(new Event('input', { bubbles: true })); };
  const press = (key, opts = {}) =>
    q().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  const rowTitles = () => $$('#list .row:not(.act) .t').map((e) => e.textContent);
  // Titles under one section heading of the list (Today, Earlier…).
  const sectionTitles = (name) => {
    const out = []; let inside = false;
    for (const li of $$('#list > li')) {
      if (li.classList.contains('g-head')) { inside = li.textContent === name; continue; }
      if (inside && li.matches('.row:not(.act)')) out.push(li.querySelector('.t')?.textContent);
    }
    return out;
  };
  const actTitles = () => $$('#list .row.act .t').map((e) => e.textContent);
  const head = () => document.querySelector('.listhead')?.textContent ?? '';
  const chip = (t) => $$('[data-tag]').find((b) => b.dataset.tag === t);
  const rowFor = (text) => $$('#list .row').find((r) => r.textContent.includes(text));
  const act = (text) => $$('#list .row.act').find((r) => r.textContent.includes(text));
  const note = (title) => window.__DATA.notes.find((n) => n.title === title);

  // Starts every group from the same data, signed in, vault locked, Everything.
  // boot() fires its loads without awaiting them, so wait for the rows to arrive
  // rather than guessing at a delay: that was making the filter counts flaky.
  async function reset() {
    window.resetFixtures();
    state.vaultKey = null;
    state.editing = null;
    state.draft = null;
    state.filter = 'all';
    setScreen(null);
    type('');
    await boot();
    for (let i = 0; i < 100; i++) {
      const loaded = state.notes.length === window.__DATA.notes.length &&
                     state.later.length === window.__DATA.read_later.length &&
                     state.clips.length === window.__DATA.clips.length;
      if (loaded) break;
      await wait(20);
    }
    await wait(20);
  }

  const unlockVault = async () => {
    if (state.vaultState === 'open') return;
    if (!document.querySelector('.gate input')) act('Unlock the vault')?.click();
    await wait(30);
    const pw = document.querySelector('.gate input');
    pw.value = TEST_MASTER_PASSWORD;
    document.querySelector('.gate .primary').click();
    await wait(120);
  };

  // Selecting a note is all it takes now: the pane renders it ready to type in.
  const openNoteEditor = async (title) => {
    rowFor(title).click();
    await wait(140);
    document.getElementById('ed-area')?.focus();
    await wait(20);
  };

  // The editor is a plain <textarea>, so "typing" means setting its value and
  // letting the input handler read it back.
  const editorType = (text) => {
    const a = document.getElementById('ed-area');
    a.value = text;
    a.dispatchEvent(new Event('input', { bubbles: true }));
    return a;
  };
  const editorText = () => document.getElementById('ed-area').value;
  // "Take a note…" with nothing typed opens an empty note: the way to start one
  // now that there is no "New note" row.
  const startNote = () => {
    const c = document.getElementById('compose-in');
    c.value = '';
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };

  try {
    // ================= SEARCH =================
    group('search');
    await reset();

    type('sup');
    ok('searches all four types at once',
      new Set($$('.g-head').map((e) => e.textContent)).size >= 3, $$('.g-head').map((e) => e.textContent));
    ok('a title prefix outranks a body match',
      (rowTitles()[0] || '').toLowerCase().startsWith('sup'), rowTitles()[0]);
    ok('the matched run is highlighted', !!document.querySelector('.row mark'));
    ok('the header counts matches', /match/.test(head()), head());

    type('zzzznothing');
    ok('empty state quotes the query',
      /zzzznothing/.test(document.querySelector('.empty')?.textContent || ''),
      document.querySelector('.empty')?.textContent);

    type('');
    ok('clearing restores the full list', rowTitles().length > 5, rowTitles().length);

    // ================= TYPE FILTERS =================
    group('type filters');
    document.querySelector('.rail [data-f=clip]').click();
    await wait(40);
    ok('the rail filters to one type', /Clipboard/.test(head()), head());
    ok('only that type is listed',
      $$('#list .row:not(.act)').length === window.__DATA.clips.length,
      { rows: $$('#list .row:not(.act)').length, clips: window.__DATA.clips.length });

    press('1', { ctrlKey: true });
    ok('Ctrl+1 returns to Everything', /Everything/.test(head()), head());
    press('3', { ctrlKey: true });
    ok('Ctrl+3 selects Read later', /Read later/.test(head()), head());
    document.querySelector('.rail [data-f=all]').click();

    // ================= TAGS =================
    group('tags');
    chip('supabase').click();
    eq('a chip writes its #token into the search field', q().value, '#supabase');
    ok('the chip filters the list', rowTitles().length === 3, rowTitles());

    chip('reading').click();
    ok('two tags narrow rather than widen', rowTitles().length === 1, rowTitles());
    ok('the header names both tags', /#supabase/.test(head()) && /#reading/.test(head()), head());

    chip('supabase').click();
    chip('reading').click();
    eq('clicking a chip again removes its token', q().value, '');

    // Figma is a vault item and the vault is locked here, so use a listed one.
    type('#chrome man');
    ok('a tag and text combine',
      rowTitles().length === 1 && /Manifest/.test(rowTitles()[0] || ''), rowTitles());

    type('#nope');
    ok('an unknown tag says which tag was empty',
      /#nope/.test(document.querySelector('.empty')?.textContent || ''),
      document.querySelector('.empty')?.textContent);
    type('');

    ok('a chip that would empty the list is disabled',
      $$('[data-tag]').every((b) => !b.disabled || +b.querySelector('.n').textContent === 0));

    ok('the sign-in buttons do not answer to a list-row selector',
      $$('.row').length === $$('#list .row').length,
      { all: $$('.row').length, inList: $$('#list .row').length });

    // ================= TAG EDITING =================
    group('tagging items');
    rowFor('Rosewood').click();
    await wait(20);
    document.querySelector('.d-tags .add').click();
    let input = document.querySelector('.d-tags input');
    input.value = 'Personal Stuff';
    // as typing does, so the picker re-reads what is in the field
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(120);
    ok('a tag is lower-cased and hyphenated on the way in',
      window.__DATA.clips.find((c) => c.id === 'c3').tags.includes('personal-stuff'),
      window.__DATA.clips.find((c) => c.id === 'c3').tags);

    document.querySelector('.d-tags .x').click();
    await wait(80);
    ok('removing a chip writes the shorter list back',
      !window.__DATA.clips.find((c) => c.id === 'c3').tags.includes('home'),
      window.__DATA.clips.find((c) => c.id === 'c3').tags);

    await unlockVault();
    rowFor('Example').click();
    await wait(20);
    document.querySelector('.d-tags .add').click();
    input = document.querySelector('.d-tags input');
    input.value = 'secret-label';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(160);
    const vaultRow = window.__DATA.vault_items.find((v) => v.id === 'v3');
    ok('a vault tag goes inside the encrypted payload',
      vaultRow._plain.tags.includes('secret-label'), vaultRow._plain.tags);
    ok('a vault tag never lands in a plaintext column',
      !('tags' in vaultRow) && !String(vaultRow.ciphertext).includes('secret-label'),
      Object.keys(vaultRow));

    // ================= TAG MANAGEMENT =================
    group('tag management');
    await reset();
    await unlockVault();
    setScreen('settings');
    await wait(30);

    const before = {
      notes: window.__DATA.notes.filter((n) => n.tags?.includes('work')).length,
      clips: window.__DATA.clips.filter((c) => c.tags?.includes('work')).length,
      vault: window.__DATA.vault_items.filter((v) => v._plain.tags?.includes('work')).length
    };
    ok('#work spans more than one table', before.notes && before.clips && before.vault, before);

    const tagRow = $$('.tg-row').find((r) => r.querySelector('.name')?.textContent === 'work');
    tagRow.querySelector('.name').click();
    const rename = document.querySelector('.rn');
    rename.value = 'Job';
    rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(250);
    ok('renaming rewrites the tag in every table',
      window.__DATA.notes.filter((n) => n.tags?.includes('job')).length === before.notes &&
      window.__DATA.clips.filter((c) => c.tags?.includes('job')).length === before.clips &&
      window.__DATA.vault_items.filter((v) => v._plain.tags?.includes('job')).length === before.vault,
      { notes: window.__DATA.notes.filter((n) => n.tags?.includes('job')).length });
    ok('the old name is gone everywhere',
      ![...window.__DATA.notes, ...window.__DATA.clips].some((x) => x.tags?.includes('work')) &&
      !window.__DATA.vault_items.some((v) => v._plain.tags?.includes('work')));

    const readingCount = window.__DATA.read_later.length;
    const delRow = $$('.tg-row').find((r) => r.querySelector('.name')?.textContent === 'reading');
    delRow.querySelector('[aria-label^="Delete tag"]').click();
    await wait(250);
    ok('deleting a tag removes only the label, never the item',
      window.__DATA.read_later.length === readingCount &&
      !window.__DATA.read_later.some((r) => r.tags?.includes('reading')),
      window.__DATA.read_later.map((r) => r.tags));

    const colourRow = $$('.tg-row').find((r) => r.querySelector('.name')?.textContent === 'home');
    colourRow.querySelector('[data-col="#3d7bfa"]') ||
      colourRow.querySelectorAll('.sws')[1].click();
    await wait(60);
    ok('a tag colour is stored', !!state.tagColors.home, state.tagColors);
    setScreen(null);

    // ================= NOTES: RENDERING =================
    group('notes — reading');
    await reset();
    // A note opens straight into the editing surface; there is no read view and
    // nothing is rendered: what was typed is what is shown.
    rowFor('Launch checklist').click();
    await wait(140);
    const shown = document.getElementById('ed-area').value;
    ok('the note is shown as the text it is', /ship it/.test(shown), shown);
    ok('the page holds the note line for line', $$('#ed-area > .ln').length === shown.split('\n').length,
      document.getElementById('ed-area').innerHTML);
    ok('a line break in the note is a line break on screen', /\n/.test(shown), JSON.stringify(shown));

    // Notes written by the editors that came before — HTML, then markdown — are
    // flattened to text the first time they are opened.
    rowFor('Old rich-text note').click();
    await wait(140);
    const legacy = document.getElementById('ed-area').value;
    ok('an old HTML note arrives as words, not tags', /old/.test(legacy) && !/</.test(legacy), legacy);
    ok('and its list keeps its dashes', /- first/.test(legacy), legacy);

    rowFor('Supabase RLS gotcha').click();
    await wait(140);
    const legacyMd = document.getElementById('ed-area').value;
    ok('an old markdown note loses its marks',
      /1\.2s to 30ms/.test(legacyMd) && !/\*\*|`/.test(legacyMd), legacyMd);
    ok('but keeps its words', /auth\.uid\(\)/.test(legacyMd), legacyMd);

    // ================= NOTES: EDITOR =================
    group('notes — editor');
    await openNoteEditor('Old rich-text note');
    ok('selecting a note is enough: there is no Edit step',
      !$$('.d-foot button, .ed-foot button').some((b) => /^Edit$/.test(b.textContent.trim())),
      $$('.ed-foot button').map((b) => b.textContent.trim()));
    ok('and no Done button to dismiss it with',
      !$$('.ed-foot button').some((b) => /^Done$/.test(b.textContent.trim())),
      $$('.ed-foot button').map((b) => b.textContent.trim()));
    ok('the note is editable the moment it is shown',
      document.getElementById('ed-area')?.isContentEditable === true);
    ok('there is no formatting toolbar', !document.querySelector('[data-tool]'));
    ok('and no Preview button to press', !document.querySelector('#detail [data-mode]'));
    ok('and no undo or redo buttons of ours — the textarea has its own',
      !document.getElementById('ed-undo') && !document.getElementById('ed-redo'));

    // Whatever is typed is stored exactly, marks and all.
    editorType('**not bold** # not a heading\n- [ ] not a checkbox');
    await settled();
    eq('markdown typed into a note stays as the characters it is',
      note('Old rich-text note').body, '**not bold** # not a heading\n- [ ] not a checkbox');
    eq('and the note is stored as plain text', note('Old rich-text note').format, 'plain');
    ok('nothing typed in the note became a real element',
      !document.querySelector('#ed-area img, #ed-area script, #ed-area a, #ed-area h1'));

    // Text that would be dangerous as HTML is text here too.
    editorType('<img src=x onerror=alert(1)>');
    await settled();
    eq('a tag typed into a note is stored as text',
      note('Old rich-text note').body, '<img src=x onerror=alert(1)>');
    ok('and nothing of it reaches the DOM', !document.querySelector('#ed-area img, #detail img'));

    document.getElementById('home').click();
    await wait(120);

    // ================= TAG PICKER =================
    // The suggestions used to be a native <datalist>, drawn by the browser in
    // its own colours with no way to say which name would be created.
    group('tag picker');
    await reset();
    rowFor('Launch checklist').click();
    await wait(40);

    document.querySelector('.d-tags .add').click();
    await wait(30);
    ok('it is drawn by the popup, not the browser', !!document.querySelector('.tag-pop'));
    ok('and the input no longer defers to a datalist',
      !document.querySelector('.d-tags input[list]') && !document.querySelector('datalist'));

    let picker = document.querySelector('.d-tags input');
    ok('it suggests tags already in use', $$('.tag-pop [data-tag-option]').length > 0,
      $$('.tag-pop [data-tag-option]').map((b) => b.dataset.tagOption));
    ok('and leaves out the ones this item already has',
      !$$('.tag-pop [data-tag-option]').some((b) => b.dataset.tagOption === 'launch'),
      $$('.tag-pop [data-tag-option]').map((b) => b.dataset.tagOption));

    picker.value = 'sup';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(20);
    ok('typing narrows the list',
      $$('.tag-pop [data-tag-option]').every((b) => b.dataset.tagOption.includes('sup')),
      $$('.tag-pop [data-tag-option]').map((b) => b.dataset.tagOption));

    picker.value = 'brandnew';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(20);
    ok('a name that does not exist is offered as new',
      !!document.querySelector('.tag-pop .new'), document.querySelector('.tag-pop')?.textContent);

    picker.value = 'supabase';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(20);
    ok('an existing name is not offered as new as well',
      !document.querySelector('.tag-pop .new'), document.querySelector('.tag-pop')?.textContent);

    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(40);
    ok('Enter shows the tag on the note at once',
      $$('.d-tags .t').some((t) => /supabase/.test(t.textContent)), $$('.d-tags .t').map((t) => t.textContent));
    await settled();
    ok('and saves it with the note',
      window.__DATA.notes.find((n) => n.id === 'n1').tags.includes('supabase'),
      window.__DATA.notes.find((n) => n.id === 'n1').tags);
    ok('and the list closes', !document.querySelector('.tag-pop'));

    // The bug that lost tags: the next autosave wrote the editor's old list back.
    editorType(editorText() + ' more');
    await settled();
    ok('typing in the note afterwards keeps the new tag',
      window.__DATA.notes.find((n) => n.id === 'n1').tags.includes('supabase'),
      window.__DATA.notes.find((n) => n.id === 'n1').tags);
    $$('.d-tags .t').find((t) => /supabase/.test(t.textContent)).querySelector('.x').click();
    await wait(40);
    ok('× takes it off the screen at once', !$$('.d-tags .t').some((t) => /supabase/.test(t.textContent)));
    editorType(editorText() + '!');
    await settled();
    ok('and it stays off after the next save',
      !window.__DATA.notes.find((n) => n.id === 'n1').tags.includes('supabase'),
      window.__DATA.notes.find((n) => n.id === 'n1').tags);

    document.querySelector('.d-tags .add').click();
    await wait(30);
    picker = document.querySelector('.d-tags input');
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(80);
    ok('Escape closes it without adding anything', !document.querySelector('.tag-pop'));

    // A brand-new note tagged before its first word: it must stay the note on
    // screen, and the words typed next must go into it.
    await reset();
    const notesBeforeNew = window.__DATA.notes.length;
    startNote();
    await wait(200);
    document.querySelector('.d-tags .add').click();
    await wait(30);
    picker = document.querySelector('.d-tags input');
    picker.value = 'idea';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settled();
    ok('tagging a new note keeps it on screen', !!state.editing && !state.editing.id && state.editing.isNew,
      state.editing && { id: state.editing.id, title: state.editing.title });
    ok('with its tag shown', $$('.d-tags .t').some((t) => /idea/.test(t.textContent)));
    eq('and writes nothing until there is a word', window.__DATA.notes.length, notesBeforeNew);
    editorType('Paint the fence');
    await settled();
    const fence = window.__DATA.notes.filter((n) => /Paint the fence/.test(n.body));
    ok('the words go into that note, saved once with its tag',
      fence.length === 1 && fence[0].tags.includes('idea'), fence.map((n) => n.tags));
    ok('and no other note took them', !window.__DATA.notes.some((n) => n.id === 'n1' && /Paint/.test(n.body)));
    document.getElementById('home').click();
    await wait(200);

    // ================= COPY AND CLEAR IN THE LIST HEADER =================
    group('copy and clear');
    await reset();
    {
      let copied = null;
      const realWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (t) => { copied = t; };
      ok('no Copy or Clear with nothing narrowed', !document.getElementById('copy-list') && !document.getElementById('clear-filter'));
      document.querySelector('.rail [data-f=note]').click();
      await wait(60);
      const copyBtn = document.getElementById('copy-list');
      ok('narrowed, Copy is there and says what it does', /Copy/.test(copyBtn?.textContent || ''), copyBtn?.textContent);
      copyBtn.click();
      await wait(40);
      ok('it copies every note listed', ['Launch checklist', 'Supabase RLS gotcha', 'Old rich-text note', 'Grocery']
        .every((t) => (copied || '').includes('- ' + t)), copied);
      ok('tasks as boxes, not [x]', /☑ Privacy policy/.test(copied) && /☐ Justify/.test(copied) && !/\[x\]|\[ \]/.test(copied), copied);
      ok('and bold without its **', /1\.2s to 30ms/.test(copied) && !/\*\*/.test(copied), copied);
      ok('it says how many it copied', /Copied 4 items/.test(document.getElementById('toast').textContent),
        document.getElementById('toast').textContent);

      type('zzzznothing');
      await wait(40);
      ok('with nothing listed there is no Copy', !document.getElementById('copy-list'));
      navigator.clipboard.writeText = realWrite;

      // Clear: every kind of narrowing at once, then one click.
      type('launch #chrome');
      await wait(40);
      document.getElementById('clear-filter').click();
      await wait(80);
      eq('Clear empties the search, tags included', q().value, '');
      eq('and goes back to Everything', state.filter, 'all');
      ok('the header says so', /Everything/.test(head()), head());
      ok('no tag chip is left on', !$$('#tagbar [aria-pressed="true"]').length);
      ok('every row is back', rowTitles().length === state.items.length, [rowTitles().length, state.items.length]);
      eq('the cursor is in the search field', document.activeElement.id, 'q');
      ok('and the two buttons are gone again', !document.getElementById('clear-filter') && !document.getElementById('copy-list'));

      // Clear with a note open leaves it saved.
      await openNoteEditor('Grocery');
      document.querySelector('.rail [data-f=note]').click();
      await wait(200);
      await openNoteEditor('Grocery');
      editorType('oat milk\nhoney');
      document.getElementById('clear-filter').click();
      await settled();
      eq('Clear while a note is open saves it first', note('Grocery').body, 'oat milk\nhoney');
    }

    // Every item's bottom bar fits beside the list, labels on one line.
    await reset();
    for (const title of ['npx supabase', 'Migrate to Manifest V3', 'sk-p', 'Rosewood']) {
      rowFor(title).click();
      await wait(140);
      const foot = document.querySelector('#detail .d-foot');
      const over = foot.scrollWidth > foot.clientWidth + 1;
      const tall = [...foot.querySelectorAll('button')].some((b) => b.getBoundingClientRect().height > 34);
      ok(`the bar under "${title}" fits, every button on one line`, !over && !tall,
        { scroll: foot.scrollWidth, client: foot.clientWidth, labels: [...foot.querySelectorAll('button')].map((b) => b.textContent) });
    }
    // A login too, with its longest label ("Fill on this page"): the screenshot
    // for the store showed Edit, Lock and Delete cut off.
    await unlockVault();
    document.querySelector('.rail [data-f=vault]').click();
    await wait(120);
    for (const [title, kind] of [['GitHub', 'Fill'], ['Supabase', 'Password']]) {
      rowFor(title).click();
      await wait(140);
      const foot = document.querySelector('#detail .d-foot');
      const pane = document.getElementById('detail').getBoundingClientRect();
      const cut = [...foot.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().right > pane.right - 2).map((b) => b.textContent || b.title);
      ok(`the bar under a login fits (with ${kind}): Username, Edit, Lock and Delete all on screen`,
        foot.scrollWidth <= foot.clientWidth + 1 && !cut.length && foot.textContent.includes(kind),
        { scroll: foot.scrollWidth, client: foot.clientWidth, cut, text: foot.textContent });
    }
    document.getElementById('home').click();
    await wait(80);

    // ================= COPY WITHOUT THE CLIPBOARD API =================
    // A page that is not secure has no navigator.clipboard. Copy used to throw
    // "Cannot read properties of undefined (reading 'writeText')" there.
    group('copy where the clipboard API is missing');
    await reset();
    {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const realExec = document.execCommand.bind(document);
      let got = null;
      document.execCommand = (cmd) => {
        if (cmd !== 'copy') return realExec(cmd);
        const dt = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
        got = { text: dt.getData('text/plain'), html: dt.getData('text/html') };
        return true;
      };
      document.querySelector('.rail [data-f=link]').click();
      await wait(80);
      document.getElementById('copy-list').click();
      await wait(80);
      ok('Copy still copies the list', /Migrate to Manifest V3\n  https:\/\/developer\.chrome\.com/.test(got?.text || ''), got);
      ok('and says so, with no error', /^Copied 3 items/.test(document.getElementById('toast').textContent),
        document.getElementById('toast').textContent);
      rowFor('Migrate to Manifest V3').click();
      await wait(140);
      $$('#detail .d-foot button').find((b) => /Copy/.test(b.textContent)).click();
      await wait(60);
      eq('a link’s own Copy works too', got?.text, 'https://developer.chrome.com/docs/extensions/mv3/intro/');

      // Rich text keeps its formatting through the fallback.
      document.getElementById('home').click();
      await wait(150);
      await openNoteEditor('Grocery');
      editorType('a **big** day');
      document.getElementById('ed-menu').click();
      $$('.ed-foot .menu button').find((b) => /^Copy text/.test(b.textContent)).click();
      await wait(60);
      ok('a note with bold copies as real bold', /<b>big<\/b>/.test(got?.html || '') && /a big day$/.test(got?.text || ''), got);

      // And when even that fails, a sentence, not a TypeError.
      document.execCommand = (cmd) => (cmd === 'copy' ? false : realExec(cmd));
      document.getElementById('home').click();
      await wait(200);
      document.querySelector('.rail [data-f=link]').click();
      await wait(80);
      document.getElementById('copy-list').click();
      await wait(80);
      ok('if nothing can copy, it says what to do instead', /Ctrl\+C/.test(document.getElementById('toast').textContent) &&
        !/undefined/.test(document.getElementById('toast').textContent), document.getElementById('toast').textContent);

      document.execCommand = realExec;
      delete navigator.clipboard;
      document.querySelector('.rail [data-f=all]').click();
      await wait(80);
    }

    // ================= FROM THE FULL REVIEW =================
    group('review fixes');
    await reset();
    {
      // The selection follows the item, not its place in the list.
      rowFor('An Interactive Guide to CSS Grid').click();
      await wait(150);
      await db.insert('clips', { content: 'arrived in the background', source_url: 'x.com' });
      await loadClips();
      await wait(150);
      ok('a row added above the selection does not move it',
        /An Interactive Guide to CSS Grid/.test(document.getElementById('detail').textContent),
        document.getElementById('detail').textContent.slice(0, 60));

      // An open note that stops matching the search stays open.
      type('tahini');
      await wait(60);
      await openNoteEditor('Grocery');
      editorType('oat milk\ncoffee beans');
      await settled();
      ok('a note that no longer matches the search stays open', state.editing?.title === 'Grocery' && !!document.getElementById('ed-area'),
        state.editing && state.editing.title);
      editorType('oat milk\ncoffee beans\nbread');
      await settled();
      eq('and keeps taking what is typed', note('Grocery').body, 'oat milk\ncoffee beans\nbread');
      document.getElementById('home').click();
      await wait(200);

      // A clip is inserted exactly as it is.
      await reset();
      let args = null;
      const realExec = chrome.scripting.executeScript;
      chrome.scripting.executeScript = async (o) => { args = o.args; return [{ result: { ok: true } }]; };
      window.__DATA.clips.find((c) => c.id === 'c3').content = 'f(**a, **b) and _tmp_ file';
      await loadClips();
      rowFor('f(').click();
      await wait(140);
      document.getElementById('clip-insert').click();
      await wait(40);
      eq('Insert puts a clip in exactly as it is', args?.[0], 'f(**a, **b) and _tmp_ file');
      eq('with no formatting added', args?.[1], null);
      chrome.scripting.executeScript = realExec;

      // Trash shows what was just deleted.
      document.getElementById('home').click();
      await wait(100);
      rowFor('Grocery').querySelector('[data-row-act=delete]').click();
      await wait(200);
      setScreen('trash');
      await wait(150);
      ok('a note deleted now is in Trash', /Grocery/.test(document.getElementById('screen').textContent));
      setScreen(null);
      await wait(60);

      // Fill checks the page at the moment of filling.
      await unlockVault();
      document.querySelector('.rail [data-f=vault]').click();
      await wait(100);
      rowFor('GitHub').click();
      await wait(140);
      const realExec2 = chrome.scripting.executeScript;
      let filled = false;
      chrome.scripting.executeScript = async () => { filled = true; return [{ result: { filled: 2, foundPassword: true } }]; };
      state.tabHost = 'evil.example';
      state.tabOrigin = '*://*.evil.example/*';
      $$('#detail .d-foot button').find((b) => /Fill/.test(b.textContent))?.click();
      await wait(80);
      ok('a login is never filled into a different site, even with an old Fill button on screen', !filled);
      ok('and it says why', /This login is for github\.com/.test(document.getElementById('toast').textContent),
        document.getElementById('toast').textContent);
      chrome.scripting.executeScript = realExec2;
      ok('a login for a subdomain is not offered on the main site', !hostMatches('https://gist.github.com', 'github.com'));
      ok('a login for the main site is offered on a subdomain', hostMatches('https://github.com', 'gist.github.com'));
      document.getElementById('home').click();
      await wait(100);
    }

    group('review fixes: the editor');
    await reset();
    await openNoteEditor('Grocery');
    {
      const area = document.getElementById('ed-area');
      const input = (inputType, data = null) => area.dispatchEvent(
        new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));

      editorType('**_x_**');
      area.setSelectionRange(3, 4);
      input('deleteContentBackward');
      await wait(10);
      eq('deleting bold-italic text leaves no stray ****', editorText(), '');

      editorType('a **bold** c');
      area.setSelectionRange(4, 8);
      input('insertText', ' ');
      await wait(10);
      eq('a space typed over a bold word is plain', editorText(), 'a   c');

      editorType('**bold**');
      area.setSelectionRange(4);
      const dt = new DataTransfer();
      dt.setData('text/plain', 'x\ny');
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await wait(10);
      eq('two lines pasted into bold keep both lines bold', editorText(), '**box**\n**yld**');
      ok('with no ** on screen', !/\*/.test(area.innerText), area.innerText);

      editorType('\nabc');
      area.setSelectionRange(0);
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(10);
      eq('Ctrl+Enter on an empty first line makes that line the task', editorText(), '[ ] \nabc');

      // A save still running when more is typed: the newer words are saved too.
      editorType('one');
      const realUpdate = db.update.bind(db), realUpsert = db.upsert.bind(db);
      let release;
      const gate = new Promise((r) => { release = r; });
      db.upsert = async (...a) => { await gate; return realUpsert(...a); };
      await wait(SAVE_DEBOUNCE + 50);           // the save of "one" is now waiting
      editorType('one two');
      release();
      db.upsert = realUpsert;
      db.update = realUpdate;
      await wait(SAVE_DEBOUNCE * 2 + 300);
      eq('words typed during a save are saved after it', note('Grocery').body, 'one two');
      ok('and the note says Saved only once they are', document.getElementById('ed-saved').textContent === 'Saved',
        document.getElementById('ed-saved').textContent);
    }
    document.getElementById('home').click();
    await wait(200);

    // ================= BACKUP CODES =================
    group('backup codes');
    await reset();
    await unlockVault();
    {
      const gh = () => window.__DATA.vault_items.find((v) => v.id === 'v1')._plain;
      const openGitHub = async () => {
        document.querySelector('.rail [data-f=vault]').click();
        await wait(100);
        rowFor('GitHub').click();
        await wait(150);
      };
      const edit = async () => { $$('#detail .d-foot button').find((b) => /Edit/.test(b.textContent)).click(); await wait(80); };
      const saveForm = async () => { $$('#detail .d-foot button').find((b) => /Save/.test(b.textContent)).click(); await wait(250); };
      const paste = (text) => {
        const box = document.getElementById('v-codes');
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      };

      await openGitHub();
      ok('a login with no codes shows no codes section', !document.querySelector('#detail .codes'));
      await edit();
      paste('Your GitHub recovery codes\n\na1b2c-3d4e5\nf6a7b-8c9d0\n11111-22222\n');
      eq('pasting counts the codes it read', document.getElementById('v-codes-found').textContent, '3 codes found');
      await saveForm();
      eq('Save keeps them with the login, encrypted', gh().codes?.map((x) => x.c), ['a1b2c-3d4e5', 'f6a7b-8c9d0', '11111-22222']);
      ok('the heading line is not a code', !gh().codes.some((x) => /GitHub/.test(x.c)));

      await openGitHub();
      eq('the login says how many are left', document.getElementById('codes-left')?.textContent, '3 of 3 codes left');
      ok('the codes are hidden until shown', !/a1b2c/.test(document.querySelector('#detail .codes').textContent));
      ok('the list says it too', /3 of 3 codes left/.test(rowFor('GitHub').textContent), rowFor('GitHub').textContent);

      // Copy one: it is copied, marked used, and the clipboard is to be cleared.
      const sent = [];
      chrome.runtime = { sendMessage: async (m) => { sent.push(m); return { ok: true }; } };
      let copied = null;
      const realWrite = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (t) => { copied = t; };
      document.querySelector('#detail .code-copy').click();
      await wait(250);
      eq('Copy puts the code on the clipboard', copied, 'a1b2c-3d4e5');
      ok('and marks it used', !!gh().codes.find((x) => x.c === 'a1b2c-3d4e5').used);
      eq('the count goes down', document.getElementById('codes-left')?.textContent, '2 of 3 codes left');
      ok('two left is a warning', !!document.querySelector('#detail .codes-warn'));
      ok('the used one is folded away', /Used \(1\)/.test(document.querySelector('#detail .codes-used summary')?.textContent || ''));
      ok('the clipboard is to be cleared, by a hash, not the code itself',
        sent.some((m) => m.type === 'clear-clipboard-later' && /^[0-9a-f]{64}$/.test(m.hash) && !JSON.stringify(m).includes('a1b2c')), sent);
      const undo = document.querySelector('#toast .toast-act');
      ok('the message offers Undo', undo?.textContent === 'Undo');
      undo.click();
      await wait(250);
      ok('Undo puts the code back', !gh().codes.find((x) => x.c === 'a1b2c-3d4e5').used);
      eq('and the count with it', document.getElementById('codes-left')?.textContent, '3 of 3 codes left');

      // A password copy is cleared too; with the setting off, nothing is asked.
      sent.length = 0;
      rowFor('GitHub').querySelector('[data-row-act=copy]').click();
      await wait(80);
      ok('a copied password is cleared from the clipboard too', sent.some((m) => m.type === 'clear-clipboard-later'), sent);
      state.clearClipboard = false;
      sent.length = 0;
      rowFor('GitHub').querySelector('[data-row-act=copy]').click();
      await wait(80);
      eq('unless that is turned off in Settings', sent.length, 0);
      state.clearClipboard = true;
      navigator.clipboard.writeText = realWrite;
      delete chrome.runtime;

      // Editing the login for something else keeps the codes.
      await edit();
      document.getElementById('v-user').value = 'someone-else';
      document.getElementById('v-user').dispatchEvent(new Event('input', { bubbles: true }));
      await saveForm();
      ok('an edit that does not touch the codes keeps them', gh().codes?.length === 3 && gh().username === 'someone-else', gh());

      // A new set from the site replaces the old one.
      await openGitHub();
      await edit();
      ok('the editor says what is saved now', /3 of 3 codes left/.test(document.querySelector('.v-codes label').textContent));
      paste('9999 0000\n8888 1111');
      await saveForm();
      eq('a new set replaces the old codes', gh().codes.map((x) => x.c), ['9999 0000', '8888 1111']);
      document.getElementById('home').click();
      await wait(100);
    }

    // ================= MANY ACCOUNTS: SITE FIRST, IMPORT =================
    group('logins: this site first, import');
    await reset();
    await unlockVault();
    {
      document.querySelector('.rail [data-f=vault]').click();
      await wait(120);
      const heads = $$('#list .g-head').map((e) => e.textContent);
      eq('the vault starts with the logins for the page you are on', heads[0], 'On github.com');
      eq('GitHub is first', rowTitles()[0], 'GitHub');

      // Chrome's export, with one login already here and one empty row.
      await importPasswords('name,url,username,password,note\n' +
        'GitHub,https://github.com/,khoaiz,hunter2hunter2,\n' +
        'Instagram,https://www.instagram.com/,brand_a,pw-a,Client A\n' +
        'Instagram,https://www.instagram.com/,brand_b,pw-b,Client B\n' +
        'Empty,https://nothing.example/,,,\n');
      await wait(200);
      const titles = window.__DATA.vault_items.map((v) => v._plain?.username);
      ok('an import adds the new logins, encrypted', titles.includes('brand_a') && titles.includes('brand_b'), titles);
      eq('and skips one already here', titles.filter((t) => t === 'khoaiz').length, 1);
      ok('and says what it did', /2 logins imported · 1 already here · 1 empty skipped/.test(document.getElementById('toast').textContent),
        document.getElementById('toast').textContent);
      ok('two accounts on one site are two logins', rowTitles().filter((t) => t === 'Instagram').length === 2, rowTitles());
      await importPasswords('date,amount\n1,2');
      await wait(60);
      ok('a file that is not an export is refused, saying why', /does not look like a password export/.test(document.getElementById('toast').textContent));

      // Alt+Shift+L with the vault locked opens on the vault, ready to unlock.
      await lockVault();
      document.getElementById('home').click();
      await wait(100);
      chrome.storage.session = { async get() { return { pendingAction: 'vault' }; }, async remove() {} };
      await startAction();
      await wait(200);
      delete chrome.storage.session;
      ok('a locked vault opens ready to unlock', state.filter === 'vault' && document.activeElement === document.querySelector('.gate input'),
        [state.filter, document.activeElement?.tagName]);
      document.getElementById('home').click();
      await wait(100);
    }

    // ================= LAUNCH READINESS =================
    group('launch: left-over fixes, help, the review request');
    await reset();
    {
      // Enter over a selection is one step to undo.
      await openNoteEditor('Grocery');
      const area = document.getElementById('ed-area');
      editorType('hello world');
      area.setSelectionRange(5, 6);                       // the space
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(10);
      eq('Enter over a selection replaces it with a line break', editorText(), 'hello\nworld');
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(10);
      eq('and one Ctrl+Z brings the selection back', editorText(), 'hello world');
      document.getElementById('home').click();
      await wait(200);

      // A link's note is saved with every keystroke, not after a pause.
      rowFor('Migrate to Manifest V3').click();
      await wait(140);
      const ln = document.getElementById('link-note');
      ln.value = 'read before Friday';
      ln.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(30);
      eq('a link note is saved at once', window.__DATA.read_later.find((r) => r.id === 'l1').note, 'read before Friday');

      // A tag renamed while the vault is locked reaches its logins on unlock.
      document.getElementById('home').click();
      await wait(100);
      await renameTag('work', 'job');
      await unlockVault();
      await wait(200);
      ok('a tag renamed while the vault was locked is renamed on its logins once unlocked',
        window.__DATA.vault_items.find((v) => v.id === 'v1')._plain.tags.includes('job') &&
        !window.__DATA.vault_items.find((v) => v.id === 'v1')._plain.tags.includes('work'),
        window.__DATA.vault_items.find((v) => v.id === 'v1')._plain.tags);
      ok('and the pending change is used up', !window.__store.pendingTagOps);

      // Help in Settings: feedback only once an address is set.
      setScreen('settings');
      await wait(30);
      ok('no feedback link while no support address is set', !document.getElementById('send-feedback'));
      ok('Rate DeskSync is there', !!document.getElementById('rate-store'));
      DESKSYNC_CONFIG.SUPPORT_EMAIL = 'help@example.com';
      drawSettings();
      ok('with an address, Send feedback appears', !!document.getElementById('send-feedback'));
      ok('and writes to it, naming the version', /^mailto:help@example\.com\?subject=DeskSync/.test(feedbackUrl()), feedbackUrl());
      delete DESKSYNC_CONFIG.SUPPORT_EMAIL;
      setScreen(null);
      await wait(30);

      // The review request: after a week, once.
      const strip = () => document.getElementById('review-ask');
      window.__store.installedAt = Date.now() - 2 * 86400000;
      await maybeAskForReview();
      ok('not in the first week', strip().classList.contains('hidden'));
      window.__store.installedAt = Date.now() - 9 * 86400000;
      await maybeAskForReview();
      ok('after a week of use, it asks', !strip().classList.contains('hidden') && /review/.test(strip().textContent));
      strip().querySelector('.ra-no').click();
      await wait(30);
      ok('Not now puts it away', strip().classList.contains('hidden'));
      await maybeAskForReview();
      ok('and it never asks again', strip().classList.contains('hidden') && !!window.__store.reviewAsked);
      delete window.__store.installedAt;
      delete window.__store.reviewAsked;
    }

    // ================= HOVER HIGHLIGHTS, A CLICK CHOOSES =================
    group('hover and selection, in every section');
    await reset();
    await unlockVault();
    for (const f of ['all', 'note', 'link', 'clip', 'vault']) {
      document.querySelector(`.rail [data-f=${f}]`).click();
      await wait(200);
      const rows = $$('#list .row:not(.act)');
      if (rows.length < 2) { ok(`${f}: has rows to try`, false, rows.length); continue; }
      rows[0].click();
      await wait(200);
      const pane = document.getElementById('detail').textContent;
      const active = state.active;
      for (const ev of ['mouseover', 'mouseenter', 'mousemove']) rows[1].dispatchEvent(new MouseEvent(ev, { bubbles: true }));
      await wait(200);
      ok(`${f}: moving the mouse over another row leaves the pane as it was`,
        document.getElementById('detail').textContent === pane && state.active === active);
      const second = rows[1].querySelector('.t').textContent;
      rows[1].click();
      await wait(300);
      // The list may be redrawn by the click (leaving a note saves it), so the
      // row is found again by its title.
      const now = $$('#list .row[aria-selected="true"] .t')[0]?.textContent;
      ok(`${f}: clicking it shows it`, document.getElementById('detail').textContent !== pane && now === second,
        { selected: now, wanted: second });
      document.getElementById('home').click();
      await wait(150);
    }
    {
      const css = getComputedStyle(document.documentElement);
      ok('the selected row is a different colour from a hovered one',
        css.getPropertyValue('--sel').trim() !== css.getPropertyValue('--hover').trim());
      setActive(state.rows.findIndex((r) => r.kind === 'action'), false);
      await wait(100);
      const acts = $$('#list .row.act');
      const on = acts.find((a) => a.getAttribute('aria-selected') === 'true');
      const off = acts.find((a) => a.getAttribute('aria-selected') !== 'true');
      ok('a selected action row shows it is selected too',
        !!on && !!off && getComputedStyle(on).backgroundColor !== getComputedStyle(off).backgroundColor,
        on && off && [getComputedStyle(on).backgroundColor, getComputedStyle(off).backgroundColor]);
      document.getElementById('home').click();
      await wait(100);
    }

    // ================= PINNED =================
    group('pinned');
    await reset();
    {
      const heads = $$('#list .g-head').map((e) => e.textContent);
      ok('pinned things lead the Today section', heads[0] === 'Today' && sectionTitles('Today').slice(0, 2).includes('Launch checklist'), [heads, sectionTitles('Today')]);
      const mark = rowFor('Launch checklist').querySelector('.mark-i.pinned .i');
      ok('a pinned row shows a filled pin', !!mark && getComputedStyle(mark).fill !== 'none', mark && getComputedStyle(mark).fill);
      ok('an unpinned row shows none', !rowFor('Grocery').querySelector('.mark-i.pinned'));
      await openNoteEditor('Launch checklist');
      const pin = document.getElementById('ed-pin');
      eq('the editor says the note is pinned', pin.getAttribute('aria-pressed'), 'true');
      ok('with a filled pin', getComputedStyle(pin.querySelector('.i')).fill !== 'none');
      ok('and no grey box that looks like hover', ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(pin).backgroundColor),
        getComputedStyle(pin).backgroundColor);
      pin.click();
      await wait(150);
      eq('pressing it unpins', pin.getAttribute('aria-pressed'), 'false');
      eq('the pin is an outline again', getComputedStyle(pin.querySelector('.i')).fill, 'none');
      eq('and it is saved', note('Launch checklist').pinned, false);
      document.getElementById('home').click();
      await wait(200);
    }

    // ================= TAG RULES =================
    group('tag rules');
    await reset();
    rowFor('Migrate to Manifest V3').click();
    await wait(140);
    const typeTag = async (v) => {
      document.querySelector('.d-tags .add').click();
      await wait(20);
      const p = document.querySelector('.d-tags input');
      p.value = v;
      p.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(20);
      return p;
    };
    const enter = async (p) => { p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(80); };
    const l1Tags = () => window.__DATA.read_later.find((r) => r.id === 'l1').tags;

    let tp = await typeTag('Q&A! (Draft)');
    ok('a name is shown as it will be saved', !!document.querySelector('.tag-pop [data-tag-option="qa-draft"]'),
      $$('.tag-pop [data-tag-option]').map((b) => b.dataset.tagOption));
    await enter(tp);
    ok('and saved that way', l1Tags().includes('qa-draft'), l1Tags());

    tp = await typeTag('???');
    eq('a name with no letters says why', document.querySelector('.tag-pop .tag-hint')?.textContent, 'Use letters or numbers');
    ok('and is not offered as new', !document.querySelector('.tag-pop .new'));
    const tagCountBefore = l1Tags().length;
    await enter(tp);
    eq('Enter adds nothing', l1Tags().length, tagCountBefore);

    tp = await typeTag('a-very-long-tag-name-that-goes-on-and-on-and-on');
    ok('a long name says it will be shortened', /Shortened to 32/.test(document.querySelector('.tag-pop .tag-hint')?.textContent || ''));
    await enter(tp);
    ok('and is saved at 32 characters', l1Tags().some((t) => t.length <= 32 && t.startsWith('a-very-long')), l1Tags());

    tp = await typeTag('কাজ');
    await enter(tp);
    ok('a Bangla tag can be added', l1Tags().includes('কাজ'), l1Tags());
    document.getElementById('home').click();
    await wait(80);
    type('#কাজ');
    await wait(30);
    eq('and searched for', rowTitles(), ['Migrate to Manifest V3']);
    toggleTag('কাজ');
    await wait(30);
    eq('and its chip toggles it off again', q().value, '');

    // Ten is the most: + Tag says so instead of opening.
    window.__DATA.read_later.find((r) => r.id === 'l1').tags = Array.from({ length: 10 }, (_, i) => 't' + i);
    await loadLater();
    rowFor('Migrate to Manifest V3').click();
    await wait(140);
    const addBtn = document.querySelector('.d-tags .add');
    ok('an item with 10 tags cannot take another', addBtn.disabled && /10 tags/.test(addBtn.textContent), addBtn.textContent);

    // Settings: a rename that leaves nothing usable changes nothing.
    setScreen('settings');
    await wait(30);
    ok('the rules are written out in Settings', /up to 32 characters/i.test(document.querySelector('.sc-rules')?.textContent || ''));
    const nameEl = $$('.tg-row .name').find((e) => e.textContent === 'home');
    nameEl.click();
    const rn = document.querySelector('.tg-row input.rn');
    rn.value = '!!!';
    rn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(80);
    ok('renaming to punctuation keeps the old name', window.__DATA.notes.find((n) => n.id === 'n4').tags.includes('home'));
    setScreen(null);
    await wait(30);

    // ================= A WIDER EDITOR =================
    group('a wider editor');
    await reset();
    await openNoteEditor('Launch checklist');
    ok('the list is beside the note to begin with', !document.getElementById('app').classList.contains('wide'));

    document.getElementById('ed-wide').click();
    await wait(80);
    ok('the button gives the note the whole popup',
      document.getElementById('app').classList.contains('wide'));
    ok('the rail stays, so the types are still reachable',
      document.querySelector('.rail').getBoundingClientRect().width > 0);
    ok('the width belongs to this note, not to every note', !('editorWide' in window.__store));

    document.getElementById('ed-wide').click();
    await wait(80);
    ok('and it goes back', !document.getElementById('app').classList.contains('wide'));

    document.getElementById('ed-wide').click();
    await wait(80);
    document.getElementById('home').click();
    await wait(150);
    ok('leaving the editor brings the list back',
      !document.getElementById('app').classList.contains('wide'));

    // ================= NOTES: SAVING =================
    group('notes — saving');
    await reset();

    await openNoteEditor('Grocery');
    editorType('ESC-PATH');
    document.getElementById('detail').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settled();
    eq('Esc saves what was typed inside the debounce', note('Grocery').body, 'ESC-PATH');

    await openNoteEditor('Grocery');
    editorType('DONE-PATH');
    document.getElementById('detail').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settled();
    eq('leaving saves what was typed inside the debounce', note('Grocery').body, 'DONE-PATH');

    await openNoteEditor('Grocery');
    editorType('LOGO-PATH');
    document.getElementById('home').click();
    await settled();
    eq('the logo saves on its way out', note('Grocery').body, 'LOGO-PATH');

    const countBefore = window.__DATA.notes.length;
    startNote();
    await wait(60);
    document.getElementById('home').click();
    await settled();
    eq('a note opened and never typed into is discarded', window.__DATA.notes.length, countBefore);

    startNote();
    await wait(60);
    ok('clicking New note opens the editor directly', !!document.getElementById('ed-area'));
    const t = document.getElementById('ed-title');
    t.value = 'Typed once'; t.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('body');
    await settled();
    await settled();
    eq('typing repeatedly still creates exactly one note',
      window.__DATA.notes.filter((n) => n.title === 'Typed once').length, 1);
    eq('a new note is saved as plain text', note('Typed once').format, 'plain');
    document.getElementById('home').click();
    await wait(80);

    // The regression: the previous editor's close used to clear state.editing
    // after the next one had opened, so the second note was never written.
    await openNoteEditor('Grocery');
    editorType('still here');
    startNote();
    await wait(120);
    const t2 = document.getElementById('ed-title');
    t2.value = 'Second editor'; t2.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('second body');
    await settled();
    ok('opening a second editor keeps the first note', note('Grocery').body === 'still here', note('Grocery').body);
    ok('and saves the second one too', !!note('Second editor'), window.__DATA.notes.map((n) => n.title));
    document.getElementById('home').click();
    await wait(80);

    // ================= A COLOUR PER NOTE =================
    // `notes.color` has been in the schema since the first migration, with a
    // default of 'yellow', and nothing read it until now.
    group('note colour');
    await reset();
    await openNoteEditor('Grocery');

    const colourBtn = () => document.getElementById('ed-colour');
    const palette = () => document.querySelector('.swatches');
    const swatch = (k) => document.querySelector(`.swatches [data-colour="${k}"]`);
    const bandStyle = () => document.getElementById('ed-band').getAttribute('style') || '';

    ok('the editor offers the note a colour', !!colourBtn());
    eq('the palette is closed until asked for', palette().classList.contains('open'), false);
    colourBtn().click();
    eq('clicking opens it', palette().classList.contains('open'), true);
    eq('and says so', colourBtn().getAttribute('aria-expanded'), 'true');
    eq('all seven colours are there', document.querySelectorAll('.swatches .swatch').length, 7);
    {
      // Counting them is not enough: four were once cut off past the pane's edge.
      const pane = document.getElementById('detail').getBoundingClientRect();
      const out = $$('.swatches .swatch').filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < pane.left || r.right > pane.right || r.top < pane.top || r.bottom > pane.bottom;
      }).map((b) => b.dataset.colour);
      eq('and every one is inside the pane, where it can be clicked', out, []);
    }
    ok('each one is named, not just coloured',
      [...document.querySelectorAll('.swatches .swatch')].every((b) => !!b.getAttribute('aria-label')));
    ok('the current colour is the ticked choice',
      document.querySelector('.swatches [aria-checked="true"]')?.dataset.colour === 'yellow');
    document.getElementById('ed-area').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    eq('a click outside closes it', palette().classList.contains('open'), false);
    eq('and says so', colourBtn().getAttribute('aria-expanded'), 'false');
    document.getElementById('ed-menu').click();
    document.getElementById('ed-area').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    eq('the ⋮ menu closes the same way', document.querySelector('.ed-foot .menu').classList.contains('open'), false);
    colourBtn().click();

    swatch('mint').click();
    await settled();
    eq('choosing a colour saves it on the note', note('Grocery').color, 'mint');
    ok('the header takes it at once', /--n-mint/.test(bandStyle()), bandStyle());
    eq('and the palette closes', palette().classList.contains('open'), false);
    eq('the chosen one is marked', swatch('mint').getAttribute('aria-checked'), 'true');
    eq('and the others are not', swatch('yellow').getAttribute('aria-checked'), 'false');

    document.getElementById('home').click();
    await wait(140);
    const dot = rowFor('Grocery').querySelector('.bul');
    ok('the list row shows it too', /--n-mint/.test(dot.getAttribute('style') || ''),
      dot.getAttribute('style'));
    ok('a note with no colour of its own is still yellow',
      /--n-yellow/.test(rowFor('Launch checklist').querySelector('.bul').getAttribute('style') || ''),
      rowFor('Launch checklist').querySelector('.bul').getAttribute('style'));

    // A value nothing knows about must not leave a note unreadable.
    // state.notes holds the rows themselves, as db.list returned them.
    state.notes.find((n) => n.title === 'Grocery').color = 'ultraviolet';
    draw();
    ok('an unknown colour falls back to yellow',
      /--n-yellow/.test(rowFor('Grocery').querySelector('.bul').getAttribute('style') || ''),
      rowFor('Grocery').querySelector('.bul').getAttribute('style'));

    // A colour chosen before the first save has to reach that save.
    startNote();
    await wait(60);
    colourBtn().click();
    swatch('sky').click();
    const nt2 = document.getElementById('ed-title');
    nt2.value = 'A blue one'; nt2.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('words');
    await settled();
    eq('a colour set before the note exists is saved with it', note('A blue one').color, 'sky');

    document.getElementById('home').click();
    await wait(140);

    // ================= THE ⋮ MENU =================
    // Keep's bar is short because everything rare lives behind one menu.
    group('the ⋮ menu');
    await reset();
    await openNoteEditor('Grocery');

    const menuBtn = () => document.getElementById('ed-menu');
    const sheet = () => document.querySelector('.ed-foot .menu');
    const entry = (label) => [...document.querySelectorAll('.menu [role=menuitem]')]
      .find((b) => b.textContent.startsWith(label));

    ok('the editor has a menu', !!menuBtn());
    eq('closed to begin with', sheet().classList.contains('open'), false);
    menuBtn().click();
    eq('and open when asked', sheet().classList.contains('open'), true);
    ok('it says what it is to a screen reader',
      menuBtn().getAttribute('aria-haspopup') === 'menu' &&
      menuBtn().getAttribute('aria-expanded') === 'true');

    ok('the bin is no longer loose in the footer',
      !document.querySelector('.ed-foot > button[title=Delete]'),
      [...document.querySelectorAll('.ed-foot button')].map((b) => b.title));
    ok('delete is in the menu instead', !!entry('Delete note'));
    ok('nothing about formatting is left in it',
      !entry('Copy as markdown') && !entry('Hide tick boxes') && !entry('Ticked items'),
      [...document.querySelectorAll('.menu [role=menuitem]')].map((b) => b.textContent));

    sheet().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    eq('escape closes it', sheet().classList.contains('open'), false);

    // Duplicate.
    await reset();
    await openNoteEditor('Grocery');
    editorType('the original');
    await settled();
    menuBtn().click();
    entry('Duplicate').click();
    await settled();
    ok('duplicating makes a second note', !!note('Grocery (copy)'), window.__DATA.notes.map((n) => n.title));
    eq('with the same words', note('Grocery (copy)').body, 'the original');
    eq('and the original is left alone', note('Grocery').body, 'the original');
    eq('the copy is what you are now editing',
      document.getElementById('ed-title').value, 'Grocery (copy)');
    eq('and the copy is plain text too', note('Grocery (copy)').format, 'plain');

    document.getElementById('home').click();
    await wait(150);

    // ================= THE POPUP CLOSING =================
    // A browser action popup is destroyed the moment you click anywhere else in
    // the browser, which is the ordinary way to leave one. Whatever was inside
    // the save debounce used to go with it.
    group('closing the popup');
    await reset();

    const stash = () => store.pendingDraft || null;

    await openNoteEditor('Grocery');
    editorType('typed but not yet saved');
    await wait(220);                                   // past the stash, inside the save
    ok('what you type is kept somewhere that outlives the popup',
      /typed but not yet saved/.test(stash()?.row?.body || ''), stash());
    eq('and it names the note it belongs to', stash().row.id, note('Grocery').id);

    await settled();
    eq('once the note is really saved the copy is dropped', stash(), null);
    ok('and the note holds what was typed',
      /typed but not yet saved/.test(note('Grocery').body), note('Grocery').body);

    // The case the debounce used to lose: closed before either timer fired.
    await openNoteEditor('Grocery');
    editorType('the very last words');
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    ok('closing the popup writes the draft out at once, without waiting',
      /the very last words/.test(stash()?.row?.body || ''), stash());

    // And the service worker, or the next popup, finishes the job.
    await drafts.flush();
    ok('the draft left behind is written to the note',
      /the very last words/.test(note('Grocery').body), note('Grocery').body);
    eq('and is not left to be written twice', stash(), null);

    // A new note is the dangerous one: two writers, no id yet.
    document.getElementById('home').click();
    await wait(80);
    const rowsBefore = window.__DATA.notes.length;
    startNote();
    await wait(60);
    const nt = document.getElementById('ed-title');
    nt.value = 'Closed mid-typing'; nt.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('half a thought');
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    ok('a new note has an id before it is first written', !!stash()?.row?.id, stash());

    await drafts.flush();
    eq('the note the popup never finished is created', 
      window.__DATA.notes.filter((n) => n.title === 'Closed mid-typing').length, 1);
    eq('exactly one row, not one per writer', window.__DATA.notes.length, rowsBefore + 1);

    // Replaying is idempotent: the same draft written twice is one note.
    await drafts.put({ table: 'notes', row: { id: note('Closed mid-typing').id,
      title: 'Closed mid-typing', body: 'half a thought, finished', format: 'plain', tags: [] } });
    await drafts.flush();
    eq('replaying a draft updates the note rather than adding another',
      window.__DATA.notes.filter((n) => n.title === 'Closed mid-typing').length, 1);
    eq('and the later words win', note('Closed mid-typing').body, 'half a thought, finished');

    // Opening a note and walking away is not a draft.
    await reset();
    await openNoteEditor('Grocery');
    await wait(220);
    eq('a note you only looked at leaves nothing behind', stash(), null);

    startNote();
    await wait(60);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    eq('nor does an empty new note', stash(), null);

    // What boot() does with a draft from a popup that never came back.
    await reset();
    await drafts.put({ table: 'notes', row: { id: note('Grocery').id, title: 'Grocery',
      body: 'left behind by a popup that closed', format: 'plain', tags: [] } });
    await boot();
    for (let i = 0; i < 60 && stash(); i++) await wait(20);
    eq('opening the popup writes a draft the last one left', stash(), null);
    eq('and the note has it', note('Grocery').body, 'left behind by a popup that closed');

    document.getElementById('home').click();
    await wait(120);

    // ================= SELECTING IS NOT EDITING =================
    group('selecting a note');
    await reset();

    const stamp = note('Grocery').updated_at;
    let writes = 0;
    const realUpdate2 = db.update.bind(db);
    db.update = async (...a2) => { writes++; return realUpdate2(...a2); };

    rowFor('Grocery').click();
    await wait(140);
    eq('focus stays in the search field, so the list still arrows',
      document.activeElement.id, 'q');
    ok('the note is in the pane, ready to type in', !!document.getElementById('ed-area'));

    rowFor('Launch checklist').click();
    await settled();
    db.update = realUpdate2;
    eq('moving on does not rewrite a note you only looked at', writes, 0);
    eq('so its timestamp is untouched', note('Grocery').updated_at, stamp);

    document.getElementById('home').click();
    await wait(150);

    // ================= A SLOW SERVER =================
    // The fixtures answer instantly, which hid a race for two weeks: two saves
    // of a brand new note could both see a row with no id and both insert it.
    group('saving against a slow server');
    await reset();

    const realInsert = db.insert.bind(db);
    let insertCalls = 0;
    db.insert = async (t, row) => { insertCalls++; await wait(600); return realInsert(t, row); };

    const noteCountBefore = window.__DATA.notes.length;
    startNote();
    await wait(60);
    editorType('first burst');
    await wait(SAVE_DEBOUNCE + 60);          // the insert is now in flight
    editorType('second burst');
    await wait(2200);
    db.insert = realInsert;

    eq('a new note is inserted once, however fast you type',
      window.__DATA.notes.length - noteCountBefore, 1);
    eq('and the later keystrokes land in that row', window.__DATA.notes[0].body, 'second burst');
    eq('the save label settles',
      document.getElementById('ed-saved')?.textContent ?? '(the editor closed)', 'Saved');
    document.getElementById('home').click();
    await wait(120);

    // A failing save must not leave the label claiming it is still working.
    await reset();
    await openNoteEditor('Grocery');
    const realUpdate = db.update.bind(db);
    db.update = async () => { throw new Error('server said no'); };
    editorType('doomed');
    await wait(SAVE_DEBOUNCE + 400);
    db.update = realUpdate;
    eq('a failed save says so', document.getElementById('ed-saved')?.textContent, 'Not saved');
    document.getElementById('home').click();
    await wait(200);

    // ================= ROW ACTIONS =================
    group('row actions');
    await reset();

    const firstRow = $$('#list .row:not(.act)')[0];
    ok('a row carries its own actions', !!firstRow.querySelector('.row-acts'));
    ok('they are hidden until the row is hovered or selected',
      getComputedStyle($$('#list .row:not(.act)')[1].querySelector('.row-acts')).opacity === '0',
      getComputedStyle($$('#list .row:not(.act)')[1].querySelector('.row-acts')).opacity);

    const noteRow = rowFor('Launch checklist');
    const wasPinned = window.__DATA.notes.find((n) => n.id === 'n1').pinned;
    noteRow.querySelector('[data-row-act=pin]').click();
    await wait(150);
    ok('the pin action works without opening the row',
      window.__DATA.notes.find((n) => n.id === 'n1').pinned !== wasPinned,
      window.__DATA.notes.find((n) => n.id === 'n1').pinned);

    const linkRow = rowFor('Migrate to Manifest V3');
    linkRow.querySelector('[data-row-act=read]').click();
    await wait(150);
    ok('a link can be marked read from the list',
      window.__DATA.read_later.find((r) => r.id === 'l1').is_read === true);

    const notesBeforeDelete = window.__DATA.notes.length;
    rowFor('Grocery').querySelector('[data-row-act=delete]').click();
    await wait(200);
    eq('and deleted from the list', window.__DATA.notes.length, notesBeforeDelete - 1);

    ok('an action row has none of them', !act('Save the clipboard').querySelector('.row-acts') ||
      getComputedStyle(act('Save the clipboard').querySelector('.row-acts')).display === 'none');

    // ================= WHAT AN ACTION SHOWS =================
    // The pane previews what the action will add, under a neutral header, with a
    // button that names what it does.
    group('action panes');
    await reset();
    const hoverAct = async (title) => {
      const i = state.rows.findIndex((r) => r.kind === 'action' && r.title === title);
      setActive(i, false);
      await wait(80);
    };
    await hoverAct('Save this tab');
    const band = document.querySelector('#detail .d-band');
    ok('the header is neutral, not note yellow', band.classList.contains('act-band'), band.className);
    ok('it previews the page that will be saved',
      /Sign in to GitHub/.test(document.querySelector('#detail .link-preview')?.textContent || ''),
      document.querySelector('#detail .d-body')?.textContent);
    const tabBtn = document.querySelector('#detail .d-foot .primary');
    ok('the button says what it does', /^Save tab/.test(tabBtn.textContent), tabBtn.textContent);
    ok('and never just "Do it"', !/Do it/.test(document.getElementById('detail').textContent));

    await hoverAct('Save the clipboard');
    ok('the clipboard action shows what it would save, or why it cannot',
      !!document.querySelector('#detail .clip-preview'));
    eq('its button names it', document.querySelector('#detail .d-foot .primary').textContent, 'Save clipboard');

    // A fresh install: only action rows, nothing picked, a welcome in the pane.
    group('welcome');
    for (const t of ['notes', 'read_later', 'clips']) window.__DATA[t].length = 0;
    await loadNotes(); await loadLater(); await loadClips();
    state.picked = false;
    state.active = 0;
    draw();
    await wait(80);
    ok('an empty library shows the welcome', /Everything stays in this browser/.test(document.getElementById('detail').textContent),
      document.getElementById('detail').textContent.slice(0, 80));
    ok('and does not pick an action for you', !document.querySelector('#list [aria-selected=true]'));
    ok('it offers sync as an option', /Sign in to sync/.test(document.getElementById('detail').textContent));
    press('ArrowDown');
    await wait(80);
    ok('an arrow key picks the first row', document.querySelector('#list [aria-selected=true]')?.id === 'r0');

    // ================= REACHING THE ACTIONS =================
    // A filtered list used to hide every action, so an empty Notes list was a
    // dead end: nothing in it, and no way to put anything in it.
    group('adding from a filtered list');
    await reset();

    document.querySelector('.rail [data-f=note]').click();
    await wait(40);
    ok('the Notes filter still offers a way to start one',
      !document.getElementById('compose').classList.contains('hidden'));
    ok('and no "New note" row duplicating it', !act('New note'), actTitles());
    ok('and not the other kinds', !act('Save this tab') && !act('Save the clipboard'), actTitles());

    document.querySelector('.rail [data-f=link]').click();
    await wait(40);
    ok('the Read later filter offers Save this tab', !!act('Save this tab'), actTitles());

    document.querySelector('.rail [data-f=clip]').click();
    await wait(40);
    ok('the Clipboard filter offers Save the clipboard', !!act('Save the clipboard'), actTitles());

    // An empty filtered list is the case that was broken.
    window.__DATA.notes.length = 0;
    await loadNotes();
    document.querySelector('.rail [data-f=note]').click();
    await wait(60);
    ok('an empty Notes list still offers a way to start one',
      !document.getElementById('compose').classList.contains('hidden'));

    type('anything');
    ok('searching hides the actions', actTitles().length === 0, actTitles());
    type('');
    document.querySelector('.rail [data-f=all]').click();
    await wait(40);

    // ================= THE ADD-NOTE SECTION =================
    // The composer at the top of the list. The thing it must never do is lose
    // the line you typed into it: the note has to exist, with that line in it,
    // without anyone pressing Save.
    group('add note from the list');
    await reset();

    const composer = () => document.getElementById('compose-in');
    const composeShown = () => !document.getElementById('compose').classList.contains('hidden');
    const composeKey = (key) => composer().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const composeEnter = (text) => { composer().value = text; composeKey('Enter'); };

    ok('Everything shows the add-note section', composeShown());
    document.querySelector('.rail [data-f=note]').click();
    await wait(40);
    ok('so does Notes', composeShown());
    document.querySelector('.rail [data-f=clip]').click();
    await wait(40);
    ok('Clipboard hides it, being unable to hold a note', !composeShown());
    document.querySelector('.rail [data-f=all]').click();
    await wait(40);
    ok('and it is back under Everything', composeShown());

    composeEnter('Milk and bread');
    await wait(100);
    ok('Enter opens the editor on the new note', !!document.getElementById('ed-area'));
    eq('with the typed line already in it', editorText(), 'Milk and bread');
    eq('and the composer cleared', composer().value, '');
    await settled();
    ok('the note is written without anyone pressing Save',
      !!window.__DATA.notes.find((n) => (n.body || '').trim() === 'Milk and bread'),
      window.__DATA.notes.map((n) => n.body));
    document.getElementById('home').click();
    await settled();
    ok('and it is listed under the line that was typed',
      rowTitles().includes('Milk and bread'), rowTitles());

    // One obvious way in: clicking "Take a note…" opens the note, with the whole
    // popup to write in, and the caret in the note rather than in this box.
    const isWide = () => document.getElementById('app').classList.contains('wide');
    composer().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await wait(100);
    ok('clicking Take a note opens the editor', !!document.getElementById('ed-area'));
    ok('with the whole popup to write in', isWide());
    eq('and the caret in the note', document.activeElement?.id, 'ed-area');
    document.getElementById('ed-wide').click();
    await wait(60);
    ok('the width button brings the list back', !isWide());
    ok('beside the list there is no Back button: the list is right there',
      getComputedStyle(document.getElementById('ed-back')).display === 'none');
    document.getElementById('ed-wide').click();
    await wait(60);
    const back = document.getElementById('ed-back');
    ok('a full-popup note has a labelled way back', !!back && /Back/.test(back.textContent));
    ok('at the top left, where people look for it',
      back.getBoundingClientRect().left - document.getElementById('ed-band').getBoundingClientRect().left < 40);
    back.click();
    await settled();
    ok('Back closes the note and shows the list', !isWide() && !state.editing?.isNew,
      { wide: isWide(), editing: state.editing && state.editing.title });
    ok('with focus back in the search field', document.activeElement?.id === 'q',
      document.activeElement?.id || document.activeElement?.tagName);
    composer().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await wait(100);
    document.getElementById('home').click();
    await settled();
    ok('leaving leaves the list at its usual width', !isWide());

    // Typing the first letter is enough: no Enter to discover.
    composer().focus();
    composer().value = 'H';
    composer().dispatchEvent(new Event('input', { bubbles: true }));
    composer().value += 'i';                       // typed while the note opens
    composer().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    eq('typing into Take a note starts the note with that letter', editorText(), 'Hi');
    eq('and only one note is started', $$('#ed-area').length, 1);
    eq('the box is empty again', composer().value, '');
    ok('this note opens wide too', isWide());
    document.getElementById('home').click();
    await settled();

    const beforeEmpty = window.__DATA.notes.length;
    composeEnter('   ');
    await wait(100);
    ok('an empty line opens an empty editor, as New note does',
      !!document.getElementById('ed-area'));
    document.getElementById('home').click();
    await settled();
    eq('and writes no blank row', window.__DATA.notes.length, beforeEmpty);

    chip('home').click();
    await wait(60);
    composeEnter('Tagged on arrival');
    await settled();
    const tagged = window.__DATA.notes.find((n) => (n.body || '').trim() === 'Tagged on arrival');
    ok('a note made under a tag filter carries that tag',
      !!tagged && (tagged.tags || []).includes('home'), tagged && tagged.tags);
    document.getElementById('home').click();
    await settled();

    // It is a section of the list card, not something floating over the list:
    // it must sit inside the card and leave the list its room.
    const cardBox = document.querySelector('.listcard').getBoundingClientRect();
    const composeBox = document.getElementById('compose').getBoundingClientRect();
    ok('the section sits inside the list card',
      composeBox.top >= cardBox.top - 0.5 && composeBox.bottom <= cardBox.bottom + 0.5,
      { card: Math.round(cardBox.top), compose: Math.round(composeBox.top) });
    ok('and leaves the list its room',
      document.getElementById('list').clientHeight > 150,
      document.getElementById('list').clientHeight);

    composer().value = 'half a thought';
    composeKey('Escape');
    eq('Escape clears the line rather than closing the popup', composer().value, '');
    composeKey('Escape');
    eq('a second Escape hands focus back to search', document.activeElement.id, 'q');

    // ================= VAULT EDITOR =================
    // Creating a login was dropped in the redesign and nothing noticed, because
    // no test asked for it.
    group('vault editor');
    await reset();
    await unlockVault();

    document.querySelector('.rail [data-f=vault]').click();
    await wait(40);
    ok('the Vault filter offers New login', !!act('New login'), actTitles());

    act('New login').click();
    await wait(60);
    ok('it opens a form', !!document.getElementById('v-pass'), document.querySelector('.d-kind')?.textContent);
    ok('prefilled from the page you are on',
      document.getElementById('v-url').value.includes('github.com'),
      document.getElementById('v-url').value);

    const vaultBefore = window.__DATA.vault_items.length;
    const vt = document.getElementById('v-title');
    vt.value = 'Made by a test'; vt.dispatchEvent(new Event('input', { bubbles: true }));
    const vu = document.getElementById('v-user');
    vu.value = 'someone@example.com'; vu.dispatchEvent(new Event('input', { bubbles: true }));
    const vp = document.getElementById('v-pass');
    vp.value = 'a-real-password'; vp.dispatchEvent(new Event('input', { bubbles: true }));

    ok('the password starts masked', vp.type === 'password', vp.type);
    $$('.v-row button')[0].click();
    ok('and can be revealed', vp.type === 'text', vp.type);

    $$('.v-row button')[1].click();
    ok('a password can be generated', vp.value.length > 8 && vp.value !== 'a-real-password', vp.value);
    vp.value = 'a-real-password'; vp.dispatchEvent(new Event('input', { bubbles: true }));

    $$('.d-foot button').find((b) => /Save/.test(b.textContent)).click();
    await wait(200);
    eq('saving adds one row', window.__DATA.vault_items.length, vaultBefore + 1);
    const made = window.__DATA.vault_items.find((v) => v._plain.title === 'Made by a test');
    ok('the login is stored encrypted, not in columns',
      !!made && !('title' in made) && !('password' in made), made && Object.keys(made));
    eq('with the password that was typed', made._plain.password, 'a-real-password');

    await wait(60);
    rowFor('Made by a test').click();
    await wait(30);
    $$('.d-foot button').find((b) => /Edit/.test(b.textContent)).click();
    await wait(60);
    ok('an existing login can be edited', document.getElementById('v-title').value === 'Made by a test',
      document.getElementById('v-title')?.value);
    const vu2 = document.getElementById('v-user');
    vu2.value = 'changed@example.com'; vu2.dispatchEvent(new Event('input', { bubbles: true }));
    $$('.d-foot button').find((b) => /Save/.test(b.textContent)).click();
    await wait(200);
    eq('editing does not add a second row', window.__DATA.vault_items.length, vaultBefore + 1);
    eq('and the change is kept',
      window.__DATA.vault_items.find((v) => v._plain.title === 'Made by a test')._plain.username,
      'changed@example.com');

    rowFor('Made by a test').click();
    await wait(30);
    $$('.d-foot button').find((b) => /Edit/.test(b.textContent)).click();
    await wait(60);
    $$('.d-foot button').find((b) => /Cancel/.test(b.textContent)).click();
    await wait(60);
    ok('Cancel leaves the form', !document.getElementById('v-pass'));
    document.querySelector('.rail [data-f=all]').click();
    await wait(40);

    // ================= READ LATER =================
    group('read later');
    await reset();
    rowFor('Migrate to Manifest V3').click();
    await wait(140);
    ok('the detail pane shows the link', /developer\.chrome\.com/.test(document.querySelector('.d-body').textContent));
    $$('.d-foot button').find((b) => /Mark read/.test(b.textContent)).click();
    await wait(80);
    ok('marking read flips the row', window.__DATA.read_later.find((r) => r.id === 'l1').is_read === true);

    // ================= CLIPBOARD =================
    group('clipboard');
    await reset();
    rowFor('Rosewood').click();
    await wait(140);
    const clipText = window.__DATA.clips.find((c) => c.id === 'c3').content;
    $$('.d-foot button').find((b) => /As note/.test(b.textContent)).click();
    await wait(120);
    ok('a clip can become a note',
      window.__DATA.notes.some((n) => n.body === clipText), window.__DATA.notes.map((n) => n.title));

    // "As note" just made a note whose title starts with the same text, so the
    // clip has to be picked out by type rather than by what the row says.
    document.querySelector('.rail [data-f=clip]').click();
    await wait(140);
    rowFor('Rosewood').click();
    await wait(140);
    $$('.d-foot button').find((b) => b.getAttribute('title') === 'Delete').click();
    await wait(140);
    ok('deleting a clip erases its text instead of trashing it',
      !window.__DELETED.clips?.length, window.__DELETED.clips);
    document.querySelector('.rail [data-f=all]').click();
    await wait(60);

    // ================= VAULT =================
    group('vault');
    await reset();
    ok('a locked vault lists nothing', !rowTitles().some((t) => t === 'GitHub'), rowTitles());
    ok('and offers to unlock', !!act('Unlock the vault'), actTitles());

    act('Unlock the vault').click();
    await wait(30);
    const pw = document.querySelector('.gate input');
    pw.value = 'wrong';
    document.querySelector('.gate .primary').click();
    await wait(120);
    ok('a wrong master password is refused',
      /Wrong master password/.test(document.querySelector('.gate .msg')?.textContent || ''),
      document.querySelector('.gate .msg')?.textContent);

    await unlockVault();
    ok('unlocking lists the saved logins', rowTitles().includes('GitHub'), rowTitles());

    rowFor('GitHub').click();
    await wait(140);
    ok('the password is masked until asked for',
      document.getElementById('vpw').textContent.startsWith('•'), document.getElementById('vpw').textContent);
    document.getElementById('vpw-show').click();
    ok('Show, beside the password, reveals it', document.getElementById('vpw').textContent === 'hunter2hunter2',
      document.getElementById('vpw').textContent);
    eq('and says it is shown', document.getElementById('vpw-show').getAttribute('aria-pressed'), 'true');

    $$('.d-foot button').find((b) => b.getAttribute('title') === 'Lock the vault').click();
    await wait(120);
    ok('locking hides the logins again', !rowTitles().includes('GitHub'), rowTitles());

    // ================= TRASH =================
    group('trash');
    await reset();
    setScreen('trash');
    await wait(80);
    ok('the trash lists soft-deleted rows', $$('.tr-row').length === 3, $$('.tr-row').length);
    ok('a locked vault item has no readable title',
      $$('.tr-row .t').some((e) => e.textContent === 'Vault item'), $$('.tr-row .t').map((e) => e.textContent));

    $$('.tr-row button').find((b) => /Restore/.test(b.textContent)).click();
    await wait(150);
    ok('restoring puts the row back',
      window.__DATA.notes.some((n) => n.title === 'Old standup notes'), window.__DATA.notes.map((n) => n.title));
    ok('and takes it out of the trash', $$('.tr-row').length === 2, $$('.tr-row').length);

    $$('.tr-row button').find((b) => /Delete forever/.test(b.textContent)).click();
    await wait(150);
    ok('delete forever removes it', $$('.tr-row').length === 1, $$('.tr-row').length);

    const emptyBtn = () => $$('#screen button').find((b) => /Empty trash|Delete everything/.test(b.textContent));
    emptyBtn().click();
    await wait(60);
    ok('Empty trash asks first', /Delete everything\?/.test(emptyBtn().textContent) && $$('.tr-row').length === 1,
      emptyBtn().textContent);
    emptyBtn().click();
    await wait(200);
    eq('and empties it on the second click', $$('.tr-row').length, 0);
    setScreen(null);

    // ================= SETTINGS =================
    group('settings');
    await reset();
    setScreen('settings');
    await wait(30);
    ok('settings opens over both panes', !document.getElementById('screen').hidden);
    ok('the account is shown', /khoaiz@example\.com/.test(document.querySelector('.sc-body').textContent));

    const sw = document.querySelector('[role=switch]');
    eq('clipboard capture starts off', sw.getAttribute('aria-checked'), 'false');
    sw.click();
    await wait(60);
    eq('the toggle turns it on', document.querySelector('[role=switch]').getAttribute('aria-checked'), 'true');
    ok('and the preference is stored', window.__store.settings.clipCapture === true, window.__store.settings);
    ok('signed in, there is a way out that keeps the data',
      $$('.sc-row button').some((b) => b.textContent === 'Sign out'));
    ok('and a separate one that erases this device',
      $$('.sc-row button').some((b) => b.textContent === 'Erase'));
    ok('no sign-in form while signed in', !document.getElementById('signin'));
    ok('export is offered', $$('.sc-row button').some((b) => b.textContent === 'Export'));
    ok('and import', $$('.sc-row button').some((b) => b.textContent === 'Import'));

    // Erasing asks twice: the first click only says what will happen.
    const erase = () => $$('.sc-row button').find((b) => /^Erase/.test(b.textContent));
    erase().click();
    await wait(30);
    ok('the first click on Erase only asks', !window.__erased && /Erase this device\?/.test(erase().textContent),
      erase().textContent);
    setScreen(null);

    // ================= NO ACCOUNT =================
    // A fresh install has no account and must not need one.
    group('no account');
    window.__signedOut = true;
    await reset();
    ok('the app opens with no sign-in screen in front of it',
      !document.getElementById('app').classList.contains('hidden') && !document.getElementById('auth'));
    ok('the list is there', rowTitles().length > 0, rowTitles().length);
    ok('the offline strip is not nagging about sync', document.getElementById('offline-bar').classList.contains('hidden'));

    startNote();
    await wait(60);
    const tNo = document.getElementById('ed-title');
    tNo.value = 'No account needed'; tNo.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('saved on this device');
    await settled();
    ok('a note saves without an account', note('No account needed')?.body === 'saved on this device',
      note('No account needed'));
    document.getElementById('home').click();
    await wait(80);

    setScreen('settings');
    await wait(30);
    ok('settings says where the data is', /Saved on this device/.test(document.querySelector('.sc-body').textContent));
    ok('and offers to sign in, as an option', !!document.getElementById('signin'));
    ok('there is no Sign out to press', !$$('.sc-row button').some((b) => b.textContent === 'Sign out'));
    const signin = document.getElementById('signin');
    signin.querySelector('input[type=email]').value = 'me@example.com';
    signin.querySelector('input[type=password]').value = 'wrong-password';
    signin.querySelector('.primary').click();
    await wait(60);
    ok('a failed sign-in says why, and the app stays usable',
      /Invalid login/.test(signin.querySelector('.msg').textContent), signin.querySelector('.msg').textContent);

    // Creating an account: the email carries a code, typed in here.
    signin.querySelector('input[type=password]').value = 'a-good-password';
    signin.querySelector('.ghost').click();
    await wait(60);
    ok('Create account asks for the emailed code', !!signin.querySelector('.code-in'));
    ok('and names the address it went to', /me@example\.com/.test(signin.querySelector('.code-note')?.textContent || ''));
    signin.querySelector('.code-in').value = '123456';
    signin.querySelector('.primary').click();
    await wait(60);
    ok('a wrong code says so', /wrong or has expired/.test(signin.querySelector('.msg').textContent),
      signin.querySelector('.msg').textContent);
    signin.querySelector('.ghost').click();
    await wait(60);
    ok('Send a new code sends one', window.__codeResent === true && /Sent/.test(signin.querySelector('.msg').textContent));

    // The popup closes while the user reads the email; the code step must survive.
    setScreen(null);
    await wait(30);
    setScreen('settings');
    await wait(60);
    const signinAgain = document.getElementById('signin');
    ok('reopening goes straight back to the code', !!signinAgain.querySelector('.code-in'));
    signinAgain.querySelector('.code-other').click();
    await wait(60);
    ok('Use a different email returns to the sign-in form', !!signinAgain.querySelector('input[type=email]') && !signinAgain.querySelector('.code-in'));
    ok('and forgets the pending address', !(await chrome.storage.local.get('pendingCode')).pendingCode);

    // Forgot password: a code, then a new password.
    const forgotBtn = () => [...document.querySelectorAll('#signin button')].find((b) => b.textContent === 'Forgot password?');
    signinAgain.querySelector('input[type=email]').value = '';
    forgotBtn().click();
    await wait(60);
    ok('Forgot password asks for the email first', /Enter your email/.test(signinAgain.querySelector('.msg').textContent),
      signinAgain.querySelector('.msg').textContent);
    signinAgain.querySelector('input[type=email]').value = 'me@example.com';
    forgotBtn().click();
    await wait(60);
    ok('then sends a reset code to it', window.__resetFor === 'me@example.com');
    ok('and asks for the code and a new password',
      !!signinAgain.querySelector('.code-in') && !!signinAgain.querySelector('.new-pass'));
    ok('it says the vault master password is not reset', /not the vault/.test(signinAgain.querySelector('.code-note').textContent));
    signinAgain.querySelector('.code-in').value = '111111';
    signinAgain.querySelector('.new-pass').value = 'short';
    signinAgain.querySelector('.primary').click();
    await wait(40);
    ok('a short new password is refused before sending', /8 or more/.test(signinAgain.querySelector('.msg').textContent));
    signinAgain.querySelector('.new-pass').value = 'a-new-password';
    signinAgain.querySelector('.primary').click();
    await wait(60);
    ok('a wrong reset code says so', /wrong or has expired/.test(signinAgain.querySelector('.msg').textContent)
      && !window.__updateUserCalls, signinAgain.querySelector('.msg').textContent);

    setScreen(null);
    await wait(30);
    setScreen('settings');
    await wait(60);
    const resetAgain = document.getElementById('signin');
    ok('reopening goes back to the reset step', !!resetAgain.querySelector('.new-pass'));
    resetAgain.querySelector('.code-in').value = '654321';
    resetAgain.querySelector('.new-pass').value = 'a-new-password';
    resetAgain.querySelector('.primary').click();
    await wait(60);
    ok('a refused new password says why', /should be different/.test(resetAgain.querySelector('.msg').textContent));
    ok('and the used code is not asked for again', resetAgain.querySelector('.code-in').disabled);
    resetAgain.querySelector('.primary').click();
    await wait(60);
    eq('a retry sets the password without the code', window.__updateUserCalls, 2);
    resetAgain.querySelector('.code-other').click();
    await wait(40);
    ok('Back to sign in forgets the reset', !(await chrome.storage.local.get('pendingCode')).pendingCode
      && !!resetAgain.querySelector('input[type=email]'));
    setScreen(null);
    window.__signedOut = false;

    // ================= VAULT RECOVERY =================
    group('vault recovery');
    const gateMsg = () => document.querySelector('.gate .msg')?.textContent || '';
    const gateFill = (values) => {
      const inputs = [...document.querySelectorAll('.gate input:not([type=checkbox])')];
      values.forEach((v, i) => { inputs[i].value = v; });
    };
    const gateGo = async () => { document.querySelector('.gate .primary').click(); await wait(120); };
    const openFromSettings = async (id) => {
      setScreen('settings');
      await wait(40);
      document.getElementById(id).click();
      await wait(150);
    };
    window.__vaultMeta = null;
    await lockVault();
    await wait(40);

    setScreen('settings');
    await wait(40);
    ok('settings warns while there is no recovery key', /No recovery key yet/.test(document.querySelector('.sc-body').textContent));
    eq('and offers to make one', document.getElementById('vault-recovery')?.textContent, 'Make one');
    ok('and to change the master password', !!document.getElementById('vault-password'));

    await openFromSettings('vault-recovery');
    ok('making a key asks for the master password first', /Make a recovery key/.test(document.querySelector('.gate h3')?.textContent || ''));
    gateFill(['not-it']);
    await gateGo();
    ok('a wrong master password makes no key', /Wrong master password/.test(gateMsg()) && !window.__vaultMeta?.rk_wrap_ct, gateMsg());
    gateFill([TEST_MASTER_PASSWORD]);
    await gateGo();
    const rkShown = document.getElementById('rk')?.textContent || '';
    ok('the key is shown', /^[A-Z0-9]{4}(-[A-Z0-9]{4}){7}$/.test(rkShown), rkShown);
    ok('it does not count until Done', !window.__vaultMeta?.rk_wrap_ct);
    const rkDoneBtn = () => [...document.querySelectorAll('.gate button')].find((b) => b.textContent === 'Done');
    ok('Done waits until it is saved somewhere', rkDoneBtn()?.disabled === true);
    draw();
    await wait(60);
    ok('a list redraw does not take the key off the screen', document.getElementById('rk')?.textContent === rkShown);
    document.querySelector('.rk-ok input').click();
    ok('ticking "I saved it" allows Done', rkDoneBtn()?.disabled === false);
    rkDoneBtn().click();
    await wait(80);
    ok('Done closes it', !document.getElementById('rk'));
    ok('and saves it, locked', window.__vaultMeta?.rk_wrap_ct === 'rk:' + rkShown.replace(/-/g, ''));

    // A key closed without Done is not kept: the earlier one still works.
    await openFromSettings('vault-recovery');
    gateFill([TEST_MASTER_PASSWORD]);
    await gateGo();
    const unsavedKey = document.getElementById('rk')?.textContent || '';
    act('Unlock the vault').click();
    await wait(80);
    ok('picking something else closes the key screen', !document.getElementById('rk'));
    ok('and the unsaved key is not kept', unsavedKey && window.__vaultMeta?.rk_wrap_ct === 'rk:' + rkShown.replace(/-/g, ''));

    await openFromSettings('vault-password');
    gateFill(['not-it', 'brand-new-master', 'brand-new-master']);
    await gateGo();
    ok('changing the master password checks the current one', /Wrong master password/.test(gateMsg()), gateMsg());
    gateFill([TEST_MASTER_PASSWORD, 'brand-new-master', 'brand-new-mastr']);
    await gateGo();
    ok('and that the new one was typed twice the same', /don't match/.test(gateMsg()), gateMsg());
    gateFill([TEST_MASTER_PASSWORD, 'brand-new-master', 'brand-new-master']);
    await gateGo();
    eq('the new master password is set', window.__vaultMeta?.pw_wrap_ct, 'pw:brand-new-master');
    ok('and the recovery key kept', window.__vaultMeta?.rk_wrap_ct === 'rk:' + rkShown.replace(/-/g, ''));

    // Forgot it: the recovery key, then a new master password.
    await lockVault();
    act('Unlock the vault').click();
    await wait(60);
    const vaultForgot = [...document.querySelectorAll('.gate button')].find((b) => b.textContent === 'Forgot master password?');
    ok('the lock screen offers a way back in', !!vaultForgot);
    vaultForgot.click();
    await wait(80);
    gateFill(['ABCD-0000-0000-0000-0000-0000-0000-0000', 'remembered-now', 'remembered-now']);
    await gateGo();
    ok('a wrong recovery key is refused', /doesn't open this vault/.test(gateMsg()) && state.vaultState !== 'open', gateMsg());
    gateFill([rkShown.toLowerCase().replace(/-/g, ' '), 'remembered-now', 'remembered-now']);
    await gateGo();
    eq('the recovery key, typed loosely, opens the vault', state.vaultState, 'open');
    eq('with the new master password set', window.__vaultMeta?.pw_wrap_ct, 'pw:remembered-now');

    // No recovery key at all: the only way out is to start again.
    window.__vaultMeta = null;
    await lockVault();
    act('Unlock the vault').click();
    await wait(60);
    [...document.querySelectorAll('.gate button')].find((b) => b.textContent === 'Forgot master password?').click();
    await wait(80);
    ok('with no recovery key, forgot offers a reset', /Reset the vault/.test(document.querySelector('.gate h3')?.textContent || ''));
    ok('and says what it deletes', /saved login/.test(document.querySelector('.gate p')?.textContent || ''));
    gateFill(['reset please']);
    await gateGo();
    ok('a reset needs RESET typed', /Type RESET/.test(gateMsg()) && !window.__vaultReset, gateMsg());
    [...document.querySelectorAll('.gate button')].find((b) => b.textContent === 'Cancel').click();
    await wait(60);
    ok('Cancel leaves the vault as it was', !window.__vaultReset && !document.querySelector('.gate h3')?.textContent.includes('Reset'));

    // Two vaults unsettled: the account's may hold the real logins.
    window.__vaultConflict = true;
    await openVaultPanel(drawResetVault);
    gateFill(['RESET']);
    await gateGo();
    ok('no reset while this device and the account have different vaults', /different vaults/.test(gateMsg()) && !window.__vaultReset, gateMsg());
    window.__vaultConflict = false;
    closeVaultPanel();
    await wait(40);

    // The panel holds the pane against redraws, not against the user.
    await openFromSettings('vault-password');
    newNote?.();
    await wait(120);
    ok('opening a note lets go of a vault panel', !document.querySelector('#detail [data-vault-panel]'));
    if (state.editing) await closeEditor();
    await wait(40);

    window.__vaultMeta = null;
    window.__vaultReset = false;
    setScreen(null);
    await wait(40);

    // ================= TWO VAULTS =================
    group('two vaults');
    window.__vaultConflict = true;
    await reset();
    setScreen('settings');
    await wait(30);
    ok('settings shows the choice', /Two vaults/.test(document.querySelector('.sc-body').textContent));
    const keepAcct = () => $$('.sc-row button').find((b) => /Keep account|Delete this device/.test(b.textContent));
    keepAcct().click();
    await wait(20);
    ok('choosing asks a second time first', !window.__resolvedVault, window.__resolvedVault);
    window.__vaultConflict = false;
    setScreen(null);

    // ================= PLANS =================
    group('plans');
    await reset();
    setScreen('settings');
    await wait(30);
    ok('Pro is shown with no limits', /Pro/.test(document.querySelector('.sc-body').textContent) &&
      /No limit/.test(document.querySelector('.sc-body').textContent));
    ok('Pro keeps the trash a year', /a year/.test(document.querySelector('.sc-body').textContent));
    setScreen(null);

    window.__plan = 'free';
    await reset();
    setScreen('settings');
    await wait(30);
    const planText = document.querySelector('.sc-body').textContent;
    ok('Free names its limits', /newest 200 captured clips/.test(planText) && /30 days/.test(planText), planText.slice(0, 300));
    ok('and says sync is part of Pro', /Free plan: everything stays on this device/.test(planText));
    ok('the offline strip does not count changes that will never sync',
      document.getElementById('offline-bar').classList.contains('hidden'));
    setScreen(null);
    // Ten templates already: the eleventh is refused, and the note is untouched.
    for (let i = 0; i < 10; i++) state.notes.push({ id: 'tpl' + i, title: 'T' + i, body: '', format: 'plain', tags: ['template'] });
    startNote();
    await wait(60);
    toggleTemplate();
    await wait(30);
    ok('Free refuses an eleventh template', !state.draft.tags.includes('template'), state.draft.tags);
    state.notes = state.notes.filter((n) => !/^tpl/.test(n.id));
    document.getElementById('home').click();
    await wait(80);
    ok('Free names its note, login and backup-code limits',
      /Notes.*20/.test(planText) && /Logins.*20/.test(planText) && /backup codes.*2/.test(planText), planText.slice(0, 600));
    // Twenty notes already: a new one does not open.
    const realNotes = state.notes;
    state.notes = Array.from({ length: 20 }, (_, i) => ({ id: 'cap' + i, title: 'N' + i, body: '', format: 'plain', tags: [] }));
    newNote();
    await wait(30);
    ok('Free refuses a twenty-first note', !state.editing, state.editing);
    state.notes = realNotes;
    // Twenty logins already: the new-login form does not open.
    await unlockVault();
    const realVault = state.vault;
    state.vault = Array.from({ length: 20 }, (_, i) => ({ id: 'lg' + i, title: 'L' + i }));
    openVaultEditor(null);
    ok('Free refuses a twenty-first login', !state.vEditing, state.vEditing);
    // Two logins with codes: a third cannot take any.
    state.vault = [{ id: 'a', codes: [{ code: '1' }] }, { id: 'b', codes: [{ code: '2' }] }];
    ok('Free refuses backup codes on a third login', codeSetsFull('c') === true);
    ok('but a login that already has codes can keep them', codeSetsFull('a') === false);
    state.vault = realVault;
    document.getElementById('home').click();
    await wait(80);
    window.__plan = undefined;

    // ================= SHORTCUTS =================
    group('shortcuts');
    await chrome.storage.local.set({ shortcuts: [{ title: '', url: 'https://www.facebook.com/' }] });
    document.getElementById('home').click();
    await wait(120);
    ok('All with nothing picked shows the shortcuts', !!document.querySelector('#detail [data-shortcuts]'));
    eq('a tile is named after its site', document.querySelector('.qs-tile .qs-name')?.textContent, 'Facebook');
    eq('an address is made whole', shortcutUrl('claude.ai'), 'https://claude.ai/');
    eq('and nonsense is refused', shortcutUrl('not a site'), null);
    document.querySelector('.qs-manual').click();
    await wait(60);
    const scUrl = document.getElementById('qs-url');
    scUrl.value = 'chatgpt.com'; scUrl.dispatchEvent(new Event('input'));
    document.querySelector('.qs-form').requestSubmit();
    await wait(120);
    eq('a site added by hand is kept',
      (await chrome.storage.local.get('shortcuts')).shortcuts.map((s) => s.url),
      ['https://www.facebook.com/', 'https://chatgpt.com/']);
    document.querySelector('#list [role=option]:not(.act)')?.click();
    await wait(120);
    ok('picking a row replaces them', !document.querySelector('#detail [data-shortcuts]'));
    document.getElementById('home').click();
    await wait(120);
    ok('and All brings them back', !!document.querySelector('#detail [data-shortcuts]'));
    // Free keeps five: the + tile says Pro, and adding by hand is refused.
    window.__plan = 'free';
    await loadPlan();
    await chrome.storage.local.set({ shortcuts: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ title: '', url: `https://${x}.com/` })) });
    state.scForm = null;
    await drawShortcuts();
    eq('at five on Free, + says the limit is reached', document.querySelector('.qs-add .qs-name')?.textContent, 'Limit reached');
    document.querySelector('.qs-manual').click();
    await wait(60);
    ok('and a sixth cannot be added by hand', !document.querySelector('.qs-form'));
    window.__plan = undefined;
    await loadPlan();
    await chrome.storage.local.set({ shortcuts: [] });
    state.scForm = null;

    // ================= THEME =================
    group('theme');
    const themeBtn = document.getElementById('theme');
    const href = () => themeBtn.querySelector('use').getAttribute('href');
    eq('it starts on light', document.documentElement.dataset.theme, 'light');
    eq('and shows the sun icon', href(), '#i-sun');
    themeBtn.click(); await wait(20);
    eq('one click is dark', document.documentElement.dataset.theme, 'dark');
    eq('shown as a moon', href(), '#i-moon');
    ok('the choice is stored', window.__store.theme === 'dark', window.__store.theme);
    themeBtn.click(); await wait(20);
    eq('two clicks is back to light, with no third state', document.documentElement.dataset.theme, 'light');
    applyTheme('system');
    eq('an old stored "system" reads as light', document.documentElement.dataset.theme, 'light');

    // ================= THE LOGO =================
    group('the logo resets');
    await reset();
    document.querySelector('.rail [data-f=link]').click();
    type('#chrome man');
    setScreen('settings');
    await wait(30);
    document.getElementById('home').click();
    await wait(250);          // leaving a note saves first, so this is not instant
    eq('it clears the search', q().value, '');
    ok('it drops the type filter and tags', /Everything/.test(head()), head());
    ok('it closes the screen', document.getElementById('screen').hidden);
    eq('and puts focus back in the search field', document.activeElement.id, 'q');
    ok('selecting the unlock row does not steal the cursor into the password field',
      document.activeElement.id === 'q', document.activeElement.id || document.activeElement.tagName);

    // ================= TODAY =================
    // The top of Everything: pinned things, unread links, and notes and clips
    // from the last day. The rest is under Earlier.
    group('today');
    await reset();
    ok('the rail has no Today filter any more', !document.querySelector('.rail [data-f=today]'));
    const todayHeads = $$('#list .g-head').map((e) => e.textContent);
    ok('Everything opens on Today, then Earlier', todayHeads[0] === 'Today' && todayHeads.includes('Earlier'), todayHeads);
    const todayRows = sectionTitles('Today');
    ok('a pinned note is in it', todayRows.includes('Launch checklist'), todayRows);
    ok('so are unread links', todayRows.includes('Migrate to Manifest V3'), todayRows);
    ok('a link already read is not', !todayRows.includes('RLS performance'), todayRows);
    ok('nor a clip from days ago', !todayRows.some((t) => /Rosewood/.test(t)), todayRows);
    ok('and those are under Earlier', sectionTitles('Earlier').includes('RLS performance'), sectionTitles('Earlier'));
    press('2', { ctrlKey: true });
    press('0', { ctrlKey: true });
    await wait(40);
    ok('Ctrl+0 goes to Everything', /Everything/.test(head()), head());

    // ================= SECRETS AND CODE =================
    group('secrets and code');
    await reset();
    const secretRow = $$('#list .row.k-clip').find((r) => r.textContent.includes('sk-p'));
    ok('a key in the clipboard is listed masked', !!secretRow && secretRow.textContent.includes('••••'),
      secretRow?.textContent);
    ok('and none of its middle is on screen', !document.getElementById('list').textContent.includes('long-token-value'));
    type('long-token');
    await wait(30);
    ok('search does not find a secret by its text', !rowTitles().some((t) => /sk-p/.test(t)), rowTitles());
    type('');
    await wait(30);
    const cmdRow = $$('#list .row.k-clip').find((r) => r.textContent.includes('npx supabase'));
    ok('a command is set in monospace', !!cmdRow?.querySelector('.t.mono'));
    const addrRow = $$('#list .row.k-clip').find((r) => r.textContent.includes('Rosewood'));
    ok('an address is not', !!addrRow && !addrRow.querySelector('.t.mono'));

    secretRow.click();
    await wait(140);
    ok('the pane keeps it masked', /••••/.test(document.getElementById('clip-v')?.textContent || ''),
      document.getElementById('clip-v')?.textContent);
    document.getElementById('clip-show').click();
    ok('Show reveals it', /long-token-value/.test(document.getElementById('clip-v').textContent));
    document.getElementById('clip-vault').click();
    await wait(60);
    ok('To vault asks for the vault to be unlocked first', !!document.querySelector('.gate input'));
    await unlockVault();
    document.querySelector('.rail [data-f=clip]').click();
    await wait(80);
    $$('#list .row.k-clip').find((r) => r.textContent.includes('sk-p')).click();
    await wait(140);
    document.getElementById('clip-vault').click();
    await wait(60);
    const secretText = window.__DATA.clips.find((c) => c.id === 'c2').content;
    eq('the vault form starts with the key as the password', document.getElementById('v-pass')?.value, secretText);
    ok('and names the site it came from', /platform\.openai\.com/.test(document.getElementById('v-title')?.value || ''),
      document.getElementById('v-title')?.value);
    $$('#detail .d-foot button').find((b) => /Save/.test(b.textContent)).click();
    await wait(200);
    ok('saving puts it in the vault',
      window.__DATA.vault_items.some((v) => v._plain?.password === secretText),
      window.__DATA.vault_items.map((v) => v._plain?.title));
    ok('and erases the clip', !window.__DATA.clips.some((c) => c.id === 'c2'));
    document.getElementById('home').click();
    await wait(80);

    // ================= INSERT INTO THE PAGE =================
    group('insert into the page');
    await reset();
    const realExec = chrome.scripting.executeScript;
    let injected = null;
    chrome.scripting.executeScript = async (opts) => { injected = opts; return [{ result: { ok: true } }]; };
    rowFor('Rosewood').click();
    await wait(140);
    document.getElementById('clip-insert').click();
    await wait(60);
    eq('Insert types the clip into the page', injected?.args?.[0], window.__DATA.clips.find((c) => c.id === 'c3').content);
    eq('into the tab behind the popup', injected?.target?.tabId, 1);
    injected = null;
    const groceryIdx = state.rows.findIndex((r) => r.kind === 'note' && r.title === 'Grocery');
    setActive(groceryIdx, false);
    await wait(120);
    press('Enter', { shiftKey: true });
    await wait(60);
    eq('Shift+Enter inserts a note’s text', injected?.args?.[0], 'oat milk\ncoffee beans\ntahini');
    chrome.scripting.executeScript = async () => [{ result: { ok: false } }];
    document.getElementById('home').click();
    await wait(120);
    rowFor('Rosewood').click();
    await wait(140);
    document.getElementById('clip-insert').click();
    await wait(60);
    ok('with no text box focused, it says what to do',
      /Click into a text box/.test(document.getElementById('toast').textContent), document.getElementById('toast').textContent);
    chrome.scripting.executeScript = realExec;
    pageInsertCheck: {
      // The injected function itself, run against a field in this page.
      const field = el('textarea', {});
      document.body.append(field);
      field.value = 'Hello ';
      field.focus();
      field.setSelectionRange(6, 6);
      const res = pageInsert('world');
      eq('the injected code types at the caret', field.value, 'Hello world');
      ok('and reports success', res.ok === true);
      field.remove();
      document.activeElement?.blur();
      const none = pageInsert('x');
      ok('a page with no text box focused gets nothing', none.ok === false);
      q().focus();
    }
    document.getElementById('home').click();
    await wait(80);

    // ================= A NOTE ON A LINK =================
    group('a note on a link');
    await reset();
    rowFor('Migrate to Manifest V3').click();
    await wait(140);
    const ln = document.getElementById('link-note');
    ok('a saved link has a note field', !!ln);
    ln.focus();
    ln.value = 'needed for the store review';
    ln.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(450);
    eq('what you type is saved on the link', window.__DATA.read_later.find((r) => r.id === 'l1').note,
      'needed for the store review');
    q().focus();
    document.getElementById('home').click();
    await wait(120);
    type('store review');
    await wait(30);
    ok('and the link can be found by it', rowTitles().includes('Migrate to Manifest V3'), rowTitles());
    type('');

    // A word deep in a note finds the note, not only its first line.
    type('tahini');
    await wait(30);
    ok('search reaches the whole body of a note', rowTitles().includes('Grocery'), rowTitles());
    type('');
    await wait(30);

    // ================= COPY AS A LIST =================
    group('copy as a list');
    await reset();
    let copied = null;
    const realWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (t) => { copied = t; };
    ok('Everything has no copy button', !document.getElementById('copy-list'));
    toggleTag('launch');
    await wait(40);
    document.getElementById('copy-list').click();
    await wait(40);
    ok('a tagged list copies its links with their URLs',
      /Migrate to Manifest V3\n  https:\/\/developer\.chrome\.com/.test(copied || ''), copied);
    ok('and its notes with their text', /- Launch checklist\n  Before the store listing/.test(copied || ''), copied);
    type('');
    document.querySelector('.rail [data-f=clip]').click();
    await wait(40);
    document.getElementById('copy-list').click();
    await wait(40);
    ok('a secret clip is never copied out', !/sk-proj/.test(copied || ''), copied);
    ok('the others are', /npx supabase/.test(copied || ''), copied);
    navigator.clipboard.writeText = realWrite;
    document.querySelector('.rail [data-f=all]').click();
    await wait(40);

    // ================= EMPTY STATES AND HINTS =================
    group('empty states and hints');
    await reset();
    window.__DATA.clips.length = 0;
    await loadClips();
    document.querySelector('.rail [data-f=clip]').click();
    await wait(60);
    ok('an empty Clipboard says how to fill it',
      /Save the clipboard above/.test(document.querySelector('#list .empty.hint')?.textContent || ''),
      document.querySelector('#list')?.textContent);
    document.querySelector('.rail [data-f=all]').click();
    await reset();
    setActive(state.rows.findIndex((r) => r.kind === 'clip'), false);
    await wait(80);
    ok('the footer says what Enter does to a clip', /copy/.test(document.getElementById('keyhint').textContent),
      document.getElementById('keyhint').textContent);
    setActive(state.rows.findIndex((r) => r.kind === 'link'), false);
    await wait(80);
    ok('and to a link', /open/.test(document.getElementById('keyhint').textContent),
      document.getElementById('keyhint').textContent);
    ok('a link row shows its site icon, or the dot when there is none',
      !!$$('#list .row.k-link')[0]?.querySelector('.fav, .bul'));
    ok('the rail filters are labelled', $$('.rail [data-f] .lbl').map((e) => e.textContent).join(',') === 'All,Notes,Later,Clips,Vault',
      $$('.rail [data-f] .lbl').map((e) => e.textContent));
    ok('the side panel button is hidden where there is no side panel', document.getElementById('to-panel').hidden);
    ok('the detail pane is not a live region any more', !document.getElementById('detail').hasAttribute('aria-live'));

    // ================= SAVE STATUS =================
    group('save status');
    await reset();
    document.getElementById('compose-in').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await wait(200);
    eq('a new note does not claim to be saved', document.getElementById('ed-saved')?.textContent, '');
    document.getElementById('home').click();
    await wait(200);
    await reset();
    await openNoteEditor('Grocery');
    const realUpd = db.update.bind(db);
    db.update = async () => { throw new Error('server said no'); };
    editorType('doomed again');
    await wait(SAVE_DEBOUNCE + 400);
    ok('a failed save offers Retry', document.getElementById('ed-retry')?.hidden === false);
    db.update = realUpd;
    document.getElementById('ed-retry').click();
    await wait(300);
    eq('and Retry saves it', document.getElementById('ed-saved')?.textContent, 'Saved');
    ok('Retry goes away once it worked', document.getElementById('ed-retry')?.hidden === true);
    document.getElementById('home').click();
    await wait(200);

    // ================= OPENED FOR A REASON =================
    group('opened by a shortcut');
    await reset();
    chrome.storage.session = {
      async get() { return { pendingAction: 'note' }; },
      async remove() { window.__pendingCleared = true; }
    };
    await startAction();
    await wait(200);
    ok('Alt+Shift+K opens straight into a new note', !!state.editing?.isNew);
    ok('and the request is used up', window.__pendingCleared === true);
    delete chrome.storage.session;
    document.getElementById('home').click();
    await wait(200);

    // ================= SETTINGS ARE MERGED =================
    group('settings are kept together');
    await reset();
    setScreen('settings');
    await wait(30);
    document.querySelector('[data-setting=clipCapture]').click();
    await wait(40);
    document.querySelector('[data-setting=skipSecrets]').click();
    await wait(40);
    ok('turning one setting off keeps the others',
      window.__store.settings.clipCapture === true && window.__store.settings.skipSecrets === false,
      window.__store.settings);
    ok('the new shortcuts are listed', /Alt\+Shift\+K/.test(document.querySelector('.sc-body').textContent));
    setScreen(null);
    await wait(30);

    // ================= EDITOR: LAYOUT =================
    group('editor layout');
    await reset();
    await openNoteEditor('Grocery');
    const hb = document.getElementById('ed-band').getBoundingClientRect();
    ok('the header is one row', hb.height < 60, Math.round(hb.height));
    ok('the title sits in that row, beside Back', !!document.querySelector('.ed-top #ed-title'));
    ok('no "Note" label repeating what the colour says', !document.querySelector('#ed-band .d-kind'));
    ok('the footer says when it was edited', /edited/.test(document.getElementById('ed-meta').textContent),
      document.getElementById('ed-meta').textContent);
    ok('the start chips stay away from a note with words', document.getElementById('ed-start').hidden);
    document.getElementById('home').click();
    await wait(200);

    // ================= EDITOR: STARTING A NOTE =================
    group('starting a note');
    await reset();
    const notesAtStart = window.__DATA.notes.length;
    startNote();
    await wait(200);
    ok('an empty note offers Note, Tasks and Email', !document.getElementById('ed-start').hidden &&
      $$('#ed-start [data-start]').map((b) => b.dataset.start).join() === 'note,tasks,email');
    document.querySelector('[data-start=tasks]').click();
    await wait(30);
    eq('Tasks starts a list', editorText(), '[ ] ');
    eq('with the caret after the box', document.getElementById('ed-area').selectionStart, 4);
    ok('and the chips go', document.getElementById('ed-start').hidden);
    document.getElementById('home').click();
    await wait(SAVE_DEBOUNCE + 200);
    eq('a list that was never written in is not saved', window.__DATA.notes.length, notesAtStart);

    startNote();
    await wait(200);
    document.querySelector('[data-start=email]').click();
    await wait(30);
    eq('Email starts with To and Subject', editorText(), 'To: \nSubject: \n\n');
    document.getElementById('home').click();
    await wait(200);

    const areaKey = (key, opts = {}) => document.getElementById('ed-area')
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
    const caretTo = (pos) => { const a = document.getElementById('ed-area'); a.focus(); a.setSelectionRange(pos, pos); };

    startNote();
    await wait(200);
    editorType('/task');
    caretTo(5);
    areaKey('Enter');
    await wait(30);
    eq('/task then Enter starts a list', editorText(), '[ ] ');
    document.getElementById('home').click();
    await wait(200);

    // ================= EDITOR: TASKS =================
    group('tasks in a note');
    await reset();
    await openNoteEditor('Grocery');
    editorType('Shop\n[ ] milk');
    caretTo(editorText().length);
    areaKey('Enter');
    await wait(20);
    eq('Enter at the end of a task starts the next one', editorText(), 'Shop\n[ ] milk\n[ ] ');
    areaKey('Enter');
    await wait(20);
    eq('Enter on an empty one ends the list', editorText(), 'Shop\n[ ] milk\n');
    editorType('Shop\n[ ] milk\n[ ] eggs');
    caretTo(8);                                   // inside "milk"
    areaKey('Enter', { ctrlKey: true });
    await wait(20);
    eq('Ctrl+Enter ticks the line you are on', editorText(), 'Shop\n[x] milk\n[ ] eggs');
    ok('and does not close the note', !!state.editing);
    {
      const lines = $$('#ed-area > .ln');
      const milk = lines[1], eggs = lines[2];
      eq('a task shows its words, not "[x]"', milk.innerText.trim(), 'milk');
      ok('ticked lines are drawn done', milk.hasAttribute('data-done') && milk.dataset.k === 'task');
      ok('and struck through', getComputedStyle(milk).textDecorationLine.includes('line-through'),
        getComputedStyle(milk).textDecorationLine);
      ok('an open task is not', !eggs.hasAttribute('data-done') && eggs.dataset.k === 'task');
      const box = getComputedStyle(milk, '::before');
      ok('its checkbox sits in the margin, clear of the words',
        parseFloat(box.left) + parseFloat(box.width) < parseFloat(getComputedStyle(milk).paddingLeft),
        { left: box.left, width: box.width, pad: getComputedStyle(milk).paddingLeft });
      ok('the pointer is a hand over a checkbox', box.cursor === 'pointer', box.cursor);
    }
    ok('the footer shows a progress bar', !document.getElementById('ed-prog').hidden);
    ok('the footer counts them', /1\/2 done/.test(document.getElementById('ed-meta').textContent),
      document.getElementById('ed-meta').textContent);

    {
      // Press on the "eggs" checkbox, the way a real pointer would: the line
      // under the pointer is what receives the press.
      const area = document.getElementById('ed-area');
      const line = $$('#ed-area > .ln')[2];
      const r = line.getBoundingClientRect();
      caretTo(2);                                 // in "Shop", away from the box
      line.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + 8, clientY: r.top + 10, button: 0, bubbles: true, cancelable: true }));
      await wait(20);
      eq('clicking a box ticks it', editorText(), 'Shop\n[x] milk\n[x] eggs');
      eq('without moving the caret', area.selectionStart, 2);
      const line2 = $$('#ed-area > .ln')[2];
      const r2 = line2.getBoundingClientRect();
      line2.dispatchEvent(new MouseEvent('mousedown', { clientX: r2.left + 60, clientY: r2.top + 10, button: 0, bubbles: true, cancelable: true }));
      await wait(20);
      eq('pressing on the words does not tick anything', editorText(), 'Shop\n[x] milk\n[x] eggs');
    }

    caretTo(6);
    areaKey('ArrowDown', { altKey: true });
    await wait(20);
    eq('Alt+Down moves the line down', editorText(), 'Shop\n[x] eggs\n[x] milk');
    caretTo(editorText().length);
    areaKey('Tab');
    await wait(20);
    eq('Tab indents a list item', editorText(), 'Shop\n[x] eggs\n  [x] milk');
    areaKey('Tab', { shiftKey: true });
    await wait(20);
    eq('Shift+Tab takes it back out', editorText(), 'Shop\n[x] eggs\n[x] milk');

    editorType('[x] a\n[ ] b\n[x] c\n[ ] d');
    document.getElementById('ed-menu').click();
    $$('.ed-foot .menu button').find((b) => /Ticked to the bottom/.test(b.textContent)).click();
    await wait(20);
    eq('the menu sends ticked items to the bottom', editorText(), '[ ] b\n[ ] d\n[x] a\n[x] c');
    await wait(SAVE_DEBOUNCE + 200);
    eq('and it is all saved as plain text', note('Grocery').body, '[ ] b\n[ ] d\n[x] a\n[x] c');
    document.getElementById('home').click();
    await wait(200);
    ok('the list shows how far along it is', /2\/4 done/.test(rowFor('Grocery')?.textContent || ''),
      rowFor('Grocery')?.textContent);

    // ================= EDITOR: FORMATTING A SELECTION =================
    group('the formatting toolbar');
    await reset();
    await openNoteEditor('Grocery');
    {
      const area = document.getElementById('ed-area');
      const bar = () => document.getElementById('ed-tools');
      const select = async (a, b) => {
        area.focus();
        area.setSelectionRange(a, b);
        updateTools();
        await wait(20);
      };
      const press = (key) => bar().querySelector(`[data-fmt=${key}]`)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      const lit = (key) => bar().querySelector(`[data-fmt=${key}]`).getAttribute('aria-pressed') === 'true';

      editorType('make it bold now');
      ok('the toolbar is always on screen, with nothing selected', !!bar() && bar().getBoundingClientRect().height > 0);
      eq('with bold, italic and three kinds of list',
        $$('#ed-tools [data-fmt]').map((b) => b.dataset.fmt).join(), 'bold,italic,task,bullet,number');
      const tb = bar().getBoundingClientRect(), pane = document.getElementById('detail').getBoundingClientRect();
      ok('in the bottom bar, under the note', !!bar().closest('.ed-foot') && tb.right <= pane.right &&
        tb.top >= area.getBoundingClientRect().bottom - 1,
        { bar: [tb.right, tb.top], pane: pane.right, text: area.getBoundingClientRect().bottom });
      ok('and it adds no row above the note',
        area.getBoundingClientRect().top - document.getElementById('ed-band').getBoundingClientRect().bottom < 60);
      await select(8, 12);

      press('bold');
      await wait(20);
      eq('B makes the selection bold', editorText(), 'make it **bold** now');
      eq('and keeps the same words selected', area.value.slice(area.selectionStart, area.selectionEnd), 'bold');
      eq('the button shows it is on', bar().querySelector('[data-fmt=bold]').getAttribute('aria-pressed'), 'true');
      const boldEl = document.querySelector('#ed-area .b');
      eq('the words are shown bold', boldEl?.textContent, 'bold');
      ok('really bold', +getComputedStyle(boldEl).fontWeight >= 600, getComputedStyle(boldEl).fontWeight);
      eq('and no ** is shown', document.getElementById('ed-area').innerText.trim(), 'make it bold now');

      // Typing at the end of the bold word carries the bold on, and the stored
      // text keeps its markers in the right place.
      area.setSelectionRange(14, 14);              // after "bold", before the closing **
      area.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'er', bubbles: true, cancelable: true }));
      await wait(20);
      eq('typing on at the end of bold stays bold', editorText(), 'make it **bolder** now');
      area.setSelectionRange(10, 16);
      await wait(20);

      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
      await wait(20);
      eq('Ctrl+I adds italic to the same words', editorText(), 'make it **_bolder_** now');
      ok('shown in italic', getComputedStyle(document.querySelector('#ed-area .em')).fontStyle === 'italic');
      eq('with no markers in sight', document.getElementById('ed-area').innerText.trim(), 'make it bolder now');
      await select(area.selectionStart, area.selectionEnd);
      press('bold');
      await wait(20);
      eq('a second B takes bold off again', editorText(), 'make it _bolder_ now');

      // With nothing selected: B lights up, and stays lit while you type bold.
      editorType('plain ');
      await select(6, 6);
      ok('B is not lit in plain text', !lit('bold'));
      press('bold');
      await wait(10);
      ok('pressing B with nothing selected lights it', lit('bold'));
      eq('and writes nothing yet', editorText(), 'plain ');
      area.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'loud', bubbles: true, cancelable: true }));
      await wait(10);
      updateTools();
      eq('what is typed next is bold', editorText(), 'plain **loud**');
      ok('and B stays lit while the caret is in it', lit('bold'));
      press('bold');
      await wait(10);
      ok('pressing it again turns it off', !lit('bold'));
      area.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: '!', bubbles: true, cancelable: true }));
      await wait(10);
      eq('so the next letters are plain', editorText(), 'plain **loud**!');

      editorType('milk\neggs');
      await select(0, 9);
      press('task');
      await wait(20);
      eq('the checklist button turns the lines into tasks', editorText(), '[ ] milk\n[ ] eggs');
      ok('and lights up on them', lit('task'));
      press('bullet');
      await wait(20);
      eq('the list button turns them into bullets', editorText(), '- milk\n- eggs');
      press('number');
      await wait(20);
      eq('the numbered button numbers them', editorText(), '1. milk\n2. eggs');
      editorType('one line');
      await select(3, 3);
      press('task');
      await wait(20);
      eq('with only a caret, the line it is on becomes a task', editorText(), '[ ] one line');

      // Pressed before clicking into the note: the caret goes into the note first.
      document.getElementById('q').focus();
      press('bold');
      await wait(10);
      eq('a button pressed from outside the note puts the caret in it', document.activeElement.id, 'ed-area');

      // Leaving DeskSync: real formatting where it can go, no markers where it cannot.
      editorType('a **big** day');
      let item = null;
      const realWrite = navigator.clipboard.write;
      navigator.clipboard.write = async (items) => { item = items[0]; };
      document.getElementById('ed-menu').click();
      $$('.ed-foot .menu button').find((b) => /^Copy text/.test(b.textContent)).click();
      await wait(40);
      const html = item ? await (await item.getType('text/html')).text() : null;
      const plain = item ? await (await item.getType('text/plain')).text() : null;
      ok('Copy puts real bold on the clipboard', /<b>big<\/b>/.test(html || ''), html);
      ok('and plain text without the markers', /a big day$/.test(plain || ''), plain);
      navigator.clipboard.write = realWrite;

      const realExec = chrome.scripting.executeScript;
      let args = null;
      chrome.scripting.executeScript = async (o) => { args = o.args; return [{ result: { ok: true } }]; };
      document.getElementById('ed-menu').click();
      $$('.ed-foot .menu button').find((b) => /Insert into page/.test(b.textContent)).click();
      await wait(20);
      eq('Insert sends a plain field the words without markers', args?.[0], 'a big day');
      ok('and a rich editor the bold', /<b>big<\/b>/.test(args?.[1] || ''), args?.[1]);
      chrome.scripting.executeScript = realExec;

      ok('pageInsert gives a rich editor the HTML', (() => {
        const ce = el('div', { contenteditable: 'true' });
        document.body.append(ce);
        ce.focus();
        pageInsert('a big day', '<div>a <b>big</b> day</div>');
        const done = !!ce.querySelector('b');
        ce.remove();
        q().focus();
        return done;
      })());
    }
    await wait(SAVE_DEBOUNCE + 200);
    document.getElementById('home').click();
    await wait(200);
    ok('the list shows the words, not the markers', /a big day/.test(rowFor('Grocery')?.textContent || ''),
      rowFor('Grocery')?.textContent);

    // ================= EDITOR: EDITING AS THE BROWSER DOES IT =================
    // Real keystrokes arrive as beforeinput events; these send the same events.
    group('editing what you see');
    await reset();
    await openNoteEditor('Grocery');
    {
      const area = document.getElementById('ed-area');
      const input = (inputType, data = null) => area.dispatchEvent(
        new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
      const key = (k, opts = {}) => area.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
      const shown = () => area.innerText.replace(/\n$/, '');

      editorType('');
      ok('an empty note shows its placeholder', area.classList.contains('empty'));
      area.focus();
      area.setSelectionRange(0);
      for (const ch of 'hi') input('insertText', ch);
      await wait(10);
      eq('typing writes into the note', editorText(), 'hi');
      ok('and the placeholder goes', !area.classList.contains('empty'));

      editorType('a **bold** b');
      area.setSelectionRange(9);                    // after "bold", inside its markers
      input('deleteContentBackward');
      await wait(10);
      eq('Backspace takes the last letter of a bold word, not its markers', editorText(), 'a **bol** b');
      area.setSelectionRange(4, 7);                 // "bol"
      input('deleteContentBackward');
      await wait(10);
      eq('deleting a whole bold word takes its markers with it', editorText(), 'a  b');

      // Ctrl+B with nothing selected: no "****" in the note, bold for what is typed.
      editorType('say ');
      area.setSelectionRange(4);
      key('b', { ctrlKey: true });
      eq('Ctrl+B with nothing selected writes nothing yet', editorText(), 'say ');
      for (const ch of 'hi there') input('insertText', ch);
      await wait(10);
      eq('what is typed next is bold, spaces and all', editorText(), 'say **hi there**');
      eq('shown without markers', shown(), 'say hi there');
      ok('and in bold', document.querySelector('#ed-area .b')?.textContent === 'hi there');
      key('b', { ctrlKey: true });
      input('insertText', '!');
      await wait(10);
      eq('Ctrl+B again ends the bold', editorText(), 'say **hi there**!');
      key('b', { ctrlKey: true });
      for (const ch of ' jam') input('insertText', ch);
      key('b', { ctrlKey: true });
      input('insertText', '.');
      await wait(10);
      eq('a space typed first stays outside the bold', editorText(), 'say **hi there**! **jam**.');
      eq('so no ** ever shows', shown(), 'say hi there! jam.');

      editorType('**vadsvdas;vlamdsv **');
      eq('a space before the closing ** still shows as bold, markers hidden', shown(), 'vadsvdas;vlamdsv ');
      ok('and is bold', !!document.querySelector('#ed-area .b'));

      editorType('a **bold** b');
      area.setSelectionRange(6);                    // between "bo" and "ld"
      key('Enter');
      await wait(10);
      eq('Enter inside bold keeps both halves bold', editorText(), 'a **bo**\n**ld** b');
      eq('and shows no markers', shown(), 'a bo\nld b');

      editorType('[ ] call the bank');
      area.setSelectionRange(4);                    // start of the task's words
      key('Backspace');
      await wait(10);
      eq('Backspace at the start of a task makes it a plain line', editorText(), 'call the bank');

      editorType('milk\n');
      area.setSelectionRange(5);
      for (const ch of '- eggs') input('insertText', ch);
      await wait(10);
      eq('typing "- " starts a bullet', editorText(), 'milk\n- eggs');
      eq('drawn as one', $$('#ed-area > .ln')[1].dataset.k, 'bullet');
      eq('with only the words to edit', $$('#ed-area > .ln')[1].innerText.trim(), 'eggs');

      key('z', { ctrlKey: true });
      await wait(10);
      ok('Ctrl+Z takes back the typing', editorText() !== 'milk\n- eggs', editorText());
      key('z', { ctrlKey: true, shiftKey: true });
      await wait(10);
      eq('Ctrl+Shift+Z puts it back', editorText(), 'milk\n- eggs');

      editorType('x');
      area.setSelectionRange(1);
      const dt = new DataTransfer();
      dt.setData('text/plain', 'plain');
      dt.setData('text/x-desksync', ' and **bold**');
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await wait(10);
      eq('text copied from a note pastes with its formatting', editorText(), 'x and **bold**');
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', '\nline two');
      dt2.setData('text/html', '<h1 style="color:red">line two</h1>');
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
      await wait(10);
      eq('a page pastes as its text, without its styles', editorText(), 'x and **bold**\nline two');
      ok('nothing of the page’s HTML comes in', !area.querySelector('h1, [style*="color"]'));
    }
    await wait(SAVE_DEBOUNCE + 200);
    eq('and what is saved is the plain text', note('Grocery').body, 'x and **bold**\nline two');
    document.getElementById('home').click();
    await wait(200);

    // ================= EDITOR: EMAIL =================
    group('an email note');
    await reset();
    await openNoteEditor('Grocery');
    ok('an ordinary note has no mail button', document.getElementById('ed-mail').hidden);
    editorType('To: sam@example.com\nSubject: Launch\n\nShipping Friday.');
    await wait(20);
    ok('a note starting with To: gets Open in mail', !document.getElementById('ed-mail').hidden);
    ok('the footer names who it is to', /to sam@example\.com/.test(document.getElementById('ed-meta').textContent),
      document.getElementById('ed-meta').textContent);
    window.__opened = null;
    document.getElementById('ed-mail').click();
    await wait(20);
    eq('Open in mail hands it to the mail app', window.__opened,
      'mailto:sam%40example.com?subject=Launch&body=Shipping%20Friday.');
    document.getElementById('ed-menu').click();
    const gm = $$('.ed-foot .menu button').find((b) => /Open in Gmail/.test(b.textContent));
    ok('the menu offers Gmail as the other way', !!gm);
    gm.click();
    await wait(20);
    ok('which opens a Gmail compose window', /^https:\/\/mail\.google\.com\/mail\/\?view=cm/.test(window.__opened || ''),
      window.__opened);
    let copiedMail = null;
    const realW = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (t) => { copiedMail = t; };
    document.getElementById('ed-menu').click();
    $$('.ed-foot .menu button').find((b) => /Copy the email text/.test(b.textContent)).click();
    await wait(20);
    eq('copying an email takes the message alone', copiedMail, 'Shipping Friday.');
    navigator.clipboard.writeText = realW;
    const realX = chrome.scripting.executeScript;
    let sent = null;
    chrome.scripting.executeScript = async (o) => { sent = o.args[0]; return [{ result: { ok: true } }]; };
    document.getElementById('ed-menu').click();
    $$('.ed-foot .menu button').find((b) => /Insert the email text/.test(b.textContent)).click();
    await wait(20);
    eq('and so does inserting it', sent, 'Shipping Friday.');
    chrome.scripting.executeScript = realX;
    document.getElementById('home').click();
    await wait(200);

    // ================= EDITOR: TEMPLATES =================
    group('templates');
    await reset();
    await openNoteEditor('Grocery');
    document.getElementById('ed-menu').click();
    $$('.ed-foot .menu button').find((b) => /Save as template/.test(b.textContent)).click();
    await wait(SAVE_DEBOUNCE + 200);
    ok('Save as template tags the note #template', note('Grocery').tags.includes('template'), note('Grocery').tags);
    document.getElementById('home').click();
    await wait(200);
    const notesBeforeTpl = window.__DATA.notes.length;
    startNote();
    await wait(200);
    const tplChip = document.querySelector('#ed-start [data-template=n4]');
    ok('a new note offers it', !!tplChip, $$('#ed-start button').map((b) => b.textContent));
    tplChip.click();
    await wait(20);
    eq('picking it copies its text in', editorText(), 'oat milk\ncoffee beans\ntahini');
    document.getElementById('home').click();
    await wait(SAVE_DEBOUNCE + 200);
    eq('a template picked and left alone is not saved as a note', window.__DATA.notes.length, notesBeforeTpl);
    startNote();
    await wait(200);
    document.querySelector('#ed-start [data-template=n4]').click();
    editorType(editorText() + '\nbread');
    await wait(SAVE_DEBOUNCE + 200);
    ok('once you add to it, it is a note of its own',
      window.__DATA.notes.length === notesBeforeTpl + 1 && !window.__DATA.notes[0].tags.includes('template'),
      window.__DATA.notes[0]);
    document.getElementById('home').click();
    await wait(200);

    // ================= EDITOR: FIND AND PASTE =================
    group('find and paste');
    await reset();
    await openNoteEditor('Launch checklist');
    document.getElementById('ed-area').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(20);
    ok('Ctrl+F opens find in the note', !document.getElementById('ed-find').hidden);
    eq('and puts the cursor in it', document.activeElement.id, 'ed-find-in');
    const fi = document.getElementById('ed-find-in');
    fi.value = 'the';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(20);
    const total = (editorText().toLowerCase().match(/the/g) || []).length;
    ok('it counts the matches', new RegExp(`/${total}$`).test(document.getElementById('ed-find-n').textContent),
      document.getElementById('ed-find-n').textContent);
    eq('and marks every one', (CSS.highlights.get('ds-find')?.size || 0) + (CSS.highlights.get('ds-find-cur')?.size || 0), total);
    const firstCur = document.getElementById('ed-find-n').textContent;
    fi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok('Enter goes to the next one', document.getElementById('ed-find-n').textContent !== firstCur);
    fi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(20);
    ok('Esc closes find, not the note', document.getElementById('ed-find').hidden && !!state.editing);
    const ta = document.getElementById('ed-area');
    ok('and leaves the match selected', ta.value.slice(ta.selectionStart, ta.selectionEnd).toLowerCase() === 'the');
    ok('the marks go with it', !CSS.highlights.has('ds-find') && !CSS.highlights.has('ds-find-cur'));

    editorType('see the launch notes');
    ta.focus();
    ta.setSelectionRange(8, 20);                 // "launch notes"
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://example.com/notes');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await wait(20);
    eq('a link pasted over words keeps the words', editorText(), 'see the launch notes (https://example.com/notes)');
    document.getElementById('home').click();
    await wait(200);

    // A list with open items stays in Today however old it is.
    await reset();
    Object.assign(window.__DATA.notes.find((n) => n.id === 'n4'),
      { body: '[ ] call the bank', updated_at: new Date(Date.now() - 5 * 86400000).toISOString() });
    Object.assign(window.__DATA.notes.find((n) => n.id === 'n3'),
      { updated_at: new Date(Date.now() - 5 * 86400000).toISOString() });
    await loadNotes();
    document.querySelector('.rail [data-f=all]').click();
    await wait(60);
    ok('an unfinished list is in Today', sectionTitles('Today').includes('Grocery'), sectionTitles('Today'));
    ok('an old note with no tasks is not', !sectionTitles('Today').includes('Old rich-text note'), sectionTitles('Today'));

    // ================= PICKING SEVERAL =================
    group('picking several rows');
    await reset();
    const ctrlClick = (text, opts = { ctrlKey: true }) =>
      rowFor(text).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
    const picked = () => $$('#list .row.picked .t').map((e) => e.textContent);
    rowFor('Grocery').click();
    await wait(80);
    ctrlClick('Migrate to Manifest V3');
    await wait(40);
    eq('Ctrl+click picks a row and keeps the open one', picked().sort(), ['Grocery', 'Migrate to Manifest V3'].sort());
    ok('the header says how many are picked', /2 selected/.test(head()), head());
    ok('picked rows show their box', $$('#list .row.picked .pick[aria-pressed=true]').length === 2);
    ctrlClick('Migrate to Manifest V3');
    await wait(40);
    eq('Ctrl+click again lets it go', picked(), ['Grocery']);
    press('Escape');
    await wait(40);
    eq('Escape lets go of everything', picked(), []);
    ok('and the header is the list header again', !/selected/.test(head()), head());

    // Shift+click: a run, from the last row picked.
    const pickable = $$('#list .row:not(.act)');
    pickable[0].click();
    await wait(60);
    pickable[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    await wait(40);
    eq('Shift+click picks the rows between', $$('#list .row.picked').length, 3);
    press('Escape');

    // Ctrl+A, with an empty search box only.
    press('a', { ctrlKey: true });
    await wait(40);
    eq('Ctrl+A picks everything listed', $$('#list .row.picked').length, $$('#list .row:not(.act)').length);
    press('a', { ctrlKey: true });
    await wait(40);
    eq('and again lets go', $$('#list .row.picked').length, 0);

    // Narrowing the list lets go of what it hides: a bulk action reaches only
    // rows you can see.
    press('a', { ctrlKey: true });
    await wait(40);
    const qBox = document.getElementById('q');
    qBox.value = 'Grocery';
    qBox.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    eq('a search keeps only the listed rows picked', pickedItems().map((i) => i.row.title), ['Grocery']);
    ok('and the header counts only those', /1 selected/.test(head()), head());
    qBox.value = '';
    qBox.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    press('Escape');
    await wait(40);

    // Shift+arrows grow the set from the open row.
    rowFor('Grocery').click();
    await wait(60);
    press('ArrowDown', { shiftKey: true });
    await wait(40);
    press('ArrowDown', { shiftKey: true });
    await wait(40);
    eq('Shift+Down twice picks three rows', $$('#list .row.picked').length, 3);
    press('ArrowUp', { shiftKey: true });
    await wait(40);
    eq('Shift+Up takes one back', $$('#list .row.picked').length, 2);
    press('Escape');

    // Pin several at once.
    document.querySelector('.rail [data-f=note]').click();
    await wait(60);
    rowFor('Grocery').click();
    await wait(60);
    ctrlClick('Supabase RLS gotcha');
    await wait(40);
    $$('.listhead .bulk-b').find((b) => /^Pin/.test(b.textContent)).click();
    await wait(200);
    ok('Pin pins every picked note', note('Grocery').pinned && note('Supabase RLS gotcha').pinned,
      [note('Grocery').pinned, note('Supabase RLS gotcha').pinned]);

    // Tag several at once.
    $$('.listhead .bulk-b').find((b) => /Tag/.test(b.textContent)).click();
    const tagIn = document.querySelector('.listhead .bulk-tag');
    ok('Tag opens a box for the tag', !!tagIn);
    tagIn.value = '#Batch';
    tagIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settled();
    ok('the tag lands on every picked note', note('Grocery').tags.includes('batch') && note('Supabase RLS gotcha').tags.includes('batch'),
      [note('Grocery').tags, note('Supabase RLS gotcha').tags]);
    ok('and leaves the rest alone', !note('Launch checklist').tags.includes('batch'));

    // Delete asks on the button, then deletes them all, with Undo.
    const delBtn = () => $$('.listhead .bulk-b.danger')[0];
    delBtn().click();
    await wait(20);
    ok('the first click on Delete asks', /Delete 2\?/.test(delBtn().textContent), delBtn().textContent);
    ok('and deletes nothing yet', !!note('Grocery'));
    delBtn().click();
    await wait(250);
    ok('the second click deletes every picked note', !note('Grocery') && !note('Supabase RLS gotcha'));
    ok('they leave the list', !rowTitles().includes('Grocery') && !rowTitles().includes('Supabase RLS gotcha'), rowTitles());
    ok('and nothing is picked any more', !/selected/.test(head()), head());
    document.querySelector('#toast .toast-act').click();
    await wait(250);
    ok('Undo brings them all back', !!note('Grocery') && rowTitles().includes('Grocery') && rowTitles().includes('Supabase RLS gotcha'), rowTitles());

    // Changing the type lets go of what was picked.
    rowFor('Grocery').click();
    await wait(60);
    ctrlClick('Launch checklist');
    await wait(40);
    document.querySelector('.rail [data-f=all]').click();
    await wait(60);
    eq('switching type lets go of the picks', $$('#list .row.picked').length, 0);
    // A plain click is a new choice.
    rowFor('Grocery').click();
    await wait(60);
    ctrlClick('Launch checklist');
    await wait(40);
    rowFor('Migrate to Manifest V3').click();
    await wait(60);
    eq('a plain click lets go of the picks', $$('#list .row.picked').length, 0);

    // ================= LAYOUT =================
    group('layout');
    const de = document.documentElement;
    ok('the popup never scrolls horizontally', de.scrollWidth <= de.clientWidth,
      { scroll: de.scrollWidth, client: de.clientWidth });
    ok('the body fits the window Chrome gave it',
      document.body.offsetWidth <= Math.max(de.clientWidth, 780),
      { body: document.body.offsetWidth, client: de.clientWidth });
    ok('Everything and Notes do not share a glyph',
      document.querySelector('#i-all').innerHTML !== document.querySelector('#i-note').innerHTML);

    // The note fills the pane: with no toolbar, the only thing above the text
    // is the strip holding the width switch, and that must stay on screen.
    await reset();
    await openNoteEditor('Grocery');
    const headBox = document.getElementById('ed-band').getBoundingClientRect();
    const wideBox = document.getElementById('ed-wide').getBoundingClientRect();
    ok('the width switch stays inside the header', wideBox.right <= headBox.right + 0.5,
      { head: Math.round(headBox.right), wide: Math.round(wideBox.right) });
    const area = document.getElementById('ed-area').getBoundingClientRect();
    ok('the note takes the width of the pane', area.width >= headBox.width - 1,
      { area: Math.round(area.width), head: Math.round(headBox.width) });
    ok('nothing but the tags sits between the header and the text',
      area.top - headBox.bottom < 70, { gap: Math.round(area.top - headBox.bottom) });
    document.getElementById('home').click();
    await wait(80);

    {
    // A long clip: its text used to be the header's title, and the header does
    // not scroll, so a pasted file filled the pane and pushed the body and the
    // buttons out of sight. The header takes the first line; the body scrolls.
    await reset();
    const longLine = 'First line of a long clip';
    const longClip = longLine + '\n' + Array.from({ length: 200 }, (_, i) =>
      `line ${i} ` + 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(3)).join('\n');
    state.clips.find((c) => c.id === 'c3').content = longClip;
    draw();
    rowFor(longLine).click();
    await wait(30);
    const pane = document.getElementById('detail').getBoundingClientRect();
    const clipBand = document.querySelector('#detail .d-band').getBoundingClientRect();
    const body = document.querySelector('#detail .d-body');
    const foot = document.querySelector('#detail .d-foot').getBoundingClientRect();
    eq('a long clip\'s header shows its first line', document.querySelector('#detail .d-title').textContent, longLine);
    ok('a long clip\'s header stays small', clipBand.height < pane.height / 3,
      { band: Math.round(clipBand.height), pane: Math.round(pane.height) });
    ok('a long clip\'s buttons stay on screen', foot.bottom <= pane.bottom + 0.5 && foot.height > 0,
      { foot: Math.round(foot.bottom), pane: Math.round(pane.bottom) });
    ok('a long clip\'s body scrolls', body.scrollHeight > body.clientHeight && body.clientHeight > 80,
      { scroll: body.scrollHeight, client: body.clientHeight });
    // A title with no line breaks at all is cut at three lines.
    state.clips.find((c) => c.id === 'c3').content = 'Rosewood ' + 'word '.repeat(2000);
    draw();
    rowFor('Rosewood').click();
    await wait(30);
    const t = document.querySelector('#detail .d-title');
    ok('a one-line clip\'s title is cut at three lines',
      t.getBoundingClientRect().height <= parseFloat(getComputedStyle(t).lineHeight) * 3 + 1,
      { h: Math.round(t.getBoundingClientRect().height) });
    }
  } catch (e) {
    fail++;
    lines.push(`<span class="no">  FAIL</span> threw: ${e && e.message}\n${e && e.stack}`);
  }

  report.innerHTML =
    `<span id="summary" class="${fail ? 'no' : 'ok'}">${pass} passed${fail ? `, ${fail} FAILED` : ''}</span>\n` +
    lines.join('\n');
  report.dataset.pass = String(pass);
  report.dataset.fail = String(fail);
  report.dataset.done = '1';
})();
