<?php
/**
 * Title: Questions
 * Slug: desksync/faq
 * Categories: desksync
 */
$desksync_qa = array(
	array( 'Is DeskSync free?', 'Yes. Every feature is free on one computer, with no limit on notes, saved pages or logins. Free keeps the newest 200 captured clips (clips you save by hand or pin are always kept), 10 templates, and deleted items for 30 days.' ),
	array( 'What does Pro add?', 'Sync across every computer you use, every clip kept, any number of templates, and a year in the trash. Pro is $3 a month or $24 a year, and opens soon. Join the waitlist above to hear when it does.' ),
	array( 'Do I need an account?', 'No. DeskSync works the moment it is installed, with everything saved in your browser. An account is only for sync, which comes with Pro.' ),
	array( 'Which browsers does it work in?', 'Chrome, and browsers built on the same engine that install extensions from the Chrome Web Store, such as Edge and Brave.' ),
	array( 'Can DeskSync read my passwords?', 'No. Your vault is encrypted in your browser with a key made from your master password, which never leaves your device. That also means a forgotten master password cannot be recovered, so keep it somewhere safe.' ),
	array( 'What happens if I uninstall it?', 'On Free, uninstalling deletes the data in your browser. Use Settings, then Export, to keep a copy first. With Pro, your account keeps its copy.' ),
	array( 'Can I bring my passwords from another manager?', 'Yes. Export a CSV from Chrome, Edge, Firefox or another password manager and import it in Settings, then Vault. Logins you already have are skipped. Delete the CSV afterwards.' ),
);
?>
<!-- wp:group {"tagName":"section","anchor":"faq","className":"section faq","layout":{"type":"default"}} -->
<section class="wp-block-group section faq" id="faq"><!-- wp:heading {"className":"section-title"} -->
<h2 class="wp-block-heading section-title">Questions</h2>
<!-- /wp:heading -->

<!-- wp:group {"className":"faq-list","layout":{"type":"default"}} -->
<div class="wp-block-group faq-list"><?php foreach ( $desksync_qa as $desksync_item ) : ?><!-- wp:details -->
<details class="wp-block-details"><summary><?php echo esc_html( $desksync_item[0] ); ?></summary><!-- wp:paragraph -->
<p><?php echo esc_html( $desksync_item[1] ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<?php endforeach; ?></div>
<!-- /wp:group --></section>
<!-- /wp:group -->
