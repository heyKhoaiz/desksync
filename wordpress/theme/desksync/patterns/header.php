<?php
/**
 * Title: Header
 * Slug: desksync/header
 * Inserter: no
 *
 * A pattern rather than plain HTML in parts/header.html, so the logo can use the theme's URL.
 */
?>
<!-- wp:html -->
<header class="top">
  <a class="brand" href="/"><img class="logo" src="<?php echo esc_url( desksync_img( 'wordmark.svg' ) ); ?>" width="113" height="26" alt="DeskSync"></a>
  <nav aria-label="Main">
    <a href="/#features">Features</a>
    <a href="/#privacy">Security</a>
    <a href="/#pro">Pricing</a>
    <a href="/#faq">Questions</a>
  </nav>
  <a class="btn btn-small install-link" href="/#pro">Add to Chrome</a>
</header>
<!-- /wp:html -->
