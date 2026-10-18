#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
python_executable=${LYRICBRIDGE_PYTHON:-.venv/bin/python}
"$python_executable" -c 'import sys; sys.exit("Python 3.15 or newer is required") if sys.version_info < (3, 15) else None'
"$python_executable" -m ruff format --check scripts tests
"$python_executable" -m ruff check scripts tests
"$python_executable" -m mypy
"$python_executable" -m scripts.checks.architecture
