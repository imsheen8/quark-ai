#!/usr/bin/env sh
cd "$(dirname "$0")"
echo "Open http://localhost:8000 in your browser (Ctrl+C to stop)"
python3 serve.py 8000
