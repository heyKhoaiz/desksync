# Run `make` to list the commands.
export PATH := $(HOME)/development/flutter/bin:$(HOME)/development/android-sdk/platform-tools:$(PATH)

-include .env

.DEFAULT_GOAL := help
.PHONY: help env ext app apk devices test clean check-env

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
	@echo "Built. In chrome://extensions use Load unpacked (first time) or reload on: $(CURDIR)/dist/extension"

app: check-env ## Run the Android app on the connected phone
	cd mobile && flutter run --dart-define-from-file=../.env

apk: check-env ## Build a release APK
	cd mobile && flutter build apk --release --dart-define-from-file=../.env
	@echo "APK: $(CURDIR)/mobile/build/app/outputs/flutter-apk/app-release.apk"

devices: ## List connected phones
	adb devices

test: ## Run the app's static analysis and unit tests
	cd mobile && flutter analyze && flutter test

clean: ## Delete build output
	rm -rf dist
	cd mobile && flutter clean
