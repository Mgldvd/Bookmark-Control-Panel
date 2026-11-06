#!/usr/bin/env sh
# Firma la extensión en addons.mozilla.org por el canal «unlisted» (privado: no se
# publica en la tienda) y deja el .xpi firmado en dist/. Ese .xpi se instala de
# forma permanente en Firefox normal: about:addons → ⚙️ → «Instalar desde archivo».
#
# Requiere credenciales de API de AMO (https://addons.mozilla.org/developers/addon/api/key/):
#   export WEB_EXT_API_KEY='user:12345:678'   # «Emisor JWT»
#   export WEB_EXT_API_SECRET='…'             # «Secreto JWT» (no lo guardes en el repositorio)
#   ./sign.sh
#
# Usa la herramienta oficial web-ext de Mozilla vía npx (solo para firmar; no forma
# parte de la extensión). Cada firma necesita un "version" nuevo en manifest.json.
set -eu

cd "$(dirname "$0")"

: "${WEB_EXT_API_KEY:?Falta WEB_EXT_API_KEY (Emisor JWT de AMO)}"
: "${WEB_EXT_API_SECRET:?Falta WEB_EXT_API_SECRET (Secreto JWT de AMO)}"

VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
ZIP="dist/bookmark-dashboard-${VERSION}.zip"

# Se firma exactamente el contenido del paquete (sin README, scripts ni .git).
./package.sh
BUILD=$(mktemp -d)
ARTIFACTS=$(mktemp -d)
trap 'rm -rf "$BUILD" "$ARTIFACTS"' EXIT INT TERM
unzip -q "$ZIP" -d "$BUILD"

echo "Firmando la versión ${VERSION} en AMO (canal unlisted)…"
npx --yes web-ext@10.8.0 sign \
  --channel=unlisted \
  --source-dir="$BUILD" \
  --artifacts-dir="$ARTIFACTS"

# web-ext usa un nombre interno; se renombra a uno legible.
SIGNED=$(ls -1t "$ARTIFACTS"/*.xpi | head -n 1)
OUT="dist/bookmark-dashboard-${VERSION}-signed.xpi"
mv "$SIGNED" "$OUT"
echo "Listo. .xpi firmado: $OUT"
