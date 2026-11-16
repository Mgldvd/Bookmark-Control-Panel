#!/usr/bin/env python3
"""Serve only the extension UI and synthetic fixture. Never expose .env or .git."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {'dashboard.js', 'dashboard.css', 'theme-init.js', 'i18n.js', 'icons/icon.svg', 'store/demo-data.js'}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = urlsplit(self.path).path.lstrip('/')
        if name in ('', 'demo'):
            body = (ROOT / 'dashboard.html').read_text().replace('<script src="theme-init.js">', '<script src="store/demo-data.js"></script><script src="theme-init.js">').encode()
            mime = 'text/html'
        elif name in ALLOWED:
            body = (ROOT / name).read_bytes()
            mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
