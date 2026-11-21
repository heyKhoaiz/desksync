# Run `make` to list the commands.
export PATH := $(HOME)/development/flutter/bin:$(HOME)/development/android-sdk/platform-tools:$(PATH)

-include .env

.DEFAULT_GOAL := help
.PHONY: help env ext zip site publish-site wp-theme wp-up wp-install wp-down wp-reset store-check admin icons app apk devices test test-ext clean check-env

help: ## Show this list
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'

env: ## Create .env from the example, then fill in your Supabase values
	@if [ -f .env ]; then echo ".env already exists"; else cp .env.example .env; echo "Created .env. Add your Supabase URL and anon key."; fi

check-env:
	@if [ ! -f .env ]; then echo "No .env yet. Run: make env"; exit 1; fi
	@if [ -z "$(SUPABASE_URL)" ] || [ -z "$(SUPABASE_ANON_KEY)" ] || echo "$(SUPABASE_URL)$(SUPABASE_ANON_KEY)" | grep -q YOUR-; then \
		echo "Fill in SUPABASE_URL and SUPABASE_ANON_KEY in .env first."; exit 1; fi

ext: check-env ## Build the extension into dist/extension, ready for Load unpacked
	@rm -rf dist/extension && mkdir -p dist && cp -r extension dist/extension
	@sed -i 's|https://YOUR-PROJECT.supabase.co|$(SUPABASE_URL)|; s|YOUR-ANON-KEY|$(SUPABASE_ANON_KEY)|' dist/extension/config.js
	@if [ -n "$(SUPPORT_EMAIL)" ]; then sed -i 's|YOUR-SUPPORT-EMAIL|$(SUPPORT_EMAIL)|' dist/extension/config.js; fi
	@if [ -n "$(PRIVACY_URL)" ]; then sed -i 's|YOUR-PRIVACY-URL|$(PRIVACY_URL)|' dist/extension/config.js; fi
	@if [ -n "$(PRO_URL)" ]; then sed -i 's|YOUR-PRO-URL|$(PRO_URL)|' dist/extension/config.js; fi
	@echo "Built. In chrome://extensions use Load unpacked (first time) or reload on: $(CURDIR)/dist/extension"

zip: ext ## Package the built extension as dist/desksync-extension.zip
	@rm -f dist/desksync-extension.zip
	@cd dist/extension && zip -qr ../desksync-extension.zip .
	@echo "Zip: $(CURDIR)/dist/desksync-extension.zip"

site: ## Build the website (landing page, privacy policy, waitlist) into dist/site
	@SUPABASE_URL="$(SUPABASE_URL)" SUPABASE_ANON_KEY="$(SUPABASE_ANON_KEY)" SUPPORT_EMAIL="$(SUPPORT_EMAIL)" STORE_URL="$(STORE_URL)" SITE_DOMAIN="$(SITE_DOMAIN)" python3 tools/build_site.py

publish-site: site ## Publish dist/site to the VPS, where desksync.org is served (deploy/vps/)
	@./tools/publish_site.sh

wp-theme: ## Ready the WordPress theme for desksync.org and zip it (dist/desksync-theme.zip)
	@python3 tools/build_wp_theme.py

wp-up: wp-theme ## Run the WordPress site locally on http://localhost:8120
	@docker compose -f wordpress/docker-compose.yml up -d

wp-install: ## First run of the local WordPress site: install, theme, pages, settings from .env
	@SUPABASE_URL="$(SUPABASE_URL)" SUPABASE_ANON_KEY="$(SUPABASE_ANON_KEY)" STORE_URL="$(STORE_URL)" SUPPORT_EMAIL="$(SUPPORT_EMAIL)" bash wordpress/bin/install-local.sh

wp-down: ## Stop the local WordPress site, keep its data
	@docker compose -f wordpress/docker-compose.yml stop

wp-reset: ## Stop the local WordPress site and wipe its database
	@docker compose -f wordpress/docker-compose.yml down -v

store-check: ext ## Check the build against the Chrome Web Store's rules before uploading
	@node tools/store-check.mjs dist/extension

admin: check-env ## Open the admin page on this computer: accounts, and giving Pro by hand
	@python3 tools/admin.py

icons: ## Regenerate the extension and Android app icons from tools/make_icons.py
	@python3 tools/make_icons.py extension/icons mobile/android/app/src/main/res

app: check-env ## Run the Android app on the connected phone
	cd mobile && flutter run --dart-define-from-file=../.env

apk: check-env ## Build a release APK
	cd mobile && flutter build apk --release --dart-define-from-file=../.env
	@echo "APK: $(CURDIR)/mobile/build/app/outputs/flutter-apk/app-release.apk"

devices: ## List connected phones
	adb devices

test: test-ext test-ui ## Run the extension tests, then the app's analysis and unit tests
	cd mobile && flutter analyze && flutter test

test-ext: ## Run the extension's offline-sync, plain-text, secret-detection, task-list and autofill tests
	@node tests/offline.test.js
	@node tests/plaintext.test.js
	@node tests/detect.test.js
	@node tests/tasks.test.js
	@node tests/format.test.js
	@node tests/tags.test.js
	@node tests/codes.test.js
	@node tests/vaultkeys.test.js
	@node tests/sites.test.js
	@./tests/fillform.test.sh

test-ui: ## Run the popup UI tests in headless Chrome
	@./tests/ui.sh

clean: ## Delete build output
	rm -rf dist
	cd mobile && flutter clean
