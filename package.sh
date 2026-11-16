#!/usr/bin/env sh
# Packages the extension into dist/bookmark-control-panel-<version>.zip,
# ready to upload to addons.mozilla.org (signing) or to install as a signed .xpi.
set -eu

cd "$(dirname "$0")"
VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
OUT="dist/bookmark-control-panel-${VERSION}.zip"

mkdir -p dist
python3 - "$OUT" <<'PY'
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo

files = [Path(name) for name in (
    'manifest.json', 'background.js', 'dashboard.html', 'dashboard.css',
    'dashboard.js', 'theme-init.js', 'i18n.js',
)]
files += [p for directory in ('_locales', 'icons') for p in Path(directory).rglob('*') if p.is_file()]
with ZipFile(sys.argv[1], 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(files):
        info = ZipInfo(path.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
PY

echo "Package created: $OUT"
