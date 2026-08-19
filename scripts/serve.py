#!/usr/bin/env python3
"""Static server for local development.

`python -m http.server` guesses MIME types from the platform's registry, which
on some systems serves `.mjs` as text/plain — browsers then refuse to run the
modules. This registers the type explicitly and otherwise behaves the same."""
from __future__ import annotations
import argparse,mimetypes,sys
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument("--port",type=int,default=8000);p.add_argument("--directory",default=str(Path(__file__).resolve().parents[1]));args=p.parse_args()
    mimetypes.add_type("text/javascript",".mjs");mimetypes.add_type("text/javascript",".js")
    handler=partial(SimpleHTTPRequestHandler,directory=args.directory)
    with ThreadingHTTPServer(("127.0.0.1",args.port),handler) as server:
        print(f"Serving {args.directory} at http://127.0.0.1:{args.port}")
        try:server.serve_forever()
        except KeyboardInterrupt:return 0
    return 0

if __name__=="__main__":sys.exit(main())
