@echo off
cd /d "%~dp0"
echo Open http://localhost:8000 in your browser (Ctrl+C to stop)
python serve.py 8000
