# Geographic map data

## `stalls.geojson`

1,219 individually addressable stall and footprint polygons in WGS84 longitude/latitude coordinates. Each feature currently contains a stable source ID, stall type, source styling, and empty fields for later exhibitor assignment.

## `labels.geojson`

5,037 georeferenced text anchors extracted from the PDF. They are intentionally kept separate from stalls: the source PDF splits many names into fragments, so an automatic polygon-to-name join would create incorrect exhibitor data.

## Rebuild

Run:

```sh
python3 scripts/convert-svg-map-to-geojson.py \
  --stalls data/source/stalls.svg.json.gz \
  --labels data/source/labels.svg.json.gz \
  --calibration config/exhibitor-map-overlay.json \
  --output public/data
```

The converter applies the proportional Web Mercator placement and rotation from the Map Lab export, then emits RFC 7946 GeoJSON.
