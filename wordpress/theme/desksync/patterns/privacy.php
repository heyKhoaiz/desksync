<?php
/**
 * Title: Privacy policy
 * Slug: desksync/privacy
 * Categories: desksync
 * Inserter: no
 *
 * Made from PRIVACY.md by tools/build_wp_theme.py. Edit PRIVACY.md, not this file.
 */
?>
<!-- wp:heading {"level": 1, "anchor": "desksync-privacy-policy"} -->
<h1 class="wp-block-heading" id="desksync-privacy-policy">DeskSync privacy policy</h1>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Last updated: 20 November 2026</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>DeskSync is a browser extension (and an optional Android app) for notes, read-later links, clipboard history and an encrypted password vault. This page says what it stores, where, and who can see it.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "without-an-account"} -->
<h2 class="wp-block-heading" id="without-an-account">Without an account</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Everything stays in your browser, in the extension's own storage (<code>chrome.storage.local</code>). Nothing is sent anywhere. Uninstalling the extension, or clearing its data, deletes it; use Settings → Export to keep a copy.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "with-an-account-optional"} -->
<h2 class="wp-block-heading" id="with-an-account-optional">With an account (optional)</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>If you sign in, your notes, read-later links, clips and vault items are copied to a database run on Supabase, so they can sync to your other browsers and your phone. Each row is tied to your account and protected by row-level security: only you can read or change your rows.</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li><strong>Notes, links and clips</strong> are stored as you wrote or copied them. They are not end-to-end encrypted: they are protected by your account, not by a key only you hold.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Vault items</strong> (logins and passwords) are encrypted in your browser before they are saved, with a key derived from your master password (PBKDF2, 600,000 iterations, then AES-GCM). The master password and the key never leave your device. Nobody else, including whoever runs the database, can read your vault, and a forgotten master password cannot be recovered.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Your email address</strong> is used to sign you in.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Signing out keeps your data on the device. "Sign out and erase this device" removes it from the browser; your account keeps its copy.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "backup-codes-and-copied-passwords"} -->
<h2 class="wp-block-heading" id="backup-codes-and-copied-passwords">Backup codes and copied passwords</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Backup codes you paste into a login are stored with it, encrypted with your master password like the rest of the vault. Copying a code marks it used; nothing is sent anywhere.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>A copied password, backup code or key is taken off your clipboard 30 seconds later, unless you have copied something else since. To check that, DeskSync keeps a one-way hash of what it copied, never the text itself, and forgets it once the 30 seconds are up. You can turn this off in Settings.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "filling-logins-and-importing-passwords"} -->
<h2 class="wp-block-heading" id="filling-logins-and-importing-passwords">Filling logins and importing passwords</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Filling a login (Alt+Shift+L, or Fill in DeskSync) gives DeskSync access to the page in front only, at that moment, to type into its sign-in form. When a site has several saved logins, the page is shown their names and usernames to choose from; no password reaches the page until you choose. Other pages are never read.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Importing passwords reads the CSV file you choose inside your browser and encrypts each login there. The file is not uploaded anywhere. Delete it afterwards: password exports are not encrypted.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "clipboard"} -->
<h2 class="wp-block-heading" id="clipboard">Clipboard</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Clipboard history is <strong>off</strong> by default. When you turn it on, DeskSync records what you copy only on sites you approve one at a time, and never from password fields. Text that looks like an API key, token or private key is left out unless you turn that protection off. For each clip only the site's hostname is kept, not the full address, because full addresses can carry secrets such as reset tokens.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>"Save the clipboard" reads the clipboard once, when you ask.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "other-permissions-and-what-they-are-used-for"} -->
<h2 class="wp-block-heading" id="other-permissions-and-what-they-are-used-for">Other permissions, and what they are used for</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li><strong>Tabs and active tab</strong>: to save the page you are on, show its title and address, fill a login when you press Alt+Shift+L or Fill, and type a note or clip into a text box on it when you ask ("Insert").</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Site access (optional, per site)</strong>: clipboard capture on approved sites, filling a saved login on the site it belongs to, and inserting text from the side panel.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Side panel</strong>: to show DeskSync beside the page.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Favicon</strong>: to show a saved link's site icon from Chrome's own cache. Nothing is fetched from the site.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Context menus, keyboard shortcuts, address bar keyword ("ds")</strong>: ways to save and search.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Alarms</strong>: syncing in the background, locking the vault after a period of inactivity, and clearing a copied password after 30 seconds.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Offscreen document</strong>: the background part of an extension has no clipboard, so a hidden page clears a copied password, only if the clipboard still holds what DeskSync copied.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading {"anchor": "the-websites-waitlist"} -->
<h2 class="wp-block-heading" id="the-websites-waitlist">The website's waitlist</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>If you join the waitlist on DeskSync's website, your email address is stored to tell you when sync (DeskSync Pro) is available, and for nothing else. It is not shared, and it can be read only by DeskSync's owner. To be removed, write to the address below.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "what-desksync-does-not-do"} -->
<h2 class="wp-block-heading" id="what-desksync-does-not-do">What DeskSync does not do</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>No analytics, tracking, advertising or telemetry.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>No selling or sharing of your data with anyone.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>No reading of pages, history or forms beyond the actions above, each started by you.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading {"anchor": "deleting-your-data"} -->
<h2 class="wp-block-heading" id="deleting-your-data">Deleting your data</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Without an account: uninstall the extension, or use "Sign out and erase this device". With an account: delete your items in the app (they are removed from the trash after 30 days, or a year with Pro, or at once with "Delete forever"), or contact us to have the account and all its rows deleted.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"anchor": "contact"} -->
<h2 class="wp-block-heading" id="contact">Contact</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Questions, or a request to delete your account or waitlist entry: <?php $e = desksync_opt( 'support_email' ); if ( $e ) { printf( '<a href="mailto:%1$s">%1$s</a>', esc_html( $e ) ); } else { echo 'the contact address on this site'; } ?></p>
<!-- /wp:paragraph -->
