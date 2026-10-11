"""Authoritative plugin identity and release metadata, independent of packaging."""
from dataclasses import dataclass
from pathlib import Path
import re
import uuid
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class Release:
    version: str
    abi: str
    guid: str
    name: str
    owner: str
    overview: str
    description: str
    category: str
    changelog: str
    timestamp: str

    @property
    def jellyfin_version(self) -> str:
        return self.version + ".0"


def load_release(root: Path | None = None) -> Release:
    root = root or Path(__file__).resolve().parent.parent
    metadata = ET.parse(root / "Directory.Build.props").getroot()
    def required(name: str) -> str:
        value = metadata.findtext(".//" + name)
        if not value or not value.strip():
            raise ValueError("Missing release metadata: " + name)
        return value.strip()
    release = Release(*(required(name) for name in (
        "LyricBridgeVersion", "JellyfinTargetAbi", "LyricBridgeGuid", "LyricBridgeName",
        "LyricBridgeOwner", "LyricBridgeOverview", "LyricBridgeDescription",
        "LyricBridgeCategory", "LyricBridgeChangelog", "LyricBridgeReleaseTimestamp",
    )))
    if not re.fullmatch(r"\d+\.\d+\.\d+", release.version) or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", release.abi):
        raise ValueError("Invalid plugin version or Jellyfin ABI")
    uuid.UUID(release.guid)
    return release
