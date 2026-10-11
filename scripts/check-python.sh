#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python_executable=${LYRICBRIDGE_PYTHON:-.venv/bin/python}
"$python_executable" -m ruff check scripts tests
"$python_executable" -m mypy
