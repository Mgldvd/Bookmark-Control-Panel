#!/usr/bin/env python3
"""Prepare the existing AMO listing, then explicitly submit the validated listed upload."""
import argparse
import hashlib
import json
from pathlib import Path
from amo_api import request, RateLimited
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / 'store'
ENDPOINT = 'addons/addon/3119659/'
REPORT = STORE / 'publication-result.json'


def read(name):
    return json.loads((STORE / name).read_text())


def save(result):
    REPORT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')


def prepare(images_only=False):
    result = read('publication-result.json') if REPORT.exists() else {'addon_id': 3119659, 'previews': {}}
    if not result.get('metadata_prepared'):
        addon = request(ENDPOINT, 'PATCH', read('listing.json'))
        result.update(url=addon['url'], slug=addon['slug'])
        save(result)
        request(ENDPOINT + 'eula_policy/', 'PATCH', read('privacy.json'))
        request(ENDPOINT, 'PATCH', files={'icon': STORE / 'media/icon-128.png'})
        result['metadata_prepared'] = True
        save(result)
        print('Bilingual metadata, privacy policy and icon saved.', flush=True)
    for preview in read('previews.json'):
        name = preview['file']
        if name in result.get('finished_previews', []):
            continue
        preview_id = result['previews'].get(name)
        if not preview_id:
            response = request(ENDPOINT + 'previews/', 'POST', {'position': preview['position']}, {'image': STORE / name})
            preview_id = response['id']
            result['previews'][name] = preview_id
            save(result)
        if not images_only:
            request(ENDPOINT + f'previews/{preview_id}/', 'PATCH', {k: preview[k] for k in ('caption', 'position')})
        result.setdefault('finished_previews', []).append(name)
        save(result)
        print('Uploaded ' + name, flush=True)
    return result


def submit():
    versions = request(ENDPOINT + 'versions/?filter=all_with_unlisted')
    for version in versions.get('results', []):
        if version.get('version') == '1.16.1' and version.get('channel') == 'listed':
            result = read('publication-result.json')
            result['version'] = version
            save(result)
            print('Listed version already submitted; not submitting again.', flush=True)
            return
    upload = read('upload-result.json')
    checked = request('addons/upload/' + upload['uuid'] + '/')
    if not checked['processed'] or not checked['valid'] or checked['channel'] != 'listed':
        raise RuntimeError('The listed upload has not passed validation.')
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    if checked['version'] != manifest['version']:
        raise RuntimeError('The validated version differs from the manifest.')
    version = request(ENDPOINT + 'versions/', 'POST', {
        'upload': upload['uuid'],
        'license': 'all-rights-reserved',
        'approval_notes': (STORE / 'reviewer-notes.txt').read_text(),
        'release_notes': read('release-notes.json'),
        'compatibility': ['firefox'],
    })
    result = read('publication-result.json')
    result['version'] = version
    result['package_sha256'] = hashlib.sha256((ROOT / f'dist/bookmark-control-panel-{manifest["version"]}.zip').read_bytes()).hexdigest()
    save(result)
    print(json.dumps(version, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'prepare-images', 'submit', 'continue', 'status'])
    args = parser.parse_args()
    try:
        if args.action in ('prepare', 'prepare-images'):
            prepare(images_only=args.action == 'prepare-images')
        elif args.action == 'submit':
            submit()
        elif args.action == 'continue':
            # Submit first: rate limits must not leave a complete listing unpublished.
            submit()
            prepare(images_only=True)
            print('All screenshot images uploaded; optional translated captions remain in previews.json.')
        else:
            addon = request(ENDPOINT)
            print(json.dumps({k: addon.get(k) for k in ['id', 'slug', 'status', 'url', 'current_version', 'latest_unlisted_version', 'previews']}, indent=2))
    except RateLimited as error:
        retry_at = datetime.fromtimestamp(error.retry_at, timezone.utc).isoformat()
        result = read('publication-result.json') if REPORT.exists() else {}
        result['retry_at'] = retry_at
        result['retry_after_seconds'] = error.retry_after
        save(result)
        print(json.dumps({'rate_limited': True, 'retry_at': retry_at, 'retry_after_seconds': error.retry_after}), flush=True)
        raise SystemExit(75)
