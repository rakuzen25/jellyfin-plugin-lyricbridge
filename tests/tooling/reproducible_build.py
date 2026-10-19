"""Compatibility entrypoint for independently rebuilding bundled source."""

from jellyfin_plugin_toolkit.context import Context
from jellyfin_plugin_toolkit.reproducibility import main

if __name__ == "__main__":
    main(Context.load())
