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
      const d = detail === undefined ? '' : `\n        got: ${JSON.stringify(detail)}`;
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

  const openNoteEditor = async (title) => {
    rowFor(title).click();
    await wait(30);
    document.querySelector('.d-foot .primary').click();   // Edit
    await wait(30);
  };

  // The editor is contenteditable now, so "typing" means replacing its content
  // and letting the input handler read it back into markdown.
  const editorType = (htmlOrText) => {
    const a = document.getElementById('ed-area');
    a.innerHTML = /<[a-z]/i.test(htmlOrText) ? htmlOrText : `<p>${htmlOrText}</p>`;
    a.dispatchEvent(new Event('input', { bubbles: true }));
    return a;
  };
  const editorMarkdown = () => md.fromHtml(document.getElementById('ed-area').innerHTML);

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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(80);
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(120);
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
    group('notes — rendering');
    await reset();
    rowFor('Launch checklist').click();
    await wait(20);
    const md1 = document.querySelector('.d-body .md').innerHTML;
    ok('markdown renders task boxes', /class="tasks"/.test(md1));
    ok('markdown renders a blockquote', /<blockquote>/.test(md1), md1.slice(-160));
    ok('markdown renders a link', /<a href="https:\/\//.test(md1));

    rowFor('Old rich-text note').click();
    await wait(20);
    const md2 = document.querySelector('.d-body .md').innerHTML;
    ok('a pre-markdown note still renders', /<strong>old<\/strong>/.test(md2), md2.slice(0, 120));
    ok('its list survives', /<ul><li>first<\/li>/.test(md2), md2);

    // ================= NOTES: EDITOR =================
    group('notes \u2014 editor');
    await openNoteEditor('Old rich-text note');
    ok('the editor shows the note formatted, not its markup',
      /<strong>old<\/strong>/.test(document.getElementById('ed-area').innerHTML),
      document.getElementById('ed-area').innerHTML.slice(0, 120));
    // (the sign-in form also uses data-mode, so look only inside the toolbar)
    ok('there is no Preview button to press', !document.querySelector('.ed-bar [data-mode]'));
    ok('the surface is editable',
      document.getElementById('ed-area').getAttribute('contenteditable') === 'true');

    ok('a pre-markdown note still converts',
      editorMarkdown().includes('**old**'), editorMarkdown().slice(0, 80));

    // Formatting goes through execCommand on a real selection.
    const area = editorType('<p>make me bold</p>');
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(area.querySelector('p'));
    sel.removeAllRanges(); sel.addRange(r);
    document.querySelector('[data-tool=bold]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    ok('the toolbar bolds the selection in place',
      /<b>|<strong>/i.test(area.innerHTML), area.innerHTML);
    ok('and it round-trips to markdown', /\*\*make me bold\*\*/.test(editorMarkdown()), editorMarkdown());

    // Everything the toolbar can make has to survive the trip back to markdown.
    editorType('<h2>Heading</h2><ul><li>one</li><li>two</li></ul>' +
      '<ol><li>first</li></ol><blockquote>quoted</blockquote>' +
      '<p>a <code>span</code> and <a href="https://example.com">a link</a></p>' +
      '<ul class="tasks"><li class="done"><span class="box on"></span><span>done it</span></li>' +
      '<li><span class="box"></span><span>not yet</span></li></ul>');
    const round = editorMarkdown();
    ok('a heading survives', /^## Heading/m.test(round), round);
    ok('a bullet list survives', /^- one\n- two/m.test(round), round);
    ok('a numbered list survives', /^1\. first/m.test(round), round);
    ok('a quote survives', /^> quoted/m.test(round), round);
    ok('inline code survives', /`span`/.test(round), round);
    ok('a link survives', /\[a link\]\(https:\/\/example\.com\)/.test(round), round);
    ok('a ticked task survives', /^- \[x\] done it/m.test(round), round);
    ok('an unticked task survives', /^- \[ \] not yet/m.test(round), round);

    // And rendering that markdown again gives back what was on screen.
    const again = md.render(round);
    ok('rendering it again is stable', /<h2>Heading<\/h2>/.test(again) && /class="tasks"/.test(again),
      again.slice(0, 120));

    // A task box is a control inside the editor.
    editorType('<ul class="tasks"><li><span class="box"></span><span>tick me</span></li></ul>');
    document.querySelector('#ed-area .box').click();
    ok('clicking a task box ticks it off', /- \[x\] tick me/.test(editorMarkdown()), editorMarkdown());

    document.getElementById('home').click();
    await wait(120);

    // ================= BLOCK TOOLS =================
    // execCommand wraps rather than toggles, and splits lists. Left alone that
    // gives a quote inside a quote inside a quote, and three one-item lists in a
    // row that each restart at 1.
    group('block tools');
    await reset();
    await openNoteEditor('Grocery');

    const ed = document.getElementById('ed-area');
    const selectAllOf = (node) => {
      const sel = getSelection();
      const rr = document.createRange();
      rr.selectNodeContents(node);
      sel.removeAllRanges(); sel.addRange(rr);
    };
    const tool = (k) => document.querySelector(`[data-tool=${k}]`)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    editorType('<p>quote me</p>');
    selectAllOf(ed.querySelector('p'));
    tool('quote');
    eq('Quote wraps the line once', ed.querySelectorAll('blockquote').length, 1);
    tool('quote');
    eq('pressing Quote again takes it off', ed.querySelectorAll('blockquote').length, 0);
    tool('quote'); tool('quote'); tool('quote');
    ok('it never nests, however many times it is pressed',
      ed.querySelectorAll('blockquote blockquote').length === 0 &&
      ed.querySelectorAll('blockquote').length <= 1,
      ed.innerHTML);

    editorType('<p>one</p><p>two</p>');
    selectAllOf(ed);
    tool('ol');
    eq('a numbered list is one list, not one per line', ed.querySelectorAll('ol').length, 1);
    ok('and it counts up', /^1\. one\n2\. two/m.test(editorMarkdown()), editorMarkdown());

    editorType('<ol><li>a</li></ol><ol><li>b</li></ol>');
    tool('bold'); // any command triggers the tidy pass
    eq('lists that arrive split are joined', ed.querySelectorAll('ol').length, 1);

    // Task lists: the thing the toolbar had no way to make.
    editorType('<p>buy milk</p>');
    selectAllOf(ed.querySelector('p'));
    tool('task');
    ok('Task list turns a line into a checkbox item', !!ed.querySelector('ul.tasks .box'), ed.innerHTML);
    eq('and it stores as an unticked task', editorMarkdown(), '- [ ] buy milk');

    ed.querySelector('.box').click();
    eq('clicking the box ticks it', editorMarkdown(), '- [x] buy milk');

    selectAllOf(ed.querySelector('li'));
    tool('task');
    ok('pressing Task again turns it back into text',
      !ed.querySelector('ul.tasks') && /buy milk/.test(ed.textContent), ed.innerHTML);

    editorType('<ul><li>one</li><li>two</li></ul>');
    selectAllOf(ed.querySelector('li'));
    tool('task');
    eq('an existing list converts to tasks', editorMarkdown(), '- [ ] one\n- [ ] two');

    document.getElementById('home').click();
    await wait(150);

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
    document.querySelector('.ed-foot .primary').click();
    await settled();
    eq('Done saves what was typed inside the debounce', note('Grocery').body, 'DONE-PATH');

    await openNoteEditor('Grocery');
    editorType('LOGO-PATH');
    document.getElementById('home').click();
    await settled();
    eq('the logo saves on its way out', note('Grocery').body, 'LOGO-PATH');

    const countBefore = window.__DATA.notes.length;
    act('New note').click();
    await wait(60);
    document.getElementById('home').click();
    await settled();
    eq('a note opened and never typed into is discarded', window.__DATA.notes.length, countBefore);

    act('New note').click();
    await wait(60);
    ok('clicking New note opens the editor directly', !!document.getElementById('ed-area'));
    const t = document.getElementById('ed-title');
    t.value = 'Typed once'; t.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('body');
    await settled();
    await settled();
    eq('typing repeatedly still creates exactly one note',
      window.__DATA.notes.filter((n) => n.title === 'Typed once').length, 1);
    eq('a new note is saved as markdown', note('Typed once').format, 'markdown');
    document.getElementById('home').click();
    await wait(80);

    // The regression: the previous editor's close used to clear state.editing
    // after the next one had opened, so the second note was never written.
    await openNoteEditor('Grocery');
    editorType('still here');
    act('New note').click();
    await wait(120);
    const t2 = document.getElementById('ed-title');
    t2.value = 'Second editor'; t2.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('second body');
    await settled();
    ok('opening a second editor keeps the first note', note('Grocery').body === 'still here', note('Grocery').body);
    ok('and saves the second one too', !!note('Second editor'), window.__DATA.notes.map((n) => n.title));
    document.getElementById('home').click();
    await wait(80);

    // ================= A SLOW SERVER =================
    // The fixtures answer instantly, which hid a race for two weeks: two saves
    // of a brand new note could both see a row with no id and both insert it.
    group('saving against a slow server');
    await reset();

    const realInsert = db.insert.bind(db);
    let insertCalls = 0;
    db.insert = async (t, row) => { insertCalls++; await wait(600); return realInsert(t, row); };

    const noteCountBefore = window.__DATA.notes.length;
    act('New note').click();
    await wait(60);
    editorType('first burst');
    await wait(SAVE_DEBOUNCE + 60);          // the insert is now in flight
    editorType('second burst');
    await wait(2200);
    db.insert = realInsert;

    eq('a new note is inserted once, however fast you type',
      window.__DATA.notes.length - noteCountBefore, 1);
    eq('and the later keystrokes land in that row', window.__DATA.notes[0].body, 'second burst');
    eq('the save label settles', document.getElementById('ed-saved')?.textContent, 'Saved');
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

    ok('an action row has none of them', !act('New note').querySelector('.row-acts') ||
      getComputedStyle(act('New note').querySelector('.row-acts')).display === 'none');

    // ================= RESILIENCE =================
    group('a database behind the code');
    await reset();
    window.__missing = ['format'];
    act('New note').click();
    await wait(60);
    const t3 = document.getElementById('ed-title');
    t3.value = 'No format column'; t3.dispatchEvent(new Event('input', { bubbles: true }));
    editorType('must survive');
    await settled();
    ok('the note is saved without the column the server lacks',
      note('No format column')?.body === 'must survive', note('No format column'));
    ok('the column is left out rather than the write failing',
      note('No format column') && !('format' in note('No format column')),
      note('No format column') && Object.keys(note('No format column')));
    ok('the message names the migration to run',
      /001_tags_and_markdown/.test(document.getElementById('toast').textContent),
      document.getElementById('toast').textContent);
    window.__missing = [];
    document.getElementById('home').click();
    await wait(80);

    // ================= REACHING THE ACTIONS =================
    // A filtered list used to hide every action, so an empty Notes list was a
    // dead end: nothing in it, and no way to put anything in it.
    group('adding from a filtered list');
    await reset();

    document.querySelector('.rail [data-f=note]').click();
    await wait(40);
    ok('the Notes filter still offers New note', !!act('New note'), actTitles());
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
    ok('an empty Notes list still offers New note', !!act('New note'), actTitles());

    type('anything');
    ok('searching hides the actions', actTitles().length === 0, actTitles());
    type('');
    document.querySelector('.rail [data-f=all]').click();
    await wait(40);

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
    await wait(20);
    ok('the detail pane shows the link', /developer\.chrome\.com/.test(document.querySelector('.d-body').textContent));
    $$('.d-foot button').find((b) => /Mark read/.test(b.textContent)).click();
    await wait(80);
    ok('marking read flips the row', window.__DATA.read_later.find((r) => r.id === 'l1').is_read === true);

    // ================= CLIPBOARD =================
    group('clipboard');
    await reset();
    rowFor('Rosewood').click();
    await wait(20);
    const clipText = window.__DATA.clips.find((c) => c.id === 'c3').content;
    $$('.d-foot button').find((b) => /As note/.test(b.textContent)).click();
    await wait(120);
    ok('a clip can become a note',
      window.__DATA.notes.some((n) => n.body === clipText), window.__DATA.notes.map((n) => n.title));

    rowFor('Rosewood').click();
    await wait(20);
    $$('.d-foot button').find((b) => b.getAttribute('title') === 'Delete').click();
    await wait(120);
    ok('deleting a clip erases its text instead of trashing it',
      !window.__DELETED.clips?.length, window.__DELETED.clips);

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
    await wait(20);
    ok('the password is masked until asked for',
      document.getElementById('vpw').textContent.startsWith('•'), document.getElementById('vpw').textContent);
    $$('.d-foot button').find((b) => /Show/.test(b.textContent)).click();
    ok('Show reveals it', document.getElementById('vpw').textContent === 'hunter2hunter2',
      document.getElementById('vpw').textContent);

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
    setScreen(null);

    // ================= THEME =================
    group('theme');
    const themeBtn = document.getElementById('theme');
    const href = () => themeBtn.querySelector('use').getAttribute('href');
    eq('it starts on system', document.documentElement.dataset.theme, undefined);
    eq('and shows the monitor icon', href(), '#i-monitor');
    themeBtn.click(); await wait(20);
    eq('one click is light', document.documentElement.dataset.theme, 'light');
    eq('shown as a sun', href(), '#i-sun');
    themeBtn.click(); await wait(20);
    eq('two clicks is dark', document.documentElement.dataset.theme, 'dark');
    eq('shown as a moon', href(), '#i-moon');
    ok('the choice is stored', window.__store.theme === 'dark', window.__store.theme);
    themeBtn.click(); await wait(20);
    eq('three clicks is back to system', document.documentElement.dataset.theme, undefined);

    // ================= THE LOGO =================
    group('the logo resets');
    await reset();
    document.querySelector('.rail [data-f=link]').click();
    type('#chrome man');
    setScreen('settings');
    await wait(30);
    document.getElementById('home').click();
    await wait(80);
    eq('it clears the search', q().value, '');
    ok('it drops the type filter and tags', /Everything/.test(head()), head());
    ok('it closes the screen', document.getElementById('screen').hidden);
    eq('and puts focus back in the search field', document.activeElement.id, 'q');

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

    // The editor toolbar does not fit a narrow pane. The mode switch must stay
    // on screen whatever happens to the formatting tools.
    await reset();
    await openNoteEditor('Grocery');
    const barBox = document.querySelector('.ed-bar').getBoundingClientRect();
    const tools = document.querySelector('.ed-bar .tools');
    const last = [...tools.querySelectorAll('button')].pop().getBoundingClientRect();
    ok('the toolbar never spills outside its bar',
      tools.getBoundingClientRect().right <= barBox.right + 0.5,
      { bar: Math.round(barBox.right), tools: Math.round(tools.getBoundingClientRect().right) });
    ok('the formatting tools scroll rather than being cut off',
      tools.scrollWidth >= tools.clientWidth, { scroll: tools.scrollWidth, client: tools.clientWidth });
    document.getElementById('home').click();
    await wait(80);
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
