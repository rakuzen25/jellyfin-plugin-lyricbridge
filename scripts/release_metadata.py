"""Authoritative plugin identity and release metadata, independent of packaging."""
from dataclasses import dataclass
from datetime import date
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
    version = required("LyricBridgeVersion")
    changelog, timestamp = changelog_section(root, version)
    release = Release(
        version=version,
        abi=required("JellyfinTargetAbi"),
        guid=required("LyricBridgeGuid"),
        name=required("LyricBridgeName"),
        owner=required("LyricBridgeOwner"),
        overview=required("LyricBridgeOverview"),
        description=required("LyricBridgeDescription"),
        category=required("LyricBridgeCategory"),
        changelog=changelog,
        timestamp=timestamp,
    )
    if not re.fullmatch(r"\d+\.\d+\.\d+", release.version) or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", release.abi):
        raise ValueError("Invalid plugin version or Jellyfin ABI")
    uuid.UUID(release.guid)
    return release


def changelog_section(root: Path, version: str) -> tuple[str, str]:
    """Read the same version's notes that release-please puts in its release PR."""
    text = (root / "CHANGELOG.md").read_text()
    heading = re.search(r"^##\s+\[?" + re.escape(version) + r"(?:\]|(?=\s|$)).*$", text, re.MULTILINE)
    if heading is None:
        raise ValueError("Missing changelog section for plugin version " + version)
    stamp = re.search(r"\((\d{4}-\d{2}-\d{2})\)\s*$", heading.group())
    if stamp is None:
        raise ValueError("Missing release date in changelog heading")
    timestamp = date.fromisoformat(stamp.group(1)).isoformat() + "T00:00:00Z"
    tail = text[heading.end():]
    next_heading = re.search(r"^##\s", tail, re.MULTILINE)
    notes = tail[:next_heading.start()] if next_heading else tail
    if not notes.strip():
        raise ValueError("Empty changelog section for plugin version " + version)
    return notes.strip(), timestamp


def changelog_for_version(root: Path, version: str) -> str:
    return changelog_section(root, version)[0]
