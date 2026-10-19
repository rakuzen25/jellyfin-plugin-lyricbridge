"""Compatibility entrypoint for the shared toolkit."""

import importlib
import runpy
import sys

if __name__ == "__main__":
    runpy.run_module("jellyfin_plugin_toolkit.tasks", run_name="__main__")
else:
    sys.modules[__name__] = importlib.import_module("jellyfin_plugin_toolkit.tasks")
