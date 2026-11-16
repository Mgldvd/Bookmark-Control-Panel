#!/usr/bin/env sh
# Packages the extension into dist/bookmark-control-panel-<version>.zip,
# ready to upload to addons.mozilla.org (signing) or to install as a signed .xpi.
set -eu

cd "$(dirname "$0")"
VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
OUT="dist/bookmark-control-panel-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
zip -r -X -q "$OUT" \
  manifest.json \
  background.js \
  dashboard.html \
  dashboard.css \
  dashboard.js \
  theme-init.js \
  i18n.js \
  _locales \
  icons

echo "Package created: $OUT"
