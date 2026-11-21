<?php
/**
 * Sets up desksync.org's content: the Home and Privacy pages, the static front
 * page, permalinks. Safe to run again: an existing page is left as edited.
 *
 *   wp eval-file wp-content/desksync-bin/seed.php
 */

defined( 'ABSPATH' ) || exit;

function desksync_seed_page( string $slug, string $title, string $content ): int {
	$page = get_page_by_path( $slug );
	if ( $page ) {
		WP_CLI::log( "Page /$slug/ already exists (#{$page->ID}), left as it is." );
		return $page->ID;
	}
	$id = wp_insert_post( array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_name'    => $slug,
		'post_title'   => $title,
		'post_content' => $content,
	), true );
	if ( is_wp_error( $id ) ) {
		WP_CLI::error( $id->get_error_message() );
	}
	WP_CLI::log( "Created /$slug/ (#$id)." );
	return $id;
}

// The pages hold a reference to the theme's pattern: the site shows the theme's
// current text until someone edits the page in wp-admin, which copies it in.
$home    = desksync_seed_page( 'home', 'DeskSync', '<!-- wp:pattern {"slug":"desksync/home"} /-->' );
$privacy = desksync_seed_page( 'privacy', 'Privacy policy', '<!-- wp:pattern {"slug":"desksync/privacy"} /-->' );

update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', $home );
update_option( 'wp_page_for_privacy_policy', $privacy );
update_option( 'blogname', 'DeskSync' );
update_option( 'blogdescription', 'Notes, saved pages, copied text and logins in one private place' );
update_option( 'default_comment_status', 'closed' );
update_option( 'default_ping_status', 'closed' );
update_option( 'permalink_structure', '/%postname%/' );
flush_rewrite_rules();

// WordPress's sample content has no place here.
foreach ( array( 'hello-world' => 'post', 'sample-page' => 'page' ) as $slug => $type ) {
	$p = get_page_by_path( $slug, OBJECT, $type );
	if ( $p ) {
		wp_delete_post( $p->ID, true );
	}
}

WP_CLI::success( 'DeskSync content is in place.' );
