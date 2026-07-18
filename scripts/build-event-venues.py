#!/usr/bin/env python3
"""Build the OSH26 event venue registry from the schedule, booth map and OSM."""

from __future__ import annotations

import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

OSM_ALIASES = {
    "Aeroplane Workshop": "Aeroplane Workshop",
    "Boeing Plaza": "Boeing Plaza",
    "EAA Blue Barn Featuring EAA Chapters, EAA Young Eagles, and EAA Eagle Flights": "EAA Blue Barn",
    "EAA Museum - Hilton Theater": "EAA Aviation Museum",
    "EAA Museum - Skyscape Theater": "Skyscape Theater",
    "EAA Museum - Vette Theater": "EAA Aviation Museum",
    "EAA Pilot Proficiency Center": "Education Center",
    "EAA Youth Education Center": "Education Center",
    "EAA Wearhouse": "EAA Wearhouse",
    "FAA Aviation Safety Center, Flight Service Station": "FAA Aviation Safety Center",
    "Fergus Chapel and Compass Hill": "Compass Hill",
    "Gas Welding Workshop": "Gas Welding Workshop/Classroom C",
    "Homebuilders Hangar Supported by Aircraft Spruce & Specialty": "Homebuilders Hangar",
    "International Aerobatic Club (IAC) Aerobatics Center": "IAC Aerobatic Center & Forums",
    "Nature Center Pavilion": "Nature Center Pavilion",
    "Sheet Metal Workshop Presented by Aircraft Spruce & Specialty": "Sheet Metal Workshop",
    "Theater in the Woods Supported by M&M'S": "Theater in the Woods",
    "TIG Welding Workshop Presented by Lincoln Electric": "TIG Welding Workshop",
    "Ultralight Barn": "Ultralight Barn and Forums",
    "Ultralight Forums Tent": "Ultralight Barn and Forums",
    "Vintage Hangar": "Vintage Hangar",
    "Wood Workshop": "Wood Workshop/Classroom B",
    "Workshop Classroom A": "Composite Workshop/Classroom A",
    "Workshop Classroom B": "Wood Workshop/Classroom B",
    "Workshop Classroom C": "Gas Welding Workshop/Classroom C",
}

for stage in range(1, 12):
    sponsor = {
        1: "Forum Stage 1 Sponsored By WILCO",
        2: "Forum Stage 2 Sponsored By Aero Hose Shop",
        3: "Forum Stage 3 Sponsored By Superflite",
        4: "Forum Stage 4 Sponsored By Chicago Executive Airport",
        5: "Forum Stage 5 Sponsored By Scheme Designers",
        6: "Forum Stage 6 Sponsored By EnerSys",
        7: "Forum Stage 7 Sponsored by Jeppesen ForeFlight",
        8: "Forum Stage 8 Sponsored By GAMA",
        9: "Forum Stage 9 Sponsored By SOFTIE PARACHUTES by Para-Phernalia Inc.",
        10: "Forum Stage 10 Sponsored By Poly Fiber Inc.",
        11: "Forum Stage 11 Sponsored By Aircraft Specialties Services",
    }[stage]
    if stage in (1, 2):
        OSM_ALIASES[sponsor] = "Forums Stages 1&2"
    elif stage in (3, 4):
        OSM_ALIASES[sponsor] = "Forums Stages 3&4"
    elif stage in (5, 6, 7, 8):
        OSM_ALIASES[sponsor] = f"Forums Stage {stage}"
    else:
        OSM_ALIASES[sponsor] = f"Forum Stage {stage}"

BOOTH_MATCHES = {
    "ALPA Booth 329": ["329"],
    "AeroShell Booth 446/457": ["446", "457"],
    "Bose Aviation Booth 283": ["283"],
    "Continental Aerospace Technologies": ["229"],
    "Dynon Tent": ["496"],
    "EAA Canada": ["400", "400A", "400B"],
    "EAA Learn to Fly Center": ["EAA4"],
    "Hartzell Propeller 296-297": ["296", "297"],
    "Lycoming Engines Booth 277": ["277"],
    "Michelin Aircraft Tire Co.": ["434", "435", "436"],
    "NAFI Booth": ["354"],
    "NASM Tent Booth 328": ["328"],
    "Redbird Sim Lab": ["301"],
    "Rotax Aircraft Engines Booth": ["265"],
    "Signia Aerospace 289": ["289"],
    "Southwest Airlines Booth 502": ["502"],
    "Superior Air Parts Booth": ["258"],
}

# Positions read from EAA's 2026 Official Visitors Map. The Forums/Workshops
# inset was calibrated against the OSM-mapped forum stages; the remaining
# positions use the map's printed grid and nearby OSM anchors. They are kept
# separate from OSM matches so the placement editor can show their provenance.
VISITOR_MAP_MATCHES = {
    "Charles W. Harris Youth Aviation Center": {"coordinates": [-88.56087356, 43.97640863], "sourceName": "Official Visitors Map · grid L-15"},
    "EAA Member Center": {"coordinates": [-88.56405959, 43.97838084], "sourceName": "Official Visitors Map · grid J-13"},
    "EAA WomenVenture Center": {"coordinates": [-88.56244034, 43.98205540], "sourceName": "Official Visitors Map · Forums inset"},
    "Fly-In Theater Presented by PenFed": {"coordinates": [-88.57301664, 43.97797838], "sourceName": "Official Visitors Map · grid E-13"},
    "Homebuilts in Review": {"coordinates": [-88.56055324, 43.98345935], "sourceName": "Official Visitors Map · Workshops 24"},
    "International Federal Pavilion": {"coordinates": [-88.56523807, 43.97773545], "sourceName": "Official Visitors Map · grid J-13"},
    "International Visitors Tent/Translation Services": {"coordinates": [-88.56280000, 43.97947432], "sourceName": "Official Visitors Map · grid K-12"},
    "PHP Tent": {"coordinates": [-88.57004000, 43.97786930], "sourceName": "Official Visitors Map · grid F-13/14"},
    "RC Flying Field": {"coordinates": [-88.57485502, 43.98480574], "sourceName": "Official Visitors Map · RC Flying Area"},
    "Replica Fighters HQ": {"coordinates": [-88.56378629, 43.98384039], "sourceName": "Official Visitors Map · grid J-9"},
    "VAA Tall Pines Cafe": {"coordinates": [-88.56291358, 43.98248036], "sourceName": "Official Visitors Map · Tall Pines Cafe, grid K-9"},
}


def center(points: list[list[float]]) -> list[float]:
    return [sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)]


def osm_features(path: Path) -> dict[str, dict]:
    root = ET.parse(path).getroot()
    nodes = {
        node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])]
        for node in root.findall("node")
    }
    result: dict[str, dict] = {}
    for element in root:
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
        name = tags.get("name")
        if not name:
            continue
        if element.tag == "node":
            geometry = {"type": "Point", "coordinates": nodes[element.attrib["id"]]}
        elif element.tag == "way":
            points = [nodes[nd.attrib["ref"]] for nd in element.findall("nd") if nd.attrib["ref"] in nodes]
            if not points:
                continue
            geometry = {"type": "Polygon", "coordinates": [points]} if len(points) > 3 and points[0] == points[-1] else {"type": "LineString", "coordinates": points}
        else:
            continue
        result[name] = {
            "geometry": geometry,
            "center": geometry["coordinates"] if geometry["type"] == "Point" else center(geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"]),
            "osmType": element.tag,
            "osmId": element.attrib["id"],
            "osmName": name,
        }
    return result


def main() -> None:
    events = json.loads((ROOT / "public/data/events.json").read_text())["events"]
    venue_counts = Counter(event["venue"].strip() for event in events if event["venue"].strip())
    labels = json.loads((ROOT / "public/data/booth-labels.geojson").read_text())["features"]
    labels_by_booth: dict[str, list[list[float]]] = {}
    for feature in labels:
        booth = str(feature["properties"].get("boothNumber", ""))
        labels_by_booth.setdefault(booth, []).append(feature["geometry"]["coordinates"])
    osm = {}
    for source in ("osm-airventure-grounds.xml", "osm-airventure-north.xml", "osm-airventure-south.xml", "osm-airventure-west.xml"):
        osm.update(osm_features(ROOT / "data/import" / source))

    registry = []
    geojson = []
    for name, event_count in sorted(venue_counts.items()):
        entry = {"name": name, "eventCount": event_count, "status": "unmatched", "source": None, "coordinates": None}
        geometry = None
        if name in OSM_ALIASES and OSM_ALIASES[name] in osm:
            match = osm[OSM_ALIASES[name]]
            entry.update({
                "status": "matched", "source": "openstreetmap", "coordinates": match["center"],
                "sourceName": match["osmName"], "osmType": match["osmType"], "osmId": match["osmId"],
            })
            geometry = match["geometry"]
        elif name in BOOTH_MATCHES:
            points = [point for booth in BOOTH_MATCHES[name] for point in labels_by_booth.get(booth, [])]
            if points:
                entry.update({
                    "status": "matched", "source": "booth-map", "coordinates": center(points),
                    "booths": BOOTH_MATCHES[name],
                })
                geometry = {"type": "Point", "coordinates": entry["coordinates"]}
        elif name in VISITOR_MAP_MATCHES:
            match = VISITOR_MAP_MATCHES[name]
            entry.update({
                "status": "matched", "source": "visitor-map", "coordinates": match["coordinates"],
                "sourceName": match["sourceName"],
            })
            geometry = {"type": "Point", "coordinates": entry["coordinates"]}
        registry.append(entry)
        if geometry:
            geojson.append({
                "type": "Feature", "id": f"venue-{len(geojson) + 1}", "geometry": geometry,
                "properties": {key: value for key, value in entry.items() if key != "coordinates"},
            })

    payload = {
        "version": 1,
        "venueCount": len(registry),
        "matchedCount": sum(entry["status"] == "matched" for entry in registry),
        "venues": registry,
    }
    (ROOT / "public/data/event-venues.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    (ROOT / "public/data/event-venues.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": geojson}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"venues": len(registry), "matched": payload["matchedCount"], "unmatched": len(registry) - payload["matchedCount"]}, indent=2))


if __name__ == "__main__":
    main()
