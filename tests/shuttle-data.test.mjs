import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metersPerLatitude = 111_320;
const metersPerLongitude = metersPerLatitude * Math.cos(43.978 * Math.PI / 180);

function coordinateKey([longitude, latitude]) {
  return `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
}

function localPoint([longitude, latitude]) {
  return [longitude * metersPerLongitude, latitude * metersPerLatitude];
}

function pointToSegmentDistance(pointCoordinate, leftCoordinate, rightCoordinate) {
  const [pointX, pointY] = localPoint(pointCoordinate);
  const [leftX, leftY] = localPoint(leftCoordinate);
  const [rightX, rightY] = localPoint(rightCoordinate);
  const deltaX = rightX - leftX;
  const deltaY = rightY - leftY;
  const denominator = deltaX ** 2 + deltaY ** 2;
  const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((pointX - leftX) * deltaX + (pointY - leftY) * deltaY) / denominator,
  ));
  return Math.hypot(
    pointX - (leftX + fraction * deltaX),
    pointY - (leftY + fraction * deltaY),
  );
}

function componentCount(features) {
  const adjacency = new Map();
  const connect = (left, right) => {
    adjacency.set(left, new Set([...(adjacency.get(left) ?? []), right]));
    adjacency.set(right, new Set([...(adjacency.get(right) ?? []), left]));
  };
  features.forEach((feature) => {
    const keys = feature.geometry.coordinates.map(coordinateKey);
    keys.slice(1).forEach((key, index) => connect(keys[index], key));
  });

  const remaining = new Set(adjacency.keys());
  let components = 0;
  while (remaining.size) {
    components += 1;
    const pending = [remaining.values().next().value];
    remaining.delete(pending[0]);
    while (pending.length) {
      const current = pending.pop();
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!remaining.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }
  }
  return components;
}

test("shuttle routes are connected and every stop is on its route", async () => {
  const source = new URL("../public/data/shuttles.geojson", import.meta.url);
  const collection = JSON.parse(await readFile(source, "utf8"));
  const routes = new Map();
  const stops = [];

  for (const feature of collection.features) {
    if (feature.properties.kind === "route") {
      const route = feature.properties.name;
      routes.set(route, [...(routes.get(route) ?? []), feature]);
    } else if (feature.properties.kind === "stop") {
      stops.push(feature);
    }
  }

  assert.ok(routes.size > 0);
  assert.ok(stops.length > 0);
  for (const [route, features] of routes) {
    assert.equal(componentCount(features), 1, `${route} must be one connected component`);
  }

  for (const stop of stops) {
    const route = stop.properties.routes;
    const routeFeatures = routes.get(route);
    assert.ok(routeFeatures, `${stop.properties.name} must reference a known route`);
    const gap = Math.min(...routeFeatures.flatMap((feature) =>
      feature.geometry.coordinates.slice(1).map((right, index) =>
        pointToSegmentDistance(stop.geometry.coordinates, feature.geometry.coordinates[index], right),
      ),
    ));
    assert.ok(gap <= 0.03, `${stop.properties.name} is ${gap.toFixed(3)} m from ${route}`);
  }
});
