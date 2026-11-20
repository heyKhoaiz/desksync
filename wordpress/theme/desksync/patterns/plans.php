<?php
/**
 * Title: Free and Pro
 * Slug: desksync/plans
 * Categories: desksync
 * Description: The two plans, what each includes, and the Pro waitlist.
 *
 * The numbers match PLANS in extension/lib/client.js and "Free and Pro" in the README.
 */
?>
<!-- wp:group {"tagName":"section","anchor":"pro","className":"section pro","layout":{"type":"default"}} -->
<section class="wp-block-group section pro" id="pro"><!-- wp:heading {"className":"section-title"} -->
<h2 class="wp-block-heading section-title">Free on one computer. <em>Pro everywhere you are.</em></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"section-lead"} -->
<p class="section-lead">Free has every feature, on the computer it is installed on. Pro syncs it across every computer you use and lifts three limits.</p>
<!-- /wp:paragraph -->

<!-- wp:group {"className":"plans","layout":{"type":"default"}} -->
<div class="wp-block-group plans"><!-- wp:group {"className":"plan","layout":{"type":"default"}} -->
<div class="wp-block-group plan"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Free</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"price"} -->
<p class="price">$0<span> forever</span></p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Every feature, on one computer</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Notes, read later, clipboard history</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Vault, backup codes, login fill</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Side panel, search, tags</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>No limit on notes, links or logins</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Newest 200 clips, 10 templates, trash kept 30 days</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list --></div>
<!-- /wp:group -->

<!-- wp:group {"className":"plan plan-pro","layout":{"type":"default"}} -->
<div class="wp-block-group plan plan-pro"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Pro <span class="tag">coming soon</span></h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"price"} -->
<p class="price">$3<span>/month, or $24 a year</span></p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Everything in Free</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Sync across every computer you use</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Every clip kept, any number of templates</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Trash kept a year</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->

<!-- wp:table {"hasFixedLayout":false,"className":"compare"} -->
<figure class="wp-block-table compare"><table><thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody><tr><td>Notes, links, logins, backup codes</td><td>No limit</td><td>No limit</td></tr><tr><td>Captured clips kept</td><td>Newest 200 (saved by hand and pinned: all)</td><td>All</td></tr><tr><td>Templates</td><td>10</td><td>No limit</td></tr><tr><td>Trash kept for</td><td>30 days</td><td>A year</td></tr><tr><td>Sync across computers</td><td>—</td><td>Yes</td></tr></tbody></table></figure>
<!-- /wp:table -->

<!-- wp:paragraph {"className":"small never"} -->
<p class="small never">Never limited, on either plan: export, encryption, auto-lock, and clearing copied passwords. Your data is always yours to take out.</p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<form class="waitlist" id="waitlist" novalidate>
  <label for="email">Want sync? Join the waitlist and hear first when Pro opens.</label>
  <div class="row">
    <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
    <button class="btn" type="submit">Join</button>
  </div>
  <p class="msg" id="msg" role="status" aria-live="polite"></p>
  <p class="small">Your email is used for this and nothing else. <a href="/privacy/#the-websites-waitlist">More</a></p>
</form>
<!-- /wp:html --></section>
<!-- /wp:group -->
