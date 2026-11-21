<?php
/**
 * Title: Footer
 * Slug: desksync/footer
 * Inserter: no
 */
$desksync_email = desksync_opt( 'support_email' );
?>
<!-- wp:html -->
<footer class="foot">
  <div class="foot-brand">
    <a class="brand" href="/"><img class="logo" src="<?php echo esc_url( desksync_img( 'wordmark.svg' ) ); ?>" width="113" height="26" alt="DeskSync"></a>
    <p>Notes, saved pages, copied text and logins in one private place inside your browser.</p>
  </div>
  <nav aria-label="Product">
    <h2>Product</h2>
    <a href="/#features">Features</a>
    <a href="/#shortcuts">Shortcuts</a>
    <a href="/#pro">Free and Pro</a>
    <a href="/#faq">Questions</a>
  </nav>
  <nav aria-label="Trust">
    <h2>Trust</h2>
    <a href="/#privacy">Security</a>
    <a href="/privacy/">Privacy policy</a>
  </nav>
<?php if ( $desksync_email ) : ?>
  <div>
    <h2>Contact</h2>
    <a href="mailto:<?php echo esc_attr( $desksync_email ); ?>"><?php echo esc_html( $desksync_email ); ?></a>
  </div>
<?php endif; ?>
  <p class="foot-note">© <?php echo esc_html( gmdate( 'Y' ) ); ?> DeskSync. Chrome is a trademark of Google LLC.</p>
</footer>
<!-- /wp:html -->
