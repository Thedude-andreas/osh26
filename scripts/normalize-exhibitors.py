#!/usr/bin/env python3
"""Normalize the captured public Goeshow exhibitor list into app datasets."""

import argparse
import json
import re
import unicodedata
from pathlib import Path


def slugify(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = value.replace("&", " and ")
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value))[:80]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    source = json.loads(Path(args.input).read_text())
    by_name = {}
    for row in source["records"]:
        key = row["name"].strip().casefold()
        item = by_name.setdefault(key, {
            "id": slugify(row["name"]), "name": row["name"], "description": "", "descriptionStatus": "missing",
            "tags": [], "booths": [], "logoUrl": row.get("logoUrl"), "logoLocalPath": None,
            "sourceUrl": source["sourceUrl"],
        })
        if len(row.get("descriptionPreview", "")) > len(item["description"]):
            item["description"] = row["descriptionPreview"]
            item["descriptionStatus"] = "preview"
        for tag in row.get("tags", []):
            if tag not in item["tags"]:
                item["tags"].append(tag)
        if row["booth"] not in item["booths"]:
            item["booths"].append(row["booth"])
        if not item["logoUrl"] and row.get("logoUrl"):
            item["logoUrl"] = row["logoUrl"]
    exhibitors = sorted(by_name.values(), key=lambda item: item["name"].casefold())
    booths = sorted(
        ({"boothNumber": booth, "exhibitorId": item["id"], "exhibitorName": item["name"]} for item in exhibitors for booth in item["booths"]),
        key=lambda item: item["boothNumber"],
    )
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "exhibitors.json").write_text(json.dumps({
        "schemaVersion": 1, "sourceUrl": source["sourceUrl"],
        "descriptionNote": "Descriptions marked preview are list-view excerpts, not full source descriptions.",
        "count": len(exhibitors), "exhibitors": exhibitors,
    }, ensure_ascii=False, indent=2) + "\n")
    (output / "booths.json").write_text(json.dumps({"schemaVersion": 1, "count": len(booths), "booths": booths}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"exhibitors": len(exhibitors), "boothRelations": len(booths)}))


if __name__ == "__main__":
    main()
