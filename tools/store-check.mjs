// Checks a built extension against the Chrome Web Store's rules before upload.
//   node tools/store-check.mjs dist/extension      (or: make store-check)
// Errors stop the upload; warnings are worth reading. Exits 1 on any error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const dir = process.argv[2] || 'dist/extension';
const errors = [], warnings = [], passed = [];
const ok = (msg) => passed.push(msg);
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const read = (f) => readFileSync(join(dir, f), 'utf8');

if (!existsSync(join(dir, 'manifest.json'))) { console.error(`No manifest.json in ${dir}. Run make ext first.`); process.exit(1); }
const m = JSON.parse(read('manifest.json'));

// ---- the manifest's own limits ----
m.manifest_version === 3 ? ok('Manifest V3') : err('manifest_version must be 3');
m.name?.length <= 75 ? ok(`Name is ${m.name.length} characters (75 at most)`) : err(`Name is ${m.name?.length} characters; 75 at most`);
m.description?.length <= 132 ? ok(`Summary is ${m.description.length} characters (132 at most)`) : err(`Description is ${m.description?.length} characters; 132 at most`);
/^\d+(\.\d+){0,3}$/.test(m.version) ? ok(`Version ${m.version}`) : err(`Version "${m.version}" is not 1 to 4 dot-separated numbers`);
const suggested = Object.values(m.commands || {}).filter((c) => c.suggested_key).length;
suggested <= 4 ? ok(`${suggested} suggested shortcuts (4 at most)`) : err(`${suggested} suggested shortcuts: Chrome refuses to load more than 4`);

// ---- every file the manifest points to ----
const files = [m.action?.default_popup, m.side_panel?.default_path, m.background?.service_worker,
  ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})]
  .filter(Boolean).map((f) => f.split('?')[0]);
const missing = files.filter((f) => !existsSync(join(dir, f)));
missing.length ? err('Missing files: ' + missing.join(', ')) : ok(`All ${files.length} files the manifest names exist`);

// ---- icons: real PNGs at the sizes they claim ----
for (const [size, f] of Object.entries(m.icons || {})) {
  if (!existsSync(join(dir, f))) continue;
  const b = readFileSync(join(dir, f));
  const isPng = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = isPng ? b.readUInt32BE(16) : 0, h = isPng ? b.readUInt32BE(20) : 0;
  isPng && w === +size && h === +size ? ok(`Icon ${size}: ${w}x${h} PNG`) : err(`Icon ${size} (${f}) is ${isPng ? `${w}x${h}` : 'not a PNG'}`);
}
if (!m.icons?.['128']) err('A 128x128 icon is required');

// ---- no remote code ----
const walk = (d) => readdirSync(join(dir, d)).flatMap((n) => {
  const p = join(d, n);
  return statSync(join(dir, p)).isDirectory() ? walk(p) : [p];
});
const all = walk('');
const html = all.filter((f) => extname(f) === '.html');
const remote = html.filter((f) => /<script[^>]+src=["']https?:/i.test(read(f)));
remote.length ? err('Scripts loaded from the network in: ' + remote.join(', ')) : ok('No script is loaded from the network');
const csp = m.content_security_policy?.extension_pages || '';
/unsafe-eval|https?:/.test(csp) ? err(`The extension pages' CSP allows eval or remote sources: ${csp}`) : ok("CSP allows only the extension's own scripts");
const own = all.filter((f) => extname(f) === '.js' && !f.endsWith('supabase.js'));
const evalUse = own.filter((f) => /\beval\s*\(|new Function\s*\(/.test(read(f)));
evalUse.length ? err('eval or new Function in: ' + evalUse.join(', ')) : ok(`No eval in DeskSync's ${own.length} scripts`);

// ---- nothing that should not ship ----
const stray = all.filter((f) => /(^|\/)(tests?|node_modules|\.git)(\/|$)|\.(map|md|sh|py)$|^\.env/.test(f));
stray.length ? err('Files that should not ship: ' + stray.join(', ')) : ok('No tests, docs or source maps in the package');
const bytes = all.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
ok(`Package is ${(bytes / 1024).toFixed(0)} KB`);

// ---- the build's settings ----
const cfg = existsSync(join(dir, 'config.js')) ? read('config.js') : '';
/YOUR-PROJECT|YOUR-ANON-KEY/.test(cfg) ? warn('Supabase is not set in this build: sync will be unavailable (fine for a local-only release)') : ok('Supabase project set');
/YOUR-SUPPORT-EMAIL/.test(cfg) ? err('SUPPORT_EMAIL is not set in .env: Settings has no feedback link, and the store needs a contact') : ok('Support email set');
/YOUR-PRIVACY-URL/.test(cfg) ? err('PRIVACY_URL is not set in .env: the store needs a public privacy policy address') : ok('Privacy policy address set');

// ---- worth a look ----
if (m.host_permissions?.some((h) => /<all_urls>|\*:\/\/\*\//.test(h))) warn('host_permissions asks for every site at install: expect a longer review');
const perms = m.permissions || [];
ok(`${perms.length} permissions, each with a justification in docs/STORE_LISTING.md`);
const listing = existsSync('docs/STORE_LISTING.md') ? readFileSync('docs/STORE_LISTING.md', 'utf8') : '';
const unjustified = perms.filter((p) => !listing.includes('`' + p + '`'));
unjustified.length ? err('No justification in docs/STORE_LISTING.md for: ' + unjustified.join(', ')) : null;

for (const p of passed) console.log('  ok    ' + p);
for (const w of warnings) console.log('  warn  ' + w);
for (const e of errors) console.log('  FAIL  ' + e);
console.log(errors.length ? `\n${errors.length} to fix before uploading.` : '\nReady to upload: make zip, then dist/desksync-extension.zip.');
process.exit(errors.length ? 1 : 0);
