"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import maplibregl, { Map as MapLibreMap, Marker } from "maplibre-gl";
import QRCode from "qrcode";

type View = "map" | "plan" | "calendar";
type Exhibitor = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  booths: string[];
  logoUrl: string | null;
};
type Feature = {
  id: string;
  geometry: { type: "Point" | "Polygon"; coordinates: unknown };
  properties: Record<string, unknown>;
};
type Collection = { type: "FeatureCollection"; features: Feature[] };
type Crew = { id: string; name: string; inviteCode: string; role: "owner" | "member" };
type PlanItem = { id: string; crewId: string; referenceId: string; kind: "exhibitor" | "event"; title: string; meta: string; startsAt: string | null; visited: boolean; visitedBy: string | null; visitedAt: string | null };
type BoothLocation = { stallId: string; booth: string; center: [number, number]; bounds: [[number, number], [number, number]]; markerIndex: number };
type ScheduleEvent = { id: string; title: string; category: string; interests: string[]; venue: string; start: string; end: string; localDate: string; localStart: string; localEnd: string; timezone: string; url: string };
type SearchMatch = { kind: "exhibitor"; item: Exhibitor; score: number } | { kind: "event"; item: ScheduleEvent; score: number };

const CENTER: [number, number] = [-88.56345, 43.97742];
const CALENDAR_DATES = [
  { value: "2026-07-18", day: "SAT", date: "18" }, { value: "2026-07-19", day: "SUN", date: "19" },
  { value: "2026-07-20", day: "MON", date: "20" }, { value: "2026-07-21", day: "TUE", date: "21" },
  { value: "2026-07-22", day: "WED", date: "22" }, { value: "2026-07-23", day: "THU", date: "23" },
  { value: "2026-07-24", day: "FRI", date: "24" }, { value: "2026-07-25", day: "SAT", date: "25" },
  { value: "2026-07-26", day: "SUN", date: "26" },
];

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [value]; }
  catch { return [value]; }
}

function Icon({ name }: { name: "map" | "plan" | "calendar" | "search" | "crew" | "location" | "close" | "check" }) {
  const paths = {
    map: <><path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2Z"/><path d="M8 4v13M16 7v13"/></>,
    plan: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    crew: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    location: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function Osh26App({ userName, signedIn }: { userName: string; signedIn: boolean }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const locationsByExhibitorRef = useRef<Map<string, BoothLocation[]>>(new Map());
  const highlightedStallsRef = useRef<string[]>([]);
  const highlightedMarkersRef = useRef<HTMLElement[]>([]);
  const highlightExhibitorRef = useRef<(item: Exhibitor, focusBooth?: string) => void>(() => undefined);
  const [view, setView] = useState<View>("map");
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [selected, setSelected] = useState<Exhibitor | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState("2026-07-20");
  const [eventCategory, setEventCategory] = useState("");
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [crew, setCrew] = useState<Crew | null>(null);
  const [crewModal, setCrewModal] = useState<"create" | "join" | "manage" | null>(null);
  const [draftCrewName, setDraftCrewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [crewError, setCrewError] = useState("");
  const [qrCode, setQrCode] = useState("");

  const searchMatches = useMemo<SearchMatch[]>(() => {
    const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const value = normalize(query.trim());
    if (!value) return [];
    const exhibitorMatches: SearchMatch[] = exhibitors.map((item) => {
      const name = normalize(item.name);
      const booths = item.booths.map(normalize);
      const tags = item.tags.map(normalize);
      const nameWords = name.split(/[^a-z0-9]+/);
      let score = 0;
      if (name === value) score = 1000;
      else if (booths.some((booth) => booth === value)) score = 950;
      else if (name.startsWith(value)) score = 900;
      else if (nameWords.some((word) => word.startsWith(value))) score = 850;
      else if (name.includes(value)) score = 750;
      else if (booths.some((booth) => booth.includes(value))) score = 700;
      else if (tags.some((tag) => tag === value)) score = 500;
      else if (tags.some((tag) => tag.startsWith(value))) score = 400;
      else if (tags.some((tag) => tag.includes(value))) score = 300;
      return { kind: "exhibitor" as const, item, score };
    }).filter((match) => match.score > 0);
    const eventMatches: SearchMatch[] = events.map((item) => {
      const title = normalize(item.title);
      const venue = normalize(item.venue);
      const category = normalize(item.category);
      const interests = item.interests.map(normalize);
      const titleWords = title.split(/[^a-z0-9]+/);
      let score = 0;
      if (title === value) score = 1000;
      else if (title.startsWith(value)) score = 920;
      else if (titleWords.some((word) => word.startsWith(value))) score = 870;
      else if (title.includes(value)) score = 800;
      else if (venue.includes(value)) score = 650;
      else if (category.startsWith(value)) score = 500;
      else if (interests.some((interest) => interest.includes(value))) score = 450;
      return { kind: "event" as const, item, score };
    }).filter((match) => match.score > 0);
    return [...exhibitorMatches, ...eventMatches].sort((a, b) => {
      const aLabel = a.kind === "event" ? a.item.title : a.item.name;
      const bLabel = b.kind === "event" ? b.item.title : b.item.name;
      return b.score - a.score || aLabel.localeCompare(bLabel);
    });
  }, [events, exhibitors, query]);
  const visibleResults = searchMatches.slice(0, 50);
  const plannedIds = useMemo(() => new Set(plan.map((item) => item.referenceId)), [plan]);
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const eventCategories = useMemo(() => Array.from(new Set(events.map((event) => event.category))).sort(), [events]);
  const scheduleForDate = useMemo(() => events.filter((event) => event.localDate === selectedDate && (!eventCategory || event.category === eventCategory)), [eventCategory, events, selectedDate]);
  const crewEventsForDate = useMemo(() => plan.filter((item) => item.kind === "event").map((item) => eventById.get(item.referenceId)).filter((event): event is ScheduleEvent => Boolean(event && event.localDate === selectedDate)).sort((a, b) => a.start.localeCompare(b.start)), [eventById, plan, selectedDate]);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/crew").then(async (response) => {
      if (!response.ok) throw new Error("Could not load your Crew");
      return response.json() as Promise<{ crew: Crew | null; items: PlanItem[] }>;
    }).then((data) => { setCrew(data.crew); setPlan(data.items); }).catch((error) => setCrewError(error instanceof Error ? error.message : "Could not load your Crew"));
  }, [signedIn]);

  useEffect(() => {
    fetch("/data/events.json").then((response) => response.json()).then((data: { events: ScheduleEvent[] }) => setEvents(data.events)).catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    queueMicrotask(() => {
      setJoinCode(code.toUpperCase().slice(0, 6));
      setCrewModal("join");
    });
  }, []);

  useEffect(() => {
    if (!crew || crewModal !== "manage") return;
    const inviteUrl = `${window.location.origin}/?join=${crew.inviteCode}`;
    QRCode.toDataURL(inviteUrl, { width: 220, margin: 1, color: { dark: "#102d2d", light: "#fffdf8" } }).then(setQrCode);
  }, [crew, crewModal]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      center: CENTER,
      zoom: 16.3,
      minZoom: 13,
      maxZoom: 21,
      attributionControl: false,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.65, "raster-contrast": -0.08, "raster-brightness-max": 0.96 } }],
      },
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", async () => {
      const [stallResponse, labelResponse, exhibitorResponse] = await Promise.all([
        fetch("/data/stalls.geojson"), fetch("/data/booth-labels.geojson"), fetch("/data/exhibitors.json"),
      ]);
      const stalls = await stallResponse.json() as Collection;
      const labelData = await labelResponse.json() as Collection;
      const exhibitorData = await exhibitorResponse.json() as { exhibitors: Exhibitor[] };
      setExhibitors(exhibitorData.exhibitors);
      map.addSource("stalls", { type: "geojson", data: stalls as never });
      map.addLayer({
        id: "stall-fill", type: "fill", source: "stalls",
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "highlighted"], false], "#ff4f32", ["boolean", ["feature-state", "planned"], false], "#168b82", "#f1b84b"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "highlighted"], false], 0.8, ["boolean", ["feature-state", "planned"], false], 0.62, 0.34],
        },
      });
      map.addLayer({ id: "stall-line", type: "line", source: "stalls", paint: { "line-color": ["case", ["boolean", ["feature-state", "highlighted"], false], "#c92f1c", "#72551e"], "line-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 3, ["interpolate", ["linear"], ["zoom"], 15, 0.45, 20, 1.2]] } });

      const stallsById = new Map(stalls.features.map((stall) => [String(stall.id), stall]));
      const markerMeta = labelData.features.map((feature) => {
        const stall = stallsById.get(String(feature.properties.stallId));
        const ring = stall?.geometry.type === "Polygon"
          ? (stall.geometry.coordinates as [number, number][][])[0]
          : [feature.geometry.coordinates as [number, number]];
        const bounds = ring.reduce((result, coordinate) => ({
          minX: Math.min(result.minX, coordinate[0]),
          maxX: Math.max(result.maxX, coordinate[0]),
          minY: Math.min(result.minY, coordinate[1]),
          maxY: Math.max(result.maxY, coordinate[1]),
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        const center: [number, number] = Number.isFinite(bounds.minX)
          ? [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]
          : feature.geometry.coordinates as [number, number];
        const normalizedBounds: [[number, number], [number, number]] = Number.isFinite(bounds.minX)
          ? [[bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]]
          : [center, center];
        return { feature, ring, center, bounds: normalizedBounds };
      });

      const locationsByExhibitor = new Map<string, BoothLocation[]>();
      markerMeta.forEach(({ feature, center, bounds }, markerIndex) => {
        const location = { stallId: String(feature.properties.stallId), booth: String(feature.properties.boothNumber || ""), center, bounds, markerIndex };
        stringArray(feature.properties.exhibitorIds).forEach((id) => locationsByExhibitor.set(id, [...(locationsByExhibitor.get(id) || []), location]));
      });
      locationsByExhibitorRef.current = locationsByExhibitor;

      markersRef.current = markerMeta.map(({ feature, center }) => {
        const element = document.createElement("button");
        element.className = "booth-label";
        const name = String(feature.properties.displayName || "");
        const booth = String(feature.properties.boothNumber || "");
        element.textContent = booth;
        element.title = `${name} · Booth ${booth}`;
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const ids = stringArray(feature.properties.exhibitorIds);
          const match = exhibitorData.exhibitors.find((item) => ids.includes(item.id));
          if (match) highlightExhibitorRef.current(match);
        });
        return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(center).addTo(map);
      });
      const updateLabels = () => {
        const zoom = map.getZoom();
        markerMeta.forEach(({ feature, ring }, index) => {
          const element = markersRef.current[index]?.getElement();
          if (!element) return;
          const projected = ring.map((coordinate) => map.project(coordinate));
          const pixelArea = projected.length > 1
            ? (Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x)))
              * (Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y)))
            : 0;
          const highlighted = element.classList.contains("search-highlight");
          const full = highlighted || zoom >= 18.5 || pixelArea >= 1800;
          element.classList.toggle("full-label", full);
          element.textContent = full
            ? `${String(feature.properties.displayName || feature.properties.boothNumber)} · ${String(feature.properties.boothNumber || "")}`
            : String(feature.properties.boothNumber || "");
          element.hidden = !highlighted && (zoom < 15.6 || (!full && pixelArea < 70));
        });
      };
      map.on("zoomend", updateLabels);
      updateLabels();
      map.on("click", "stall-fill", (event) => {
        const ids = stringArray(event.features?.[0]?.properties?.exhibitorIds);
        const match = exhibitorData.exhibitors.find((item) => ids.includes(item.id));
        if (match) highlightExhibitorRef.current(match);
      });
      map.on("mouseenter", "stall-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "stall-fill", () => { map.getCanvas().style.cursor = ""; });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => { markersRef.current.forEach((marker) => marker.remove()); map.remove(); mapRef.current = null; };
  }, []);

  function clearHighlight() {
    const map = mapRef.current;
    if (map?.getSource("stalls")) highlightedStallsRef.current.forEach((id) => map.setFeatureState({ source: "stalls", id }, { highlighted: false }));
    highlightedMarkersRef.current.forEach((element) => element.classList.remove("search-highlight"));
    highlightedStallsRef.current = [];
    highlightedMarkersRef.current = [];
  }

  function highlightExhibitor(item: Exhibitor, focusBooth?: string) {
    const map = mapRef.current;
    setSelected(item);
    if (!map || !map.getSource("stalls")) return;
    clearHighlight();
    const locations = locationsByExhibitorRef.current.get(item.id) || [];
    locations.forEach((location) => {
      map.setFeatureState({ source: "stalls", id: location.stallId }, { highlighted: true });
      const element = markersRef.current[location.markerIndex]?.getElement();
      if (element) { element.classList.add("search-highlight"); highlightedMarkersRef.current.push(element); }
    });
    highlightedStallsRef.current = locations.map((location) => location.stallId);
    const focused = focusBooth ? locations.find((location) => location.booth === focusBooth) : undefined;
    if (focused || locations.length === 1) {
      map.flyTo({ center: (focused || locations[0]).center, zoom: Math.max(map.getZoom(), 18.6), duration: 700 });
      return;
    }
    if (locations.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      locations.forEach((location) => { bounds.extend(location.bounds[0]); bounds.extend(location.bounds[1]); });
      const mobile = window.innerWidth <= 760;
      map.fitBounds(bounds, { padding: mobile ? { top: 150, right: 45, bottom: 270, left: 45 } : { top: 110, right: 90, bottom: 210, left: 90 }, maxZoom: 18.4, duration: 750 });
    }
  }

  function selectExhibitor(item: Exhibitor) {
    setQuery("");
    highlightExhibitor(item);
    setView("map");
  }

  function selectScheduleEvent(item: ScheduleEvent) {
    setQuery("");
    clearHighlight();
    setSelected(null);
    setSelectedEvent(item);
    setSelectedDate(item.localDate);
    setView("calendar");
  }

  useEffect(() => { highlightExhibitorRef.current = highlightExhibitor; });

  function closeSelection() {
    clearHighlight();
    setSelected(null);
  }

  function addToPlan(item: Exhibitor) {
    if (!crew) { setCrewModal("create"); return; }
    if (plannedIds.has(item.id)) return;
    setSaving(true);
    fetch("/api/crew/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", crewId: crew.id, kind: "exhibitor", referenceId: item.id, title: item.name, meta: `Booth ${item.booths.join(", ")}` }) })
      .then(async (response) => { if (!response.ok) throw new Error("Could not add this exhibitor"); return response.json() as Promise<{ item: PlanItem }>; })
      .then((data) => setPlan((current) => current.some((entry) => entry.id === data.item.id) ? current : [...current, data.item]))
      .catch((error) => setCrewError(error instanceof Error ? error.message : "Could not update the Crew Plan"))
      .finally(() => setSaving(false));
  }

  function addEventToPlan(item: ScheduleEvent) {
    if (!crew) { setCrewModal("create"); return; }
    if (plannedIds.has(item.id)) return;
    setSaving(true);
    fetch("/api/crew/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        crewId: crew.id,
        kind: "event",
        referenceId: item.id,
        title: item.title,
        meta: `${item.localStart}–${item.localEnd} · ${item.venue}`,
        startsAt: item.start,
      }),
    })
      .then(async (response) => { if (!response.ok) throw new Error("Could not add this event"); return response.json() as Promise<{ item: PlanItem }>; })
      .then((data) => setPlan((current) => current.some((entry) => entry.id === data.item.id) ? current : [...current, data.item]))
      .catch((error) => setCrewError(error instanceof Error ? error.message : "Could not update the Crew Calendar"))
      .finally(() => setSaving(false));
  }

  async function createCrew() {
    const name = draftCrewName.trim();
    if (!name) return;
    if (!signedIn) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    setSaving(true); setCrewError("");
    try {
      const response = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name }) });
      const data = await response.json() as { crew?: Crew; items?: PlanItem[]; error?: string };
      if (!response.ok || !data.crew) throw new Error(data.error || "Could not create the Crew");
      setCrew(data.crew); setPlan(data.items || []); setCrewModal("manage"); setDraftCrewName("");
    } catch (error) { setCrewError(error instanceof Error ? error.message : "Could not create the Crew"); }
    finally { setSaving(false); }
  }

  async function joinCrew() {
    if (joinCode.trim().length < 4) return;
    if (!signedIn) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    setSaving(true); setCrewError("");
    try {
      const response = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", code: joinCode }) });
      const data = await response.json() as { crew?: Crew; items?: PlanItem[]; error?: string };
      if (!response.ok || !data.crew) throw new Error(data.error || "Could not join the Crew");
      setCrew(data.crew); setPlan(data.items || []); setCrewModal(null); setJoinCode("");
    } catch (error) { setCrewError(error instanceof Error ? error.message : "Could not join the Crew"); }
    finally { setSaving(false); }
  }

  async function toggleVisited(item: PlanItem) {
    if (!crew) return;
    const visited = !item.visited;
    setPlan((current) => current.map((entry) => entry.id === item.id ? { ...entry, visited } : entry));
    try {
      const response = await fetch("/api/crew/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggleVisited", crewId: crew.id, itemId: item.id, visited }) });
      const data = await response.json() as { item?: PlanItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || "Could not update Visited status");
      setPlan((current) => current.map((entry) => entry.id === item.id ? data.item! : entry));
    } catch (error) {
      setPlan((current) => current.map((entry) => entry.id === item.id ? item : entry));
      setCrewError(error instanceof Error ? error.message : "Could not update Visited status");
    }
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(({ coords }) => mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 18, duration: 700 }));
  }

  const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const activeDate = CALENDAR_DATES.find((date) => date.value === selectedDate) || CALENDAR_DATES[2];
  const fullDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`)).toUpperCase();

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="logo">26</div>
        <nav>{(["map", "plan", "calendar"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><Icon name={item} /><span>{item === "plan" ? "Crew Plan" : item[0].toUpperCase() + item.slice(1)}</span>{item === "plan" && plan.length > 0 && <b>{plan.length}</b>}</button>)}</nav>
        <button className="avatar" title={userName}>{initials || "GP"}</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><div className="logo">26</div><strong>OSH26</strong></div>
          <button className="crew-switcher" onClick={() => setCrewModal(crew ? "manage" : "create")}><Icon name="crew"/><span><small>YOUR CREW</small><strong>{crew?.name || "Create or join a Crew"}</strong></span><em>⌄</em></button>
          <div className="search-box"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exhibitors, events or categories" aria-label="Search" />{query && <button onClick={() => setQuery("")}><Icon name="close"/></button>}
            {visibleResults.length > 0 && <div className="search-menu"><div className="search-scroll">{visibleResults.map((match) => match.kind === "exhibitor"
              ? <button key={`exhibitor-${match.item.id}`} onClick={() => selectExhibitor(match.item)}><span><strong>{match.item.name}</strong><small>{match.item.tags.slice(0, 2).join(" · ") || "Exhibitor"}</small></span><b>{match.item.booths.join(", ")}</b></button>
              : <button key={`event-${match.item.id}`} onClick={() => selectScheduleEvent(match.item)}><span><strong>{match.item.title}</strong><small>{match.item.category} · {match.item.venue}</small></span><b className="event-result-time">{match.item.localDate.slice(5).replace("-", "/")} · {match.item.localStart}</b></button>)}</div><div className="search-count">{searchMatches.length > visibleResults.length ? `Showing ${visibleResults.length} of ${searchMatches.length} results` : `${searchMatches.length} result${searchMatches.length === 1 ? "" : "s"}`}</div></div>}
          </div>
          <div className="status-pill"><i /> Offline ready</div>
        </header>

        <div className={`view map-view ${view === "map" ? "visible" : ""}`}>
          <div ref={mapContainer} className="map" />
          {!mapReady && <div className="map-loading"><span/><strong>Preparing the AirVenture map…</strong></div>}
          <div className="map-title"><small>AIRVENTURE 2026</small><h1>Explore the grounds</h1><p>Find exhibitors and build a shared plan with your Crew.</p></div>
          <button className="locate" onClick={locate} aria-label="Show my location"><Icon name="location"/></button>
          {selected && <article className="place-card">
            <button className="close-card" onClick={closeSelection} aria-label="Close"><Icon name="close"/></button>
            <div className="place-kicker">EXHIBITOR · BOOTH {selected.booths.join(", ")}</div>
            <h2>{selected.name}</h2>
            {selected.booths.length > 1 && <div className="booth-jumps"><small>SHOW BOOTH</small><div>{selected.booths.map((booth) => <button key={booth} onClick={() => highlightExhibitor(selected, booth)}>{booth}</button>)}</div></div>}
            <div className="chips">{selected.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
            {selected.description && <p>{selected.description}</p>}
            <button disabled={saving} className={plannedIds.has(selected.id) ? "primary added" : "primary"} onClick={() => addToPlan(selected)}>{plannedIds.has(selected.id) ? <><Icon name="check"/> Added to Crew Plan</> : "+ Add to Crew Plan"}</button>
          </article>}
        </div>

        <div className={`view content-view ${view === "plan" ? "visible" : ""}`}>
          <div className="content-header"><div><span>SHARED WITH YOUR CREW</span><h1>Crew Plan</h1><p>Everything your Crew wants to see, in one place.</p></div><button className="primary compact" onClick={() => setView("map")}>+ Add places</button></div>
          {!crew ? <Empty icon="crew" title="Create a Crew to start planning" text="Invite friends and build one shared list for AirVenture." action="Create Crew" onAction={() => setCrewModal("create")} secondary="Join with a code" onSecondary={() => setCrewModal("join")} />
          : plan.length === 0 ? <Empty icon="plan" title="Your Crew Plan is empty" text="Explore the map and add exhibitors or scheduled events." action="Explore the map" onAction={() => setView("map")} />
          : <div className="plan-list">{plan.map((item) => <article key={item.id} className={item.visited ? "visited" : ""}><button className="check-button" onClick={() => toggleVisited(item)} aria-label={item.visited ? "Mark as not visited" : "Mark as visited"}>{item.visited && <Icon name="check"/>}</button><div><small>{item.kind}</small><h2>{item.title}</h2><p>{item.meta}</p></div><span className="shared-status">{item.visited ? "Visited by Crew" : "Planned"}</span></article>)}</div>}
        </div>

        <div className={`view content-view ${view === "calendar" ? "visible" : ""}`}>
          <div className="content-header"><div><span>{fullDay} · JULY {activeDate.date}</span><h1>Crew Calendar</h1><p>Choose from the official AirVenture schedule and plan together.</p></div><button className="date-button" onClick={() => { setSelectedDate("2026-07-20"); setSelectedEvent(null); }}>Opening day</button></div>
          <div className="calendar-strip">{CALENDAR_DATES.map((date) => <button key={date.value} className={date.value === selectedDate ? "active" : ""} onClick={() => { setSelectedDate(date.value); setSelectedEvent(null); }}><small>{date.day}</small><strong>{date.date}</strong></button>)}</div>

          {selectedEvent && <article className="event-detail">
            <button className="close-card" onClick={() => setSelectedEvent(null)} aria-label="Close"><Icon name="close"/></button>
            <div className="place-kicker">{selectedEvent.category} · {selectedEvent.localStart}–{selectedEvent.localEnd}</div>
            <h2>{selectedEvent.title}</h2>
            <p className="event-venue">{selectedEvent.venue}</p>
            <div className="chips">{selectedEvent.interests.map((interest) => <span key={interest}>{interest}</span>)}</div>
            <div className="event-detail-actions"><a href={selectedEvent.url} target="_blank" rel="noreferrer">Official listing ↗</a><button disabled={saving} className={plannedIds.has(selectedEvent.id) ? "primary added" : "primary"} onClick={() => addEventToPlan(selectedEvent)}>{plannedIds.has(selectedEvent.id) ? <><Icon name="check"/> Added to Crew Plan</> : "+ Add to Crew Plan"}</button></div>
          </article>}

          <section className="calendar-section crew-schedule">
            <div className="calendar-section-head"><div><small>SHARED PLAN</small><h2>Your Crew&apos;s day</h2></div><b>{crewEventsForDate.length}</b></div>
            {crewEventsForDate.length === 0 ? <div className="calendar-empty"><Icon name="calendar"/><span><strong>No Crew events on this day</strong><small>Add an event from the official schedule below.</small></span></div>
              : <div className="schedule-list crew-event-list">{crewEventsForDate.map((event) => <button key={event.id} className="schedule-event" onClick={() => setSelectedEvent(event)}><time>{event.localStart}</time><span><strong>{event.title}</strong><small>{event.category} · {event.venue}</small></span><b>Planned</b></button>)}</div>}
          </section>

          <section className="calendar-section official-schedule">
            <div className="calendar-section-head"><div><small>AIRVENTURE 2026</small><h2>Official schedule</h2></div><label>Category<select value={eventCategory} onChange={(event) => setEventCategory(event.target.value)}><option value="">All categories</option>{eventCategories.map((category) => <option key={category}>{category}</option>)}</select></label></div>
            <p className="schedule-count">{scheduleForDate.length} event{scheduleForDate.length === 1 ? "" : "s"} on this day</p>
            <div className="schedule-list">{scheduleForDate.map((event) => <button key={event.id} className="schedule-event" onClick={() => setSelectedEvent(event)}><time>{event.localStart}<small>{event.localEnd}</small></time><span><strong>{event.title}</strong><small>{event.category} · {event.venue}</small></span><b className={plannedIds.has(event.id) ? "planned" : ""} onClick={(click) => { click.stopPropagation(); addEventToPlan(event); }}>{plannedIds.has(event.id) ? "✓ Added" : "+ Add"}</b></button>)}</div>
          </section>
        </div>
      </section>

      <nav className="bottom-nav">{(["map", "plan", "calendar"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><Icon name={item}/><span>{item === "plan" ? "Crew Plan" : item[0].toUpperCase() + item.slice(1)}</span>{item === "plan" && plan.length > 0 && <b>{plan.length}</b>}</button>)}</nav>

      {crewModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCrewModal(null); }}><section className="crew-modal"><button className="modal-close" onClick={() => setCrewModal(null)}><Icon name="close"/></button><div className="modal-icon"><Icon name="crew"/></div>{crewModal === "create" ? <><span>START PLANNING TOGETHER</span><h1>Create a Crew</h1><p>Name your Crew now. You will get an invite code and QR code to share with friends.</p><label>Crew name<input autoFocus value={draftCrewName} onChange={(event) => setDraftCrewName(event.target.value)} placeholder="e.g. Nordic Flyers" onKeyDown={(event) => { if (event.key === "Enter") createCrew(); }}/></label>{crewError && <p className="form-error">{crewError}</p>}<button className="primary" disabled={saving || !draftCrewName.trim()} onClick={createCrew}>{saving ? "Creating…" : "Create Crew"}</button><button className="text-button" onClick={() => { setCrewError(""); setCrewModal("join"); }}>I have an invite code</button></> : crewModal === "join" ? <><span>JOIN YOUR FRIENDS</span><h1>Join a Crew</h1><p>Enter the six-character invite code shared by a Crew member.</p><label>Invite code<input autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} placeholder="OSH26X" onKeyDown={(event) => { if (event.key === "Enter") joinCrew(); }}/></label>{crewError && <p className="form-error">{crewError}</p>}<button className="primary" disabled={saving || joinCode.trim().length < 4} onClick={joinCrew}>{saving ? "Joining…" : "Join Crew"}</button><button className="text-button" onClick={() => { setCrewError(""); setCrewModal("create"); }}>Create a new Crew instead</button></> : crew ? <><span>INVITE CREW MEMBERS</span><h1>{crew.name}</h1><p>Share this invite code or let a friend scan the QR code.</p>{qrCode && <Image unoptimized className="invite-qr" width={180} height={180} src={qrCode} alt={`QR code to join ${crew.name}`} />}<div className="invite-code"><small>INVITE CODE</small><strong>{crew.inviteCode}</strong></div><button className="primary" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?join=${crew.inviteCode}`)}>Copy invite link</button></> : null}</section></div>}

      {!signedIn && <a className="signin-notice" href="/signin-with-chatgpt?return_to=%2F">Sign in to save and share your Crew →</a>}
    </main>
  );
}

function Empty({ icon, title, text, action, onAction, secondary, onSecondary }: { icon: "crew" | "plan" | "calendar"; title: string; text: string; action: string; onAction: () => void; secondary?: string; onSecondary?: () => void }) {
  return <section className="empty-state"><div><Icon name={icon}/></div><h2>{title}</h2><p>{text}</p><button className="primary compact" onClick={onAction}>{action}</button>{secondary && <button className="text-button" onClick={onSecondary}>{secondary}</button>}</section>;
}
