"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";

type GeoFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point" | "Polygon"; coordinates: unknown };
  properties: Record<string, unknown>;
};
type FeatureCollection = { type: "FeatureCollection"; features: GeoFeature[] };
type Exhibitor = { id: string; name: string; description: string; descriptionStatus: string; tags: string[]; booths: string[]; logoUrl: string | null };
type ReviewValue = "ok" | "text" | "position";
type Reviews = Record<string, ReviewValue>;
type LabelMarker = { marker: Marker; element: HTMLButtonElement; feature: GeoFeature };

const CENTER: [number, number] = [-88.56345, 43.97742];

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectedStallRef = useRef<string | number | null>(null);
  const labelMarkersRef = useRef<LabelMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [boothLabels, setBoothLabels] = useState<FeatureCollection | null>(null);
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([]);
  const [query, setQuery] = useState("");
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [stallsVisible, setStallsVisible] = useState(true);
  const [labelSize, setLabelSize] = useState(11);
  const [tagFilter, setTagFilter] = useState("");
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
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
          layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-contrast": -0.08, "raster-brightness-max": 0.96 } }],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kartan kunde inte startas i webbläsaren.";
      queueMicrotask(() => setMapError(message));
      return;
    }
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", async () => {
      try {
        const [stallResponse, labelResponse, exhibitorResponse] = await Promise.all([
          fetch("/data/stalls-enriched.geojson"), fetch("/data/booth-labels.geojson"), fetch("/data/exhibitors.json"),
        ]);
        if (!stallResponse.ok || !labelResponse.ok || !exhibitorResponse.ok) throw new Error("Kartdatan kunde inte hämtas.");
        const stallsData = await stallResponse.json() as FeatureCollection;
        const labelsData = await labelResponse.json() as FeatureCollection;
        const exhibitorData = await exhibitorResponse.json() as { exhibitors: Exhibitor[] };
        setBoothLabels(labelsData);
        setExhibitors(exhibitorData.exhibitors);

        map.addSource("stalls", { type: "geojson", data: stallsData as never });
        map.addSource("booth-labels", { type: "geojson", data: labelsData as never });
        map.addLayer({
          id: "stall-fill", type: "fill", source: "stalls",
          paint: {
            "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ef5b3f", ["has", "boothNumber"], "#f5b642", "#aebbb7"],
            "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.8, ["has", "boothNumber"], 0.36, 0.12],
          },
        });
        map.addLayer({ id: "stall-outline", type: "line", source: "stalls", paint: { "line-color": ["case", ["has", "boothNumber"], "#5d451a", "#75827f"], "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.45, 19, 1.3] } });
        map.addLayer({
          id: "label-points", type: "circle", source: "booth-labels", minzoom: 15.5,
          paint: { "circle-radius": 3, "circle-color": ["case", ["==", ["get", "matchStatus"], "review"], "#ef5b3f", "#197d79"], "circle-stroke-color": "#fff", "circle-stroke-width": 1, "circle-opacity": 0.9 },
        });

        labelMarkersRef.current = labelsData.features.map((feature) => {
          const element = document.createElement("button");
          element.className = "official-map-label";
          element.type = "button";
          element.innerHTML = `<span>${String(feature.properties.displayName || feature.properties.boothNumber)}</span><b>${String(feature.properties.boothNumber || "")}</b>`;
          element.dataset.tags = JSON.stringify(feature.properties.tags || []);
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            setSelectedLabel(feature);
            setSelectedStall(null);
            setPanelOpen(true);
          });
          const marker = new maplibregl.Marker({ element, anchor: "center" })
            .setLngLat(feature.geometry.coordinates as [number, number]).addTo(map);
          return { marker, element, feature };
        });

        const updateZoomVisibility = () => {
          const zoomedOut = map.getZoom() < 16;
          labelMarkersRef.current.forEach(({ element }) => element.classList.toggle("zoom-hidden", zoomedOut));
        };
        map.on("zoom", updateZoomVisibility);
        updateZoomVisibility();

        map.on("click", "stall-fill", (event: MapMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          if (selectedStallRef.current !== null) map.setFeatureState({ source: "stalls", id: selectedStallRef.current }, { selected: false });
          selectedStallRef.current = feature.id ?? null;
          if (feature.id !== undefined) map.setFeatureState({ source: "stalls", id: feature.id }, { selected: true });
          setSelectedStall(feature as unknown as GeoFeature);
          setSelectedLabel(null);
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
    return () => {
      labelMarkersRef.current.forEach(({ marker }) => marker.remove());
      labelMarkersRef.current = [];
      map.remove(); mapRef.current = null;
    };
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
    map.setLayoutProperty("label-points", "visibility", labelsVisible ? "visible" : "none");
    const zoomedOut = map.getZoom() < 16;
    labelMarkersRef.current.forEach(({ element }) => {
      const tags = JSON.parse(element.dataset.tags || "[]") as string[];
      element.style.display = labelsVisible && !zoomedOut && (!tagFilter || tags.includes(tagFilter)) ? "block" : "none";
      element.style.fontSize = `${labelSize}px`;
    });
    const filter = tagFilter ? ["in", tagFilter, ["coalesce", ["get", "tags"], ["literal", []]]] : null;
    map.setFilter("label-points", filter as never);
    map.setFilter("stall-fill", filter as never);
    map.setFilter("stall-outline", filter as never);
  }, [labelSize, labelsVisible, ready, tagFilter]);

  const tags = useMemo(() => Array.from(new Set(exhibitors.flatMap((item) => item.tags))).sort(), [exhibitors]);
  const exhibitorById = useMemo(() => new Map(exhibitors.map((item) => [item.id, item])), [exhibitors]);
  const activeExhibitors = useMemo(() => {
    const feature = selectedLabel || selectedStall;
    const ids = (feature?.properties.exhibitorIds || []) as string[];
    return ids.map((id) => exhibitorById.get(id)).filter(Boolean) as Exhibitor[];
  }, [exhibitorById, selectedLabel, selectedStall]);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("sv");
    if (!normalized) return [];
    return exhibitors.filter((item) => [item.name, ...item.booths, ...item.tags].some((value) => value.toLocaleLowerCase("sv").includes(normalized))).slice(0, 20);
  }, [exhibitors, query]);

  const reviewCounts = useMemo(() => Object.values(reviews).reduce((count, value) => ({ ...count, [value]: count[value] + 1 }), { ok: 0, text: 0, position: 0 }), [reviews]);

  function focusExhibitor(exhibitor: Exhibitor) {
    const feature = boothLabels?.features.find((item) => ((item.properties.exhibitorIds || []) as string[]).includes(exhibitor.id));
    if (feature) {
      mapRef.current?.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 18.2, duration: 650 });
      setSelectedLabel(feature);
      setSelectedStall(null);
      setPanelOpen(true);
    }
    setQuery("");
  }

  function review(value: ReviewValue) {
    if (!selectedLabel) return;
    const next = { ...reviews, [String(selectedLabel.id)]: value };
    setReviews(next);
    localStorage.setItem("osh26-label-reviews", JSON.stringify(next));
  }

  function exportReviews() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, type: "osh26-booth-link-review", reviews }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "osh26-booth-link-reviews.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  const title = activeExhibitors.map((item) => item.name).join(" / ") || (selectedLabel ? String(selectedLabel.properties.boothNumber) : selectedStall ? String(selectedStall.properties.boothNumber || selectedStall.properties.id) : "Välj ett objekt");

  return (
    <main className="map-app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">26</span><div><strong>OSH26</strong><small>Map validation lab</small></div></div>
        <div className="search-wrap">
          <span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök utställare, monter eller kategori…" aria-label="Sök utställare" />
          {results.length > 0 && <div className="search-results">{results.map((item) => <button key={item.id} onClick={() => focusExhibitor(item)}><strong>{item.name}</strong><small>{item.booths.join(", ")}</small></button>)}</div>}
        </div>
        <button className="panel-toggle" onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? "Dölj panel" : "Visa panel"}</button>
      </header>

      <section className="map-shell">
        <div ref={mapContainer} className="map-canvas" />
        {!ready && <div className="loading-card"><span /><strong>Laddar officiella utställardata…</strong></div>}
        {mapError && <div className="map-error"><strong>Kartan kunde inte visas</strong><span>{mapError}</span><button onClick={() => location.reload()}>Försök igen</button></div>}
        <div className="layer-card">
          <strong>Lager</strong>
          <label><input type="checkbox" checked={stallsVisible} onChange={(event) => setStallsVisible(event.target.checked)} /> Monterpolygoner</label>
          <label><input type="checkbox" checked={labelsVisible} onChange={(event) => setLabelsVisible(event.target.checked)} /> Officiella etiketter</label>
          <label className="filter-control"><span>Kategori</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Alla kategorier</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select></label>
          <label className="size-control"><span>Textstorlek <b>{labelSize}px</b></span><input type="range" min="8" max="18" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
        </div>

        {panelOpen && <aside className="inspector">
          <div className="inspector-head"><div><span>VALIDERING</span><h1>{title}</h1></div><button onClick={() => setPanelOpen(false)}>×</button></div>
          {(selectedLabel || selectedStall) ? <>
            {activeExhibitors[0]?.logoUrl && <img className="exhibitor-logo" src={activeExhibitors[0].logoUrl} alt={`${activeExhibitors[0].name} logotyp`} />}
            <dl>
              <div><dt>Monter</dt><dd>{String((selectedLabel || selectedStall)?.properties.boothNumber || "Ej kopplad")}</dd></div>
              <div><dt>Polygon</dt><dd>{String(selectedLabel?.properties.stallId || selectedStall?.properties.id || "—")}</dd></div>
              <div><dt>Matchning</dt><dd>{String((selectedLabel || selectedStall)?.properties.matchStatus || "Ej kopplad")}</dd></div>
              {selectedLabel && <div><dt>Avstånd</dt><dd>{String(selectedLabel.properties.matchDistanceMeters)} m</dd></div>}
            </dl>
            {activeExhibitors.map((item) => <section className="exhibitor-info" key={item.id}>
              {item.description && <p>{item.description}{item.descriptionStatus === "preview" ? "…" : ""}</p>}
              <div className="tag-list">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            </section>)}
            <p className="help-copy">Kontrollera att det officiella företagsnamnet och monternumret ligger vid rätt polygon.</p>
            {selectedLabel && <div className="review-actions"><button className="ok" onClick={() => review("ok")}>✓ Kopplingen stämmer</button><button onClick={() => review("text")}>Fel utställare/nummer</button><button onClick={() => review("position")}>Fel polygon/position</button></div>}
          </> : <div className="empty-inspector"><span>⌖</span><p>Tryck på en monter eller företags­etikett för att inspektera kopplingen.</p></div>}
          <div className="review-summary"><div><strong>{reviewCounts.ok}</strong><span>Godkända</span></div><div><strong>{reviewCounts.text}</strong><span>Datafel</span></div><div><strong>{reviewCounts.position}</strong><span>Positionsfel</span></div></div>
          <button className="export-button" disabled={Object.keys(reviews).length === 0} onClick={exportReviews}>Exportera granskning</button>
        </aside>}
      </section>
    </main>
  );
}
