# DeskSync roadmap: launch to first income

Written 2026-11-20. Dates are targets for one person working part-time; move them, but keep the
order and the checks.

## The bet

DeskSync is the one place in the browser for the things you keep: notes, saved pages, copied text
and logins, behind one search. No competitor bundles all four. People will not pay for features
(AI makes those cheap to copy); they pay for convenience they use every day, trust, and a product
made for their job. So:

1. **Win users for free** with the bundle, and earn reviews.
2. **Charge for what costs money to run**: sync across computers and the phone.
3. **Test one niche** that might pay more: social media managers juggling clients.

The vault is a reason to choose DeskSync, not a product of its own. Team password managers for
agencies are crowded and cheap (Passpack, TeamPassword, Bitwarden Teams), and an agency picks a
known security company for client passwords.

**Constraint that shapes measurement:** the privacy policy promises no analytics or tracking.
Everything below is measured with the Chrome Web Store's own statistics, the waitlist, signups for
sync, and asking people, never by tracking them.

## Where it stands

Built: notes editor with checklists and formatting, read later, clipboard with secret detection,
vault with backup codes, Alt+Shift+L fill with account chooser, password import, side panel,
tags, offline-first storage, optional sync, Android app (sync only), store listing and
screenshots, privacy policy. 537 UI tests and unit tests pass.

---

## Phase 1: Launch (now to mid-December 2026)

**Goal:** DeskSync live on the Chrome Web Store, free.

- [x] A one-page site with the screenshots, install button and the **waitlist** (`site/`, `make site`)
- [x] Waitlist table, insert-only from the public key (`supabase/migrations/003_waitlist.sql`)
- [x] "Send feedback" and "Rate DeskSync" in Settings → Help; a one-time review request after a week
- [x] `make store-check`: the build checked against the store's rules
- [x] Left-over fixes from the full review
- [x] Site hosted on the VPS (desksync.org, `deploy/vps/`, `make publish-site`)
- [x] **You:** DNS for desksync.org → the VPS; email routing for support@desksync.org; run migration 003
- [ ] `make store-check && make zip`, upload, submit; answer reviewer questions within a day
- [ ] Commit and tag the release (`plugin-release 0.3.0`)

**Done when:** approved and installable.

## Phase 2: First users (mid-December 2026 to end of January 2027)

**Goal:** 300 installs and the first 20 reviews, by being where the right people already are.

- [ ] Post where power users gather: Product Hunt, r/chrome_extensions, r/productivity,
      Indie Hackers, relevant X and LinkedIn communities. One honest post each, with a GIF
- [ ] Ask happy users for a review (once, from the welcome screen after a week of use)
- [ ] Reply to every review and every feedback email
- [ ] Weekly release with what users asked for

**Check at the end of January** (my suggested targets):

| Signal | Keep going | Rethink |
|---|---|---|
| Installs | 300+ | under 100 |
| Store rating | 4.5+ | under 4.0 |
| Weekly users / installs (store stats) | 30%+ | under 15% |
| Waitlist signups | 50+ | under 15 |

If installs are low, the problem is reach or the listing, not the product: rework the store
text and screenshots before building anything new. If people install and leave, ask five of them
why before writing more code.

## Phase 3: Pro (February to March 2027), only if the waitlist reached 50

**Goal:** first paying users.

- [ ] Plan check in Supabase: a `plan` on the account, read by the extension
- [ ] Paddle checkout and webhook (Paddle handles sales tax worldwide)
- [x] Plans in code: `PLANS` in `extension/lib/client.js`, `plans` table and Pro-only sync in
      `supabase/migrations/004_plans.sql`, Pro screen in the phone app
- [x] Free: every feature on one device. No limit on notes, links, logins or backup codes
      (Bitwarden, Proton, Raindrop and Instapaper are all unlimited free). Limits only where
      competitors charge: 200 captured clips (clipboard extensions sell unlimited history),
      10 templates (Text Blaze free: ~20 snippets), trash kept 30 days
- [x] Pro: sync across computers, the Android app, and no limits (clips, templates, trash a year)
- [ ] Pro, within months of launch: authenticator (2FA) codes in the vault (Bitwarden, Proton charge
      for this), full-text archive of saved pages (Raindrop Pro), note version history. Sync alone
      is weak: Bitwarden, Proton and Raindrop all sync free
- [ ] Never paid, never limited: export, encryption, auto-lock, clipboard clearing, device count
- [ ] Price to start: $3/month or $24/year (Bitwarden $19.80/yr, Raindrop $28/yr); email the
      waitlist a launch discount
- [ ] Store listing says which features are paid (required)

**Check at the end of March:** 2% or more of weekly users paying, and fewer than 1 in 10
cancelling in the first month. Under that, ask cancellers why before changing the price.

## Phase 4: Niche test (March to April 2027, alongside Phase 3)

**Goal:** find out, cheaply, whether social media managers would pay more for a
"client workspace".

- [ ] Talk to 10 social media managers or small agencies (30 minutes each). Ask how they keep
      client logins, backup codes, briefs and reply templates today, and what goes wrong.
      Do not pitch.
- [ ] If at least 6 of 10 describe the same pain: build a clickable mock-up of a client space
      (logins and backup codes, notes, saved posts, templates, per client) and show it to them
- [ ] If at least 3 say they would pay (and say how much): build it as a Pro add-on
- [ ] If not: drop the niche, and keep improving the bundle for individuals

## Phase 5: Grow (May 2027 onward)

Only what the checks above justified:

- **Pro is working:** improve the phone app, store search ranking, a referral offer
  ("give a month, get a month")
- **The niche is working:** a "for social media managers" listing and site page, then sharing a
  client space with one teammate (the start of a team plan, priced per client space rather than
  per seat)
- **Neither:** keep DeskSync as a free, well-reviewed portfolio product, and spend the time on
  the next idea

## Not planned (and why)

- **A separate vault extension:** one listing is simpler, and the vault's code can be split
  later if review ever demands it
- **A team password manager for agencies:** crowded, cheap, and decided on trust
- **Analytics or tracking:** the privacy policy promises none, and the users this is for would
  notice
- **An in-page login icon on every site:** needs access to every site, the biggest red flag in
  review; later, opt-in, only if users ask for it
