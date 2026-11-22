#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv || exit 1
fi
source backend/.venv/bin/activate || exit 1
python -c 'import flask, flask_cors, certifi' >/dev/null 2>&1 || python -m pip install -r requirements.txt || exit 1
printf '\nHer Shield 5 is starting at http://127.0.0.1:5001/\n'
printf 'Type the address manually in Safari. Keep this window open.\n\n'
python backend/app.py
