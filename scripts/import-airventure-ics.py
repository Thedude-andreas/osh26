#!/usr/bin/env python3
"""Normalize the AirVenture ICS export into the static OSH26 event catalog."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
from collections import Counter
from zoneinfo import ZoneInfo


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "import" / "airventure-2026-all.ics"
OUTPUT = ROOT / "public" / "data" / "events.json"
LOCAL_ZONE = ZoneInfo("America/Chicago")


def unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def decode(value: str) -> str:
    return (
        value.replace(r"\n", "\n")
        .replace(r"\N", "\n")
        .replace(r"\,", ",")
        .replace(r"\;", ";")
        .replace(r"\\", "\\")
        .strip()
    )


def parse_utc(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)


def main() -> None:
    source = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    output = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT
    fields: dict[str, str] = {}
    events: list[dict[str, object]] = []
    in_event = False

    for line in unfold(source.read_text(encoding="utf-8-sig")):
        if line == "BEGIN:VEVENT":
            fields = {}
            in_event = True
            continue
        if line == "END:VEVENT":
            if not in_event:
                continue
            start = parse_utc(fields["DTSTART"])
            end = parse_utc(fields["DTEND"])
            local_start = start.astimezone(LOCAL_ZONE)
            local_end = end.astimezone(LOCAL_ZONE)
            description_lines = decode(fields.get("DESCRIPTION", "")).splitlines()
            category = next((line.split(":", 1)[1].strip() for line in description_lines if line.startswith("Type:")), "Other")
            interests_text = next((line.split(":", 1)[1].strip() for line in description_lines if line.startswith("Interests:")), "")
            interests = [item.strip() for item in interests_text.split(",") if item.strip()]
            uid = decode(fields.get("UID", ""))
            events.append({
                "id": uid.split("@", 1)[0],
                "uid": uid,
                "title": decode(fields.get("SUMMARY", "Untitled event")),
                "category": category,
                "interests": interests,
                "venue": decode(fields.get("LOCATION", "")),
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
                "localDate": local_start.strftime("%Y-%m-%d"),
                "localStart": local_start.strftime("%H:%M"),
                "localEnd": local_end.strftime("%H:%M"),
                "timezone": "America/Chicago",
                "url": decode(fields.get("URL", "")),
            })
            in_event = False
            continue
        if in_event and ":" in line:
            key, value = line.split(":", 1)
            fields[key.split(";", 1)[0]] = value

    unique = {event["uid"]: event for event in events}
    normalized = sorted(unique.values(), key=lambda event: (str(event["start"]), str(event["title"])))
    payload = {
        "version": 1,
        "timezone": "America/Chicago",
        "source": "https://events.rdmobile.com/Sessions/Index/19955",
        "eventCount": len(normalized),
        "categories": dict(sorted(Counter(str(event["category"]) for event in normalized).items())),
        "events": normalized,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(output), "events": len(normalized), "categories": payload["categories"]}, indent=2))


if __name__ == "__main__":
    main()
