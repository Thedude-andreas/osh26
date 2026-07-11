#!/usr/bin/env python3
"""Convert extracted AirVenture SVG stalls and labels to WGS84 GeoJSON."""

import argparse
import gzip
import json
import math
import re
from pathlib import Path

TOKEN = re.compile(r"[MLZmlz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
MATRIX = re.compile(r"matrix\(([^)]+)\)")


def read_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text())


def mercator_x(lng):
    return (lng + 180.0) / 360.0


def mercator_y(lat):
    rad = math.radians(max(-85.05112878, min(85.05112878, lat)))
    return (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0


def unproject(x, y):
    lng = x * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y))))
    return [round(lng, 9), round(lat, 9)]


def parse_path(path_data):
    tokens = TOKEN.findall(path_data)
    rings, ring, command, index = [], [], None, 0
    cursor = [0.0, 0.0]
    while index < len(tokens):
        token = tokens[index]
        if token.upper() in {"M", "L", "Z"}:
            command = token
            index += 1
            if token.upper() == "Z":
                if ring:
                    rings.append(ring)
                    ring = []
                continue
        if command and command.upper() in {"M", "L"} and index + 1 < len(tokens):
            x, y = float(tokens[index]), float(tokens[index + 1])
            index += 2
            if command.islower():
                x += cursor[0]
                y += cursor[1]
            cursor = [x, y]
            if command.upper() == "M" and ring:
                rings.append(ring)
                ring = []
            ring.append([x, y])
            command = "l" if command == "m" else "L" if command == "M" else command
        else:
            index += 1
    if ring:
        rings.append(ring)
    return rings


def matrix_values(transform):
    match = MATRIX.search(transform or "")
    if not match:
        return [1, 0, 0, 1, 0, 0]
    return [float(value) for value in re.split(r"[ ,]+", match.group(1).strip())]


def apply_matrix(point, matrix):
    x, y = point
    a, b, c, d, e, f = matrix
    return [a * x + c * y + e, b * x + d * y + f]


def build_projector(calibration, width, height):
    bounds = calibration["bounds"]
    west, east = mercator_x(bounds["west"]), mercator_x(bounds["east"])
    north, south = mercator_y(bounds["north"]), mercator_y(bounds["south"])
    center_x, center_y = (west + east) / 2, (north + south) / 2
    scale_x, scale_y = (east - west) / width, (south - north) / height
    angle = math.radians(calibration["rotationDegrees"])
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def project(point):
        dx = (point[0] - width / 2) * scale_x
        dy = (point[1] - height / 2) * scale_y
        rotated_x = dx * cos_a - dy * sin_a
        rotated_y = dx * sin_a + dy * cos_a
        return unproject(center_x + rotated_x, center_y + rotated_y)

    return project


def ring_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def normalize_ring(ring):
    cleaned = []
    for point in ring:
        if not cleaned or point != cleaned[-1]:
            cleaned.append(point)
    if cleaned and cleaned[0] != cleaned[-1]:
        cleaned.append(cleaned[0])
    if len(cleaned) >= 4 and ring_area(cleaned) < 0:
        cleaned.reverse()
    return cleaned


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stalls", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--calibration", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    stalls_source = read_json(args.stalls)
    labels_source = read_json(args.labels)
    calibration = read_json(args.calibration)
    view_box = stalls_source["viewBox"]
    if isinstance(view_box, str):
        _, _, width, height = [float(value) for value in view_box.split()]
    else:
        width, height = view_box["width"], view_box["height"]
    project = build_projector(calibration, width, height)

    label_features = []
    for label in labels_source["labels"]:
        source_point = [label["x"], label["y"]]
        geo_point = project(source_point)
        label_features.append({
            "type": "Feature",
            "id": label["id"],
            "geometry": {"type": "Point", "coordinates": geo_point},
            "properties": {
                "id": label["id"],
                "text": label["text"],
                "sourceX": label["x"],
                "sourceY": label["y"],
                "sourceBbox": label.get("bbox"),
            },
        })

    stall_features = []
    for stall in stalls_source["stalls"]:
        matrix = matrix_values(stall.get("transform"))
        source_rings = []
        for raw_ring in parse_path(stall["d"]):
            transformed = [apply_matrix(point, matrix) for point in raw_ring]
            if len(transformed) >= 3:
                source_rings.append(transformed)
        if not source_rings:
            continue
        geo_rings = [normalize_ring([project(point) for point in ring]) for ring in source_rings]
        geo_rings = [ring for ring in geo_rings if len(ring) >= 4]
        if not geo_rings:
            continue
        stall_features.append({
            "type": "Feature",
            "id": stall["id"],
            "geometry": {"type": "Polygon", "coordinates": geo_rings},
            "properties": {
                "id": stall["id"],
                "stallType": stall.get("type", "standard"),
                "label": None,
                "exhibitorId": None,
                "attributeStatus": "unassigned",
                "fill": stall.get("fill"),
                "source": "AirVenture-2026-exhibitor-map-layered.svg",
            },
        })

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    common = {
        "generatedFrom": "AirVenture-2026-exhibitor-map-layered.svg",
        "calibration": calibration,
    }
    stalls_geojson = {"type": "FeatureCollection", **common, "features": stall_features}
    labels_geojson = {"type": "FeatureCollection", **common, "features": label_features}
    (output / "stalls.geojson").write_text(json.dumps(stalls_geojson, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output / "labels.geojson").write_text(json.dumps(labels_geojson, ensure_ascii=False, separators=(",", ":")) + "\n")
    summary = {
        "stallFeatures": len(stall_features),
        "labelFeatures": len(label_features),
        "labelAssignment": "unassigned; PDF text fragments require a separate reconciliation step",
    }
    (output / "conversion-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
