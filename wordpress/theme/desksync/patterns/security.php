<?php
/**
 * Title: Security and privacy
 * Slug: desksync/security
 * Categories: desksync
 * Description: The facts in PRIVACY.md, in short.
 */
?>
<!-- wp:group {"tagName":"section","anchor":"privacy","className":"section security","layout":{"type":"default"}} -->
<section class="wp-block-group section security" id="privacy"><!-- wp:group {"className":"security-head","layout":{"type":"default"}} -->
<div class="wp-block-group security-head"><!-- wp:heading {"className":"section-title"} -->
<h2 class="wp-block-heading section-title">Your passwords are readable by you, and only you</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"section-lead"} -->
<p class="section-lead">DeskSync saves everything in your browser first. Logins are encrypted before they are stored anywhere, with a key that never leaves your device.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="/privacy/">Read the full privacy policy</a></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:list {"className":"points"} -->
<ul class="wp-block-list points"><!-- wp:list-item -->
<li><strong>Encrypted on your device.</strong> Logins and backup codes are locked with your master password: PBKDF2 with 600,000 iterations, then AES-GCM. Nobody else can read them, including whoever runs the server.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Locks itself.</strong> The vault locks after a period of inactivity, and a copied password or backup code is cleared from the clipboard after 30 seconds.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Clipboard history is opt-in.</strong> It is off until you turn it on, then records only on sites you approve one at a time. Password fields and API keys are left out.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Pages see nothing early.</strong> When you fill a login, the page sees account names only, never a password, until you pick one.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Local first.</strong> On Free, nothing leaves your browser. With Pro, your data syncs to your account, protected so only you can read or change it.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>No analytics, no tracking, no ads.</strong> Not on the extension, not on this site, on either plan.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list --></section>
<!-- /wp:group -->
