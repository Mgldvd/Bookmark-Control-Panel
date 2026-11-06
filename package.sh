#!/usr/bin/env sh
# Empaqueta la extensión en dist/bookmark-dashboard-<versión>.zip,
# listo para subir a addons.mozilla.org (firma) o instalar como .xpi firmado.
set -eu

cd "$(dirname "$0")"
VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
OUT="dist/bookmark-dashboard-${VERSION}.zip"

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

echo "Paquete creado: $OUT"
