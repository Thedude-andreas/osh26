#!/usr/bin/env python3
"""Link official booth numbers to the nearest georeferenced stall polygon."""

import argparse
import json
import math
from pathlib import Path


def centroid(feature):
    ring = feature["geometry"]["coordinates"][0][:-1]
    return [sum(point[0] for point in ring) / len(ring), sum(point[1] for point in ring) / len(ring)]


def distance_meters(a, b):
    mean_lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111_320 * math.cos(mean_lat), (a[1] - b[1]) * 111_320)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stalls", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--exhibitors", required=True)
    parser.add_argument("--booths", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    stalls_collection = json.loads(Path(args.stalls).read_text())
    labels_collection = json.loads(Path(args.labels).read_text())
    exhibitors_data = json.loads(Path(args.exhibitors).read_text())
    booths_data = json.loads(Path(args.booths).read_text())

    exhibitors = {item["id"]: item for item in exhibitors_data["exhibitors"]}
    booth_index = {}
    for relation in booths_data["booths"]:
        booth_index.setdefault(relation["boothNumber"].strip().upper(), []).append(relation)

    stall_centroids = [(index, centroid(feature)) for index, feature in enumerate(stalls_collection["features"])]
    candidates = []
    for label in labels_collection["features"]:
        booth_number = str(label["properties"].get("text", "")).strip().upper()
        if booth_number not in booth_index:
            continue
        position = label["geometry"]["coordinates"]
        nearest = sorted(
            ((distance_meters(position, center), stall_index) for stall_index, center in stall_centroids),
            key=lambda item: item[0],
        )[:8]
        candidates.append({"label": label, "boothNumber": booth_number, "nearest": nearest})

    # Prefer the shortest unambiguous assignments so duplicate text anchors do not
    # claim the same polygon before a closer booth number does.
    assignments = []
    used_stalls = set()
    for candidate in sorted(candidates, key=lambda item: item["nearest"][0][0]):
        choice = next(((distance, index) for distance, index in candidate["nearest"] if index not in used_stalls), None)
        if not choice or choice[0] > 25:
            continue
        distance, stall_index = choice
        used_stalls.add(stall_index)
        assignments.append((candidate, stall_index, distance))

    booth_label_features = []
    for candidate, stall_index, distance in assignments:
        relations = booth_index[candidate["boothNumber"]]
        linked_exhibitors = [exhibitors[relation["exhibitorId"]] for relation in relations if relation["exhibitorId"] in exhibitors]
        names = [item["name"] for item in linked_exhibitors]
        tags = sorted({tag for item in linked_exhibitors for tag in item.get("tags", [])})
        stall = stalls_collection["features"][stall_index]
        stall["properties"].update({
            "boothNumber": candidate["boothNumber"],
            "exhibitorIds": [item["id"] for item in linked_exhibitors],
            "exhibitorNames": names,
            "displayName": " / ".join(names) or candidate["boothNumber"],
            "tags": tags,
            "matchMethod": "official-booth-label-nearest-stall-centroid",
            "matchDistanceMeters": round(distance, 2),
            "matchStatus": "auto" if distance <= 15 else "review",
        })
        label_feature = json.loads(json.dumps(candidate["label"]))
        label_feature["properties"].update({
            "boothNumber": candidate["boothNumber"],
            "displayName": " / ".join(names) or candidate["boothNumber"],
            "exhibitorIds": [item["id"] for item in linked_exhibitors],
            "tags": tags,
            "stallId": stall["properties"]["id"],
            "matchDistanceMeters": round(distance, 2),
            "matchStatus": "auto" if distance <= 15 else "review",
        })
        booth_label_features.append(label_feature)

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "stalls-enriched.geojson").write_text(json.dumps(stalls_collection, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output / "booth-labels.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": booth_label_features}, ensure_ascii=False, separators=(",", ":")) + "\n")
    summary = {
        "officialExhibitors": len(exhibitors),
        "officialBoothRelations": len(booths_data["booths"]),
        "officialBoothNumbers": len(booth_index),
        "mapBoothLabelCandidates": len(candidates),
        "linkedStallPolygons": len(assignments),
        "autoMatchesWithin15m": sum(distance <= 15 for _, _, distance in assignments),
        "reviewMatches15To25m": sum(distance > 15 for _, _, distance in assignments),
        "unlinkedStallPolygons": len(stalls_collection["features"]) - len(assignments),
    }
    (output / "booth-link-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
