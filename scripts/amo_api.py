#!/usr/bin/env python3
"""Small AMO API client. Credentials stay in the environment or ignored .env."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://addons.mozilla.org/api/v5/'


def credentials():
    values = dict(os.environ)
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key in ('WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'):
                values.setdefault(key, value.strip().strip('\"\''))
    return values['WEB_EXT_API_KEY'], values['WEB_EXT_API_SECRET']


def token():
    issuer, secret = credentials()
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=')
    now = int(time.time())
    payload = {'iss': issuer, 'jti': secrets.token_hex(16), 'iat': now, 'exp': now + 60}
    unsigned = encode(b'{"alg":"HS256","typ":"JWT"}') + b'.' + encode(json.dumps(payload).encode())
    return (unsigned + b'.' + encode(hmac.new(secret.encode(), unsigned, hashlib.sha256).digest())).decode()


class RateLimited(RuntimeError):
    def __init__(self, delay):
        self.retry_after = int(float(delay))
        self.retry_at = time.time() + self.retry_after
        super().__init__(f'AMO rate limited this action for {self.retry_after} seconds.')


def request(endpoint, method='GET', data=None, files=None):
    headers = {'Authorization': 'JWT ' + token(), 'Accept': 'application/json'}
    body = None
    if files:
        boundary = 'amo-' + secrets.token_hex(12)
        chunks = []
        for name, value in (data or {}).items():
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for name, path in files.items():
            path = Path(path)
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
            chunks.extend([path.read_bytes(), b'\r\n'])
        chunks.append(f'--{boundary}--\r\n'.encode())
        body = b''.join(chunks)
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    elif data is not None:
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + endpoint, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response) if response.status != 204 else None
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise RateLimited(error.headers.get('Retry-After', '60')) from None
        raise RuntimeError(f'AMO {error.code}: {error.read().decode()}') from None


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('endpoint')
    parser.add_argument('--method', default='GET')
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    print(json.dumps(request(args.endpoint, args.method, json.loads(args.json.read_text()) if args.json else None), indent=2))
