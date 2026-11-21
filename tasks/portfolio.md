# DeskSync portfolio: many products, one account

Written 2026-11-20. Follows `tasks/roadmap.md`: nothing here starts before DeskSync itself passes
its Phase 2 check (300 installs, 4.5+ rating). One part-time person; dates are targets.

## The idea

desksync.org becomes the home of a family of products built from the same code:

- **One account, one Pro.** Every product signs in to the same Supabase project. DeskSync Pro
  ($3/mo, $24/yr) turns on sync in all of them. The `plans` table already knows nothing about
  which app is asking, so this costs no new backend.
- **Many front doors.** People search the stores for a *job* ("clipboard manager", "read later",
  "backup codes"), not for a bundle. Each product is found by its own search, and every one of them
  leads to the same account and the same Pro.
- **Shared code.** `extension/lib/` (store, sync, tags, format, crypto, codes, sites, fill) is
  already the core. Products differ in manifest, which screens they show, and their listing.

## The products

### Tier 1: the same app, more stores (weeks, almost no new code)

| Product | Where | Work | Why |
|---|---|---|---|
| DeskSync for Edge | Microsoft Edge Add-ons | Same zip; Edge accepts Chrome MV3 | Free listing, less competition than Chrome |
| DeskSync for Brave, Opera, Vivaldi | They install from the Chrome store | Only a line on the site | Free reach |
| DeskSync for Android | Google Play | App exists (`mobile/`); $25 one-off developer fee, store listing, Pro screen done | Pro users need it; it is the Pro feature |
| DeskSync web | app.desksync.org | The popup already runs as a full tab (`?view=tab`); needs a hosting build without `chrome.*` | Pro users reach their notes on any computer, including work ones that block extensions |

### Tier 2: focused apps from the same code (one to two months each)

Each does **one job** well, is listed under that job's search words, and offers "Get the full
DeskSync" inside. Pick at most two, by what the store statistics say people use most.

| Product | What it is | Built from | Competes with |
|---|---|---|---|
| **DeskSync Clipboard** | Clipboard history, snippets, insert into any text box | clips, templates, insert | Clipboard History Pro, Text Blaze (snippets at ~$3/mo) |
| **DeskSync Later** | Read later with a note on every link, unread count | read_later | Instapaper, Raindrop; Pocket's users still moving |
| **DeskSync Codes** | Backup codes and, once built, 2FA codes, encrypted | vault, codes.js | Nothing focused on backup codes; Authy left desktop |

**Chrome Web Store rule to respect:** the spam policy forbids publishing several extensions that
duplicate each other's functionality. A focused app must be a genuinely different product (one
job, its own screens), never the full DeskSync renamed. Read the policy again before the first
spin-off, and do not publish more than one at a time.

### Tier 3: new platforms (only if Pro is paying)

| Product | Work | Gate |
|---|---|---|
| DeskSync for Firefox | Real porting: Firefox has no `sidePanel` (uses `sidebar_action`) and no `offscreen` documents; clipboard clearing and the side panel need other routes | 100+ paying Pro users |
| DeskSync for iPhone | Flutter app exists for Android; needs a Mac, $99/yr Apple fee, review | 200+ paying Pro users, and users asking |
| DeskSync for agencies | Roadmap Phase 4: client spaces for social media managers, priced per space | 3+ managers say they would pay, and how much |

**Not planned:** a desktop app (the browser is where the work happens), team password manager
(crowded, see roadmap), anything that needs a second backend.

## What to build once, for all of them

1. **Core package.** Move `extension/lib/` into `packages/core/`, and make each product a folder
   with its own `manifest.json`, `popup.html` and a list of which screens it shows.
   `make ext PRODUCT=clipboard` builds `dist/clipboard/`. Tests run once against the core.
2. **One sign-in, one Pro** across products: already true (one Supabase project, one `plans`
   row per account). Add a `source` column to the waitlist and to sign-ups to see which product
   brought each user.
3. **One checkout.** Paddle (roadmap Phase 3) sells "DeskSync Pro"; the webhook writes `plans`.
   Every product links to the same checkout page on desksync.org.
4. **Site as the hub.** desksync.org lists every product; each gets its own page
   (desksync.org/clipboard, /later, /codes) written for its search words, with its own store
   link. One privacy policy covers all of them (same data, same server); name each product in it.
5. **Support:** one inbox (support@desksync.org), the product named in the subject by the
   feedback button.

## Order and timing

| When | Do | Check before moving on |
|---|---|---|
| Dec 2026 | Launch DeskSync on Chrome (roadmap Phase 1) | Approved |
| Jan 2027 | Same zip to Edge Add-ons. Site: "Works in Chrome, Edge, Brave, Opera" | Edge approved |
| Jan–Feb 2027 | First users (roadmap Phase 2) | 300 installs, 4.5+ rating, 50 waitlist |
| Feb–Mar 2027 | Paddle and Pro (roadmap Phase 3). Android app on Google Play as the Pro app | First paying users |
| Mar 2027 | Core package split (`packages/core`, `make ext PRODUCT=…`) | All tests still pass |
| Apr 2027 | First focused app: the one store stats point to (likely Clipboard) | 100 installs in its first month |
| May–Jun 2027 | DeskSync web (app.desksync.org) for Pro | Pro users use it weekly |
| Jun 2027 | Second focused app, only if the first one reached its check | — |
| H2 2027 | Tier 3, each only at its gate | See Tier 3 |

## How to tell it is working

No analytics (the privacy policy promises none). Measured with each store's own statistics, the
waitlist and sign-ups (with `source`), and Pro subscriptions:

- **A product earns its place** if it reaches 100 weekly users in three months, or brings at least
  1 in 5 of new Pro subscribers. Otherwise stop updating it and fold its users into DeskSync.
- **The portfolio works** if Pro subscribers grow faster than with DeskSync alone. If every Pro
  comes from the main app, spin-offs are not worth their upkeep; stop at Tier 1.

## Risks

- **Store spam policy:** look-alike extensions can get the whole developer account suspended.
  One focused app at a time, each clearly different, never keyword-stuffed copies.
- **Upkeep:** every product is another listing, review queue and support thread. Shared core and
  one build command keep it to one codebase; still, at most four live products in 2027.
- **Brand blur:** keep "DeskSync" in every name so each product leads back to the main one.
- **One security bug, many products:** the vault code is shared, so a flaw ships everywhere.
  Keep its tests strict and release vault changes to all products together.
