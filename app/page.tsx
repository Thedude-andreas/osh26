"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

type GeoFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point" | "Polygon"; coordinates: unknown };
  properties: Record<string, unknown>;
};
type FeatureCollection = { type: "FeatureCollection"; features: GeoFeature[] };
type ReviewValue = "ok" | "text" | "position";
type Reviews = Record<string, ReviewValue>;

const CENTER: [number, number] = [-88.56345, 43.97742];

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectedStallRef = useRef<string | number | null>(null);
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState<FeatureCollection | null>(null);
  const [query, setQuery] = useState("");
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [stallsVisible, setStallsVisible] = useState(true);
  const [labelSize, setLabelSize] = useState(12);
  const [selectedLabel, setSelectedLabel] = useState<GeoFeature | null>(null);
  const [selectedStall, setSelectedStall] = useState<GeoFeature | null>(null);
  const [reviews, setReviews] = useState<Reviews>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("osh26-label-reviews") || "{}"); }
    catch { return {}; }
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
      container: mapContainer.current,
      center: CENTER,
      zoom: 16.2,
      minZoom: 13,
      maxZoom: 21,
      attributionControl: false,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-contrast": -0.08, "raster-brightness-max": 0.96 } }],
      },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kartan kunde inte startas i webbläsaren.";
      queueMicrotask(() => setMapError(message));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", async () => {
      try {
      const [stallResponse, labelResponse] = await Promise.all([fetch("/data/stalls.geojson"), fetch("/data/labels.geojson")]);
      if (!stallResponse.ok || !labelResponse.ok) throw new Error("Kartdatan kunde inte hämtas.");
      const stallsData = await stallResponse.json() as FeatureCollection;
      const labelsData = await labelResponse.json() as FeatureCollection;
      setLabels(labelsData);
      map.addSource("stalls", { type: "geojson", data: stallsData as never });
      map.addSource("labels", { type: "geojson", data: labelsData as never });
      map.addLayer({
        id: "stall-fill", type: "fill", source: "stalls",
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ef5b3f", "#f5b642"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.78, 0.32],
        },
      });
      map.addLayer({ id: "stall-outline", type: "line", source: "stalls", paint: { "line-color": "#5d451a", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 19, 1.4] } });
      map.addLayer({
        id: "label-points", type: "circle", source: "labels", minzoom: 15.5,
        paint: { "circle-radius": 2.5, "circle-color": "#197d79", "circle-stroke-color": "#fff", "circle-stroke-width": 1, "circle-opacity": 0.75 },
      });
      map.addLayer({
        id: "label-text", type: "symbol", source: "labels", minzoom: 16,
        layout: {
          "text-field": ["get", "text"], "text-font": ["Open Sans Regular"], "text-size": 12,
          "text-anchor": "center", "text-allow-overlap": false, "text-padding": 1, "text-max-width": 9,
        },
        paint: { "text-color": "#0c3435", "text-halo-color": "rgba(255,255,255,.94)", "text-halo-width": 1.5 },
      });

      map.on("click", "stall-fill", (event: MapMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        if (selectedStallRef.current !== null) map.setFeatureState({ source: "stalls", id: selectedStallRef.current }, { selected: false });
        selectedStallRef.current = feature.id ?? null;
        if (feature.id !== undefined) map.setFeatureState({ source: "stalls", id: feature.id }, { selected: true });
        setSelectedStall(feature as unknown as GeoFeature);
        setPanelOpen(true);
      });
      map.on("click", "label-text", (event: MapMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        setSelectedLabel(feature as unknown as GeoFeature);
        setPanelOpen(true);
      });
      map.on("mouseenter", "stall-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "stall-fill", () => { map.getCanvas().style.cursor = ""; });
      setReady(true);
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 250);
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "Kartlagren kunde inte laddas.");
      }
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("stall-fill", "visibility", stallsVisible ? "visible" : "none");
    map.setLayoutProperty("stall-outline", "visibility", stallsVisible ? "visible" : "none");
  }, [ready, stallsVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("label-text", "visibility", labelsVisible ? "visible" : "none");
    map.setLayoutProperty("label-points", "visibility", labelsVisible ? "visible" : "none");
  }, [labelsVisible, ready]);

  useEffect(() => {
    if (ready) mapRef.current?.setLayoutProperty("label-text", "text-size", labelSize);
  }, [labelSize, ready]);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("sv");
    if (!normalized || !labels) return [];
    return labels.features.filter((feature) => String(feature.properties.text || "").toLocaleLowerCase("sv").includes(normalized)).slice(0, 20);
  }, [labels, query]);

  const reviewCounts = useMemo(() => Object.values(reviews).reduce((count, value) => ({ ...count, [value]: count[value] + 1 }), { ok: 0, text: 0, position: 0 }), [reviews]);

  function focusLabel(feature: GeoFeature) {
    const coordinates = feature.geometry.coordinates as [number, number];
    mapRef.current?.flyTo({ center: coordinates, zoom: Math.max(mapRef.current.getZoom(), 18.2), duration: 650 });
    setSelectedLabel(feature);
    setQuery("");
    setPanelOpen(true);
  }

  function review(value: ReviewValue) {
    if (!selectedLabel) return;
    const next = { ...reviews, [String(selectedLabel.id)]: value };
    setReviews(next);
    localStorage.setItem("osh26-label-reviews", JSON.stringify(next));
  }

  function exportReviews() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, type: "osh26-label-review", reviews }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "osh26-label-reviews.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="map-app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">26</span><div><strong>OSH26</strong><small>Map validation lab</small></div></div>
        <div className="search-wrap">
          <span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök etikett…" aria-label="Sök etikett" />
          {results.length > 0 && <div className="search-results">{results.map((feature) => <button key={feature.id} onClick={() => focusLabel(feature)}><strong>{String(feature.properties.text)}</strong><small>{feature.id}</small></button>)}</div>}
        </div>
        <button className="panel-toggle" onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? "Dölj panel" : "Visa panel"}</button>
      </header>

      <section className="map-shell">
        <div ref={mapContainer} className="map-canvas" />
        {!ready && <div className="loading-card"><span /><strong>Laddar 1 219 montrar…</strong></div>}
        {mapError && <div className="map-error"><strong>Kartan kunde inte visas</strong><span>{mapError}</span><button onClick={() => location.reload()}>Försök igen</button></div>}
        <div className="layer-card">
          <strong>Lager</strong>
          <label><input type="checkbox" checked={stallsVisible} onChange={(event) => setStallsVisible(event.target.checked)} /> Monterpolygoner</label>
          <label><input type="checkbox" checked={labelsVisible} onChange={(event) => setLabelsVisible(event.target.checked)} /> Etiketter och ankare</label>
          <label className="size-control"><span>Textstorlek <b>{labelSize}px</b></span><input type="range" min="8" max="22" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
        </div>

        {panelOpen && <aside className="inspector">
          <div className="inspector-head"><div><span>VALIDERING</span><h1>{selectedLabel ? String(selectedLabel.properties.text) : selectedStall ? String(selectedStall.properties.id) : "Välj ett objekt"}</h1></div><button onClick={() => setPanelOpen(false)}>×</button></div>
          {selectedLabel ? <>
            <dl><div><dt>Etikett-ID</dt><dd>{selectedLabel.id}</dd></div><div><dt>Källposition</dt><dd>{Math.round(Number(selectedLabel.properties.sourceX))}, {Math.round(Number(selectedLabel.properties.sourceY))}</dd></div><div><dt>Bedömning</dt><dd>{reviews[String(selectedLabel.id)] || "Ej granskad"}</dd></div></dl>
            <p className="help-copy">Kontrollera både texten och den turkosa ankarpunktens placering mot kartan.</p>
            <div className="review-actions"><button className="ok" onClick={() => review("ok")}>✓ Allt stämmer</button><button onClick={() => review("text")}>Text behöver rättas</button><button onClick={() => review("position")}>Position behöver rättas</button></div>
          </> : selectedStall ? <>
            <dl><div><dt>Monter-ID</dt><dd>{String(selectedStall.properties.id)}</dd></div><div><dt>Typ</dt><dd>{String(selectedStall.properties.stallType)}</dd></div><div><dt>Attribut</dt><dd>{String(selectedStall.properties.attributeStatus)}</dd></div></dl>
            <p className="help-copy">Montern är en separat polygon och kan senare kopplas till utställare, kategori och monterinformation.</p>
          </> : <div className="empty-inspector"><span>⌖</span><p>Tryck på en gul monter eller en etikett för att inspektera den.</p></div>}
          <div className="review-summary"><div><strong>{reviewCounts.ok}</strong><span>Godkända</span></div><div><strong>{reviewCounts.text}</strong><span>Textfel</span></div><div><strong>{reviewCounts.position}</strong><span>Positionsfel</span></div></div>
          <button className="export-button" disabled={Object.keys(reviews).length === 0} onClick={exportReviews}>Exportera granskning</button>
        </aside>}
      </section>
    </main>
  );
}
