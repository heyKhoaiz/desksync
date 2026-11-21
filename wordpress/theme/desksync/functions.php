<?php
/**
 * DeskSync theme: assets, the site settings (Supabase, store link, contact),
 * and the redirect for the old static privacy.html address.
 */

defined( 'ABSPATH' ) || exit;

const DESKSYNC_OPTION = 'desksync_settings';

/** One site setting: supabase_url, supabase_anon_key, store_url or support_email. */
function desksync_opt( string $key ): string {
	$all = get_option( DESKSYNC_OPTION, array() );
	return is_array( $all ) && isset( $all[ $key ] ) ? trim( (string) $all[ $key ] ) : '';
}

function desksync_img( string $file ): string {
	return get_theme_file_uri( 'assets/img/' . $file );
}

add_action( 'after_setup_theme', function () {
	add_theme_support( 'editor-styles' );
	add_editor_style( 'assets/site.css' );
} );

add_action( 'wp_enqueue_scripts', function () {
	$ver = wp_get_theme()->get( 'Version' );
	wp_enqueue_style( 'desksync', get_theme_file_uri( 'assets/site.css' ), array(), $ver );

	// Every page: the header's install link is on all of them.
	wp_enqueue_script( 'desksync', get_theme_file_uri( 'assets/site.js' ), array(), $ver, array( 'strategy' => 'defer' ) );
	// The public anon key: it can add a waitlist row and nothing else.
	wp_add_inline_script( 'desksync', 'window.DESKSYNC_SITE = ' . wp_json_encode( array(
		'url'   => desksync_opt( 'supabase_url' ),
		'key'   => desksync_opt( 'supabase_anon_key' ),
		'store' => desksync_opt( 'store_url' ),
	) ) . ';', 'before' );
} );

// A static site needs none of these.
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
remove_action( 'wp_head', 'wp_generator' );
remove_action( 'wp_head', 'rsd_link' );
remove_action( 'wp_head', 'wlwmanifest_link' );

add_action( 'wp_head', function () {
	if ( ! has_site_icon() ) {
		printf( '<link rel="icon" href="%s">' . "\n", esc_url( desksync_img( 'icon128.png' ) ) );
	}
	if ( is_front_page() ) {
		echo '<meta name="description" content="' . esc_attr__( 'A Chrome extension that keeps the things you need while browsing (notes, saved pages, copied text and logins) in one private, searchable place. Free on one computer; Pro adds sync across your computers.', 'desksync' ) . '">' . "\n";
	}
} );

add_filter( 'document_title_parts', function ( $parts ) {
	if ( is_front_page() ) {
		$parts = array( 'title' => __( 'DeskSync: notes, saved pages, copied text and logins in one private place', 'desksync' ) );
	}
	return $parts;
} );

// The extension, the store listing and old links point at /privacy.html.
add_action( 'template_redirect', function () {
	if ( is_404() && '/privacy.html' === wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) {
		wp_safe_redirect( home_url( '/privacy/' ), 301 );
		exit;
	}
} );

add_action( 'init', function () {
	register_block_pattern_category( 'desksync', array( 'label' => __( 'DeskSync', 'desksync' ) ) );
} );

/* Settings → DeskSync */

const DESKSYNC_FIELDS = array(
	'supabase_url'      => array( 'Supabase URL', 'url', 'For the waitlist form. Supabase → Project Settings → API.' ),
	'supabase_anon_key' => array( 'Supabase anon key', 'text', 'The public key. It can add a waitlist row and nothing else.' ),
	'store_url'         => array( 'Chrome Web Store URL', 'url', 'Empty: the install button says "Coming soon".' ),
	'support_email'     => array( 'Contact email', 'email', 'Shown in the footer and the privacy policy.' ),
);

add_action( 'admin_init', function () {
	register_setting( 'desksync', DESKSYNC_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => function ( $in ) {
			$out = array();
			foreach ( DESKSYNC_FIELDS as $key => $f ) {
				$v           = isset( $in[ $key ] ) ? trim( (string) $in[ $key ] ) : '';
				$out[ $key ] = match ( $f[1] ) {
					'url'   => esc_url_raw( $v ),
					'email' => sanitize_email( $v ),
					default => sanitize_text_field( $v ),
				};
			}
			return $out;
		},
	) );
	add_settings_section( 'desksync_main', '', '__return_false', 'desksync' );
	foreach ( DESKSYNC_FIELDS as $key => $f ) {
		add_settings_field( $key, esc_html( $f[0] ), function () use ( $key, $f ) {
			printf(
				'<input type="%1$s" class="regular-text" name="%2$s[%3$s]" value="%4$s"><p class="description">%5$s</p>',
				'email' === $f[1] ? 'email' : ( 'url' === $f[1] ? 'url' : 'text' ),
				esc_attr( DESKSYNC_OPTION ),
				esc_attr( $key ),
				esc_attr( desksync_opt( $key ) ),
				esc_html( $f[2] )
			);
		}, 'desksync', 'desksync_main', array( 'label_for' => $key ) );
	}
} );

add_action( 'admin_menu', function () {
	add_options_page( 'DeskSync', 'DeskSync', 'manage_options', 'desksync', function () {
		echo '<div class="wrap"><h1>DeskSync</h1><form method="post" action="options.php">';
		settings_fields( 'desksync' );
		do_settings_sections( 'desksync' );
		submit_button();
		echo '</form></div>';
	} );
} );
