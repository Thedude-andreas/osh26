"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import maplibregl, { Map as MapLibreMap, Marker } from "maplibre-gl";
import QRCode from "qrcode";

type View = "map" | "plan" | "calendar" | "settings";
type LocationMode = "off" | "request" | "tracking";
type Basemap = "osm" | "ortho";
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
type CrewMember = { userEmail: string; displayName: string };
type PlanItem = { id: string; crewId: string; referenceId: string; kind: "exhibitor" | "event"; title: string; meta: string; startsAt: string | null; visited: boolean; visitedBy: string | null; visitedAt: string | null; addedBy: string; createdAt?: string };
type BoothLocation = { stallId: string; booth: string; center: [number, number]; bounds: [[number, number], [number, number]]; markerIndex: number };
type ScheduleEvent = { id: string; title: string; category: string; interests: string[]; venue: string; start: string; end: string; localDate: string; localStart: string; localEnd: string; timezone: string; url: string };
type SearchMatch = { kind: "exhibitor"; item: Exhibitor; score: number } | { kind: "event"; item: ScheduleEvent; score: number };
type VenueRegistryEntry = { name: string; eventCount: number; status: "matched" | "unmatched"; source: string | null; sourceName?: string; coordinates: [number, number] | null; booths?: string[] };
type VenuePlacement = { venueName: string; longitude: number; latitude: number; placedBy: string; updatedAt: string };
type VenueReport = { id: string; venueName: string; currentLongitude: number; currentLatitude: number; proposedLongitude: number; proposedLatitude: number; note: string; status: "pending" | "approved" | "rejected"; reportedBy: string; createdAt: string };
type CrewLocationRequest = { id: string; crewId: string; requestedBy: string; requestedByName: string; createdAt: string };
type CrewLocationSample = { id: string; crewId: string; userEmail: string; displayName: string; kind: "request" | "tracking"; requestId: string | null; longitude: number; latitude: number; accuracy: number; capturedAt: string };

const CENTER: [number, number] = [-88.56345, 43.97742];
const CALENDAR_DATES = [
  { value: "2026-07-18", day: "SAT", date: "18" }, { value: "2026-07-19", day: "SUN", date: "19" },
  { value: "2026-07-20", day: "MON", date: "20" }, { value: "2026-07-21", day: "TUE", date: "21" },
  { value: "2026-07-22", day: "WED", date: "22" }, { value: "2026-07-23", day: "THU", date: "23" },
  { value: "2026-07-24", day: "FRI", date: "24" }, { value: "2026-07-25", day: "SAT", date: "25" },
  { value: "2026-07-26", day: "SUN", date: "26" },
];

type TimelinePlacement = { event: ScheduleEvent; start: number; end: number; column: number; columns: number };

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function seriesKey(event: ScheduleEvent) {
  return `${event.title.trim().toLocaleLowerCase()}\u0000${event.category}\u0000${event.venue}`;
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function buildTimeline(events: ScheduleEvent[]) {
  const entries = events.map((event) => {
    const start = minutesFromTime(event.localStart);
    let end = minutesFromTime(event.localEnd);
    if (end <= start) end += 24 * 60;
    return { event, start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const earliest = entries.length ? Math.min(...entries.map((entry) => entry.start)) : 7 * 60;
  const latest = entries.length ? Math.max(...entries.map((entry) => entry.end)) : 22 * 60;
  const startMinute = Math.min(7 * 60, Math.floor(earliest / 60) * 60);
  const endMinute = Math.max(22 * 60, Math.ceil(latest / 60) * 60);
  const placements: TimelinePlacement[] = [];
  let group: typeof entries = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const columnEnds: number[] = [];
    const assigned = group.map((entry) => {
      let column = columnEnds.findIndex((end) => end <= entry.start);
      if (column < 0) { column = columnEnds.length; columnEnds.push(entry.end); }
      else columnEnds[column] = entry.end;
      return { ...entry, column };
    });
    assigned.forEach((entry) => placements.push({ ...entry, columns: columnEnds.length }));
    group = [];
    groupEnd = -1;
  };
  entries.forEach((entry) => {
    if (group.length && entry.start >= groupEnd) flush();
    group.push(entry);
    groupEnd = Math.max(groupEnd, entry.end);
  });
  flush();
  return {
    placements,
    startMinute,
    endMinute,
    hours: Array.from({ length: (endMinute - startMinute) / 60 + 1 }, (_, index) => startMinute + index * 60),
    height: (endMinute - startMinute) * 0.9,
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [value]; }
  catch { return [value]; }
}

function Icon({ name }: { name: "map" | "plan" | "calendar" | "search" | "crew" | "location" | "close" | "check" | "repeat" | "trash" | "settings" }) {
  const paths = {
    map: <><path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2Z"/><path d="M8 4v13M16 7v13"/></>,
    plan: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    crew: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    location: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    repeat: <><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.36.48.7.82.9.34.2.72.3 1.1.3H21v4h-.1a1.7 1.7 0 0 0-1.5.8Z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function Osh26App({ userName, signedIn, isAdmin }: { userName: string; signedIn: boolean; isAdmin: boolean }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const venueMarkersRef = useRef<Marker[]>([]);
  const crewLocationMarkersRef = useRef<Marker[]>([]);
  const placementDraftMarkerRef = useRef<Marker | null>(null);
  const locationsByExhibitorRef = useRef<Map<string, BoothLocation[]>>(new Map());
  const highlightedStallsRef = useRef<string[]>([]);
  const highlightedMarkersRef = useRef<HTMLElement[]>([]);
  const highlightExhibitorRef = useRef<(item: Exhibitor, focusBooth?: string) => void>(() => undefined);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRemovalRef = useRef<PlanItem | null>(null);
  const placementModeRef = useRef(false);
  const locationModeRef = useRef<LocationMode>("off");
  const lastAnsweredRequestRef = useRef("");
  const trackingWatchRef = useRef<number | null>(null);
  const lastTrackingSentAtRef = useRef(0);
  const selectedVenueRef = useRef("");
  const [view, setView] = useState<View>("map");
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [venueRegistry, setVenueRegistry] = useState<VenueRegistryEntry[]>([]);
  const [manualVenuePlacements, setManualVenuePlacements] = useState<VenuePlacement[]>([]);
  const [placementMode, setPlacementMode] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedVenueName, setSelectedVenueName] = useState("");
  const [placementDraft, setPlacementDraft] = useState<[number, number] | null>(null);
  const [venueReports, setVenueReports] = useState<VenueReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [venueNotice, setVenueNotice] = useState("");
  const [mapVenueName, setMapVenueName] = useState("");
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueError, setVenueError] = useState("");
  const [locationMode, setLocationMode] = useState<LocationMode>("off");
  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [crewLocationSamples, setCrewLocationSamples] = useState<CrewLocationSample[]>([]);
  const [crewLocationRequest, setCrewLocationRequest] = useState<CrewLocationRequest | null>(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationNotice, setLocationNotice] = useState("");
  const [selected, setSelected] = useState<Exhibitor | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState("2026-07-20");
  const [calendarMode, setCalendarMode] = useState<"crew" | "all">("crew");
  const [eventCategory, setEventCategory] = useState("");
  const [eventVenue, setEventVenue] = useState("");
  const [seriesExpanded, setSeriesExpanded] = useState(false);
  const [expandedSeriesKey, setExpandedSeriesKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<PlanItem | null>(null);
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
  const plannedItemByReference = useMemo(() => new Map(plan.map((item) => [item.referenceId, item])), [plan]);
  const crewMemberNames = useMemo(() => new Map(crewMembers.map((member) => [member.userEmail.toLocaleLowerCase(), member.displayName])), [crewMembers]);
  const crewPlan = useMemo(() => plan.filter((item) => item.kind === "exhibitor"), [plan]);
  const crewCalendarItems = useMemo(() => plan.filter((item) => item.kind === "event"), [plan]);
  const exhibitorById = useMemo(() => new Map(exhibitors.map((exhibitor) => [exhibitor.id, exhibitor])), [exhibitors]);
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const eventCategories = useMemo(() => Array.from(new Set(events.map((event) => event.category))).sort(), [events]);
  const eventVenues = useMemo(() => Array.from(new Set(events.map((event) => event.venue).filter(Boolean))).sort(), [events]);
  const eventSeries = useMemo(() => {
    const groups = new Map<string, ScheduleEvent[]>();
    events.forEach((event) => {
      const key = seriesKey(event);
      groups.set(key, [...(groups.get(key) || []), event]);
    });
    groups.forEach((instances) => instances.sort((a, b) => a.start.localeCompare(b.start)));
    return groups;
  }, [events]);
  const scheduleForDate = useMemo(() => events.filter((event) => event.localDate === selectedDate && (!eventCategory || event.category === eventCategory) && (!eventVenue || event.venue === eventVenue)), [eventCategory, eventVenue, events, selectedDate]);
  const crewEventsForDate = useMemo(() => crewCalendarItems.map((item) => eventById.get(item.referenceId)).filter((event): event is ScheduleEvent => Boolean(event && event.localDate === selectedDate && (!eventCategory || event.category === eventCategory) && (!eventVenue || event.venue === eventVenue))).sort((a, b) => a.start.localeCompare(b.start)), [crewCalendarItems, eventById, eventCategory, eventVenue, selectedDate]);
  const selectedSeries = useMemo(() => {
    if (!selectedEvent) return [];
    return eventSeries.get(seriesKey(selectedEvent)) || [selectedEvent];
  }, [eventSeries, selectedEvent]);
  const timeline = useMemo(() => buildTimeline(crewEventsForDate), [crewEventsForDate]);
  const manualVenueByName = useMemo(() => new Map(manualVenuePlacements.map((placement) => [placement.venueName, placement])), [manualVenuePlacements]);
  const effectiveVenues = useMemo(() => venueRegistry.map((venue) => {
    const manual = manualVenueByName.get(venue.name);
    return manual ? { ...venue, status: "matched" as const, source: "manual", coordinates: [manual.longitude, manual.latitude] as [number, number] } : venue;
  }), [manualVenueByName, venueRegistry]);
  const venueByName = useMemo(() => new Map(effectiveVenues.map((venue) => [venue.name, venue])), [effectiveVenues]);
  const selectedVenue = venueByName.get(selectedVenueName) || null;
  const selectedReport = venueReports.find((report) => report.id === selectedReportId) || null;
  const latestCrewLocations = useMemo(() => {
    const latest = new Map<string, CrewLocationSample>();
    crewLocationSamples.forEach((sample) => {
      const current = latest.get(sample.userEmail);
      if (!current || current.capturedAt < sample.capturedAt) latest.set(sample.userEmail, sample);
    });
    return Array.from(latest.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [crewLocationSamples]);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/crew").then(async (response) => {
      if (!response.ok) throw new Error("Could not load your Crew");
      return response.json() as Promise<{ crew: Crew | null; items: PlanItem[]; members?: CrewMember[] }>;
    }).then((data) => { setCrew(data.crew); setPlan(data.items); setCrewMembers(data.members || []); }).catch((error) => setCrewError(error instanceof Error ? error.message : "Could not load your Crew"));
  }, [signedIn]);

  useEffect(() => {
    fetch("/data/events.json").then((response) => response.json()).then((data: { events: ScheduleEvent[] }) => setEvents(data.events)).catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/venue-reports").then((response) => response.ok ? response.json() : { reports: [] })
      .then((data: { reports: VenueReport[] }) => setVenueReports(data.reports))
      .catch(() => setVenueReports([]));
  }, [isAdmin]);

  useEffect(() => {
    Promise.all([
      fetch("/data/event-venues.json").then((response) => response.json()) as Promise<{ venues: VenueRegistryEntry[] }>,
      fetch("/api/venues").then((response) => response.ok ? response.json() : { placements: [] }) as Promise<{ placements: VenuePlacement[] }>,
    ]).then(([registry, manual]) => { setVenueRegistry(registry.venues); setManualVenuePlacements(manual.placements); }).catch(() => setVenueError("Could not load venue placements"));
  }, []);

  useEffect(() => { placementModeRef.current = placementMode; }, [placementMode]);
  useEffect(() => { locationModeRef.current = locationMode; }, [locationMode]);
  useEffect(() => { selectedVenueRef.current = selectedVenueName; }, [selectedVenueName]);

  useEffect(() => {
    const stored = window.localStorage.getItem("osh26-basemap");
    if (stored === "osm" || stored === "ortho") queueMicrotask(() => setBasemap(stored));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void loadLocationState();
    const timer = window.setInterval(() => { void loadLocationState(); }, 10_000);
    return () => window.clearInterval(timer);
    // loadLocationState intentionally reads the latest mode through a ref while polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, crew?.id]);

  useEffect(() => {
    if (!signedIn || !crew || locationMode !== "tracking" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastTrackingSentAtRef.current < 15_000) return;
      lastTrackingSentAtRef.current = Date.now();
      void publishPosition(position);
    }, (error) => setLocationError(error.message || "Location permission is required for tracking"), {
      enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000,
    });
    trackingWatchRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      trackingWatchRef.current = null;
    };
  }, [crew, locationMode, signedIn]);

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
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
          ortho: { type: "raster", tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, attribution: "Tiles © Esri" },
        },
        layers: [
          { id: "base-osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.65, "raster-contrast": -0.08, "raster-brightness-max": 0.96 } },
          { id: "base-ortho", type: "raster", source: "ortho", layout: { visibility: "none" } },
        ],
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
          "fill-outline-color": "#493718",
        },
      });
      map.addLayer({
        id: "stall-line", type: "line", source: "stalls", layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#493718",
          "line-opacity": 0.96,
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.35, 16, 1.8, 20, 2.5],
        },
      });
      map.addLayer({
        id: "stall-highlight-line", type: "line", source: "stalls", layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#b82f1d",
          "line-opacity": ["case", ["boolean", ["feature-state", "highlighted"], false], 1, 0],
          "line-width": 3.8,
        },
      });
      map.addSource("crew-tracks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "crew-tracks", type: "line", source: "crew-tracks", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.82 },
      });

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
          if (placementModeRef.current) return;
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
        if (placementModeRef.current) return;
        const ids = stringArray(event.features?.[0]?.properties?.exhibitorIds);
        const match = exhibitorData.exhibitors.find((item) => ids.includes(item.id));
        if (match) highlightExhibitorRef.current(match);
      });
      map.on("mouseenter", "stall-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "stall-fill", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", (event) => {
        if (!placementModeRef.current || !selectedVenueRef.current) return;
        setPlacementDraft([event.lngLat.lng, event.lngLat.lat]);
      });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => { markersRef.current.forEach((marker) => marker.remove()); venueMarkersRef.current.forEach((marker) => marker.remove()); crewLocationMarkersRef.current.forEach((marker) => marker.remove()); placementDraftMarkerRef.current?.remove(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map.getLayer("base-osm") || !map.getLayer("base-ortho")) return;
    map.setLayoutProperty("base-osm", "visibility", basemap === "osm" ? "visible" : "none");
    map.setLayoutProperty("base-ortho", "visibility", basemap === "ortho" ? "visible" : "none");
  }, [basemap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    crewLocationMarkersRef.current.forEach((marker) => marker.remove());
    crewLocationMarkersRef.current = [];
    const byMember = new Map<string, CrewLocationSample[]>();
    crewLocationSamples.forEach((sample) => byMember.set(sample.userEmail, [...(byMember.get(sample.userEmail) || []), sample]));
    const colors = ["#65408e", "#167c78", "#c64b34", "#2f65a7", "#9a6c1e", "#b33b76"];
    const trackFeatures: Array<Record<string, unknown>> = [];
    Array.from(byMember.entries()).forEach(([email, samples], memberIndex) => {
      const color = colors[memberIndex % colors.length];
      const ordered = [...samples].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      const tracking = ordered.filter((sample) => sample.kind === "tracking");
      if (tracking.length > 1) trackFeatures.push({
        type: "Feature", properties: { color, email },
        geometry: { type: "LineString", coordinates: tracking.map((sample) => [sample.longitude, sample.latitude]) },
      });
      const latest = ordered[ordered.length - 1];
      const element = document.createElement("button");
      element.className = "crew-location-marker";
      element.style.setProperty("--member-color", color);
      const dot = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = latest.displayName;
      element.append(dot, label);
      element.title = `${latest.displayName} · ${new Date(latest.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      element.addEventListener("click", () => map.flyTo({ center: [latest.longitude, latest.latitude], zoom: Math.max(map.getZoom(), 18), duration: 500 }));
      crewLocationMarkersRef.current.push(new maplibregl.Marker({ element, anchor: "center" }).setLngLat([latest.longitude, latest.latitude]).addTo(map));
    });
    const source = map.getSource("crew-tracks") as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: trackFeatures } as never);
    return () => { crewLocationMarkersRef.current.forEach((marker) => marker.remove()); crewLocationMarkersRef.current = []; };
  }, [crewLocationSamples, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    venueMarkersRef.current.forEach((marker) => marker.remove());
    venueMarkersRef.current = effectiveVenues.filter((venue) => venue.coordinates).map((venue) => {
      const element = document.createElement("button");
      element.className = `venue-marker${venue.name === mapVenueName || venue.name === selectedVenueName ? " selected" : ""}`;
      element.title = venue.name;
      const dot = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = venue.name;
      element.append(dot, label);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (placementModeRef.current) return;
        setMapVenueName(venue.name);
        map.flyTo({ center: venue.coordinates!, zoom: Math.max(map.getZoom(), 17.4), duration: 600 });
      });
      return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(venue.coordinates!).addTo(map);
    });
    const updateVenueLabels = () => venueMarkersRef.current.forEach((marker) => marker.getElement().classList.toggle("show-label", map.getZoom() >= 17.2));
    map.on("zoomend", updateVenueLabels);
    updateVenueLabels();
    return () => map.off("zoomend", updateVenueLabels);
  }, [effectiveVenues, mapReady, mapVenueName, selectedVenueName]);

  useEffect(() => {
    const map = mapRef.current;
    placementDraftMarkerRef.current?.remove();
    placementDraftMarkerRef.current = null;
    if (!map || (!placementMode && !reviewMode) || !placementDraft) return;
    const element = document.createElement("div");
    element.className = "placement-draft-marker";
    placementDraftMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(placementDraft).addTo(map);
  }, [placementDraft, placementMode, reviewMode]);

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

  function showExhibitorOnMap(item: PlanItem) {
    const exhibitor = exhibitorById.get(item.referenceId);
    if (!exhibitor) return;
    setQuery("");
    setMapVenueName("");
    setSelectedEvent(null);
    setReviewMode(false);
    setPlacementMode(false);
    setView("map");
    highlightExhibitor(exhibitor);
  }

  function selectScheduleEvent(item: ScheduleEvent) {
    setQuery("");
    clearHighlight();
    setSelected(null);
    setSelectedEvent(item);
    setSeriesExpanded(false);
    setSelectedDate(item.localDate);
    setCalendarMode("all");
    setView("calendar");
  }

  function openEventDetails(item: ScheduleEvent, showSeries = false) {
    setSelectedEvent(item);
    setSeriesExpanded(showSeries);
  }

  function addedByName(item: PlanItem) {
    return crewMemberNames.get(item.addedBy.toLocaleLowerCase()) || item.addedBy.split("@")[0] || "Crew member";
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

  function addEventToCalendar(item: ScheduleEvent) {
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

  async function persistRemoval(item: PlanItem) {
    if (!crew) return;
    try {
      const response = await fetch("/api/crew/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", crewId: crew.id, itemId: item.id }) });
      if (!response.ok) throw new Error("Could not remove this item");
    } catch (error) {
      setPlan((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
      setCrewError(error instanceof Error ? error.message : "Could not update your Crew");
    }
  }

  function removeCrewItem(item: PlanItem) {
    if (!crew) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (pendingRemovalRef.current) void persistRemoval(pendingRemovalRef.current);
    setPlan((current) => current.filter((entry) => entry.id !== item.id));
    setPendingRemoval(item);
    pendingRemovalRef.current = item;
    undoTimerRef.current = setTimeout(() => {
      setPendingRemoval(null);
      pendingRemovalRef.current = null;
      undoTimerRef.current = null;
      void persistRemoval(item);
    }, 6500);
  }

  function undoRemoval() {
    const item = pendingRemovalRef.current;
    if (!item) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPlan((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
    setPendingRemoval(null);
    pendingRemovalRef.current = null;
    undoTimerRef.current = null;
  }

  async function createCrew() {
    const name = draftCrewName.trim();
    if (!name) return;
    if (!signedIn) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    setSaving(true); setCrewError("");
    try {
      const response = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name }) });
      const data = await response.json() as { crew?: Crew; items?: PlanItem[]; members?: CrewMember[]; error?: string };
      if (!response.ok || !data.crew) throw new Error(data.error || "Could not create the Crew");
      setCrew(data.crew); setPlan(data.items || []); setCrewMembers(data.members || []); setCrewModal("manage"); setDraftCrewName("");
    } catch (error) { setCrewError(error instanceof Error ? error.message : "Could not create the Crew"); }
    finally { setSaving(false); }
  }

  async function joinCrew() {
    if (joinCode.trim().length < 4) return;
    if (!signedIn) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    setSaving(true); setCrewError("");
    try {
      const response = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", code: joinCode }) });
      const data = await response.json() as { crew?: Crew; items?: PlanItem[]; members?: CrewMember[]; error?: string };
      if (!response.ok || !data.crew) throw new Error(data.error || "Could not join the Crew");
      setCrew(data.crew); setPlan(data.items || []); setCrewMembers(data.members || []); setCrewModal(null); setJoinCode("");
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

  async function loadLocationState() {
    try {
      const response = await fetch("/api/location", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { settings: { mode: LocationMode; basemap: Basemap }; request: CrewLocationRequest | null; samples: CrewLocationSample[] };
      setLocationMode(data.settings.mode);
      setBasemap(data.settings.basemap);
      window.localStorage.setItem("osh26-basemap", data.settings.basemap);
      setCrewLocationRequest(data.request);
      setCrewLocationSamples(data.samples);
      if (data.request && data.request.id !== lastAnsweredRequestRef.current && (data.settings.mode === "request" || data.settings.mode === "tracking")) {
        lastAnsweredRequestRef.current = data.request.id;
        void publishCurrentPosition(data.request.id);
      }
    } catch {
      // Polling is best effort; keep the last successfully loaded Crew positions.
    }
  }

  async function publishPosition(position: GeolocationPosition, requestId?: string) {
    try {
      const response = await fetch("/api/location", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "position", requestId,
          longitude: position.coords.longitude, latitude: position.coords.latitude,
          accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString(),
        }),
      });
      if (!response.ok) throw new Error("Could not share your position");
      const data = await response.json() as { sample: CrewLocationSample };
      setCrewLocationSamples((current) => [...current.filter((sample) => sample.id !== data.sample.id), data.sample]);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not share your position");
    }
  }

  function publishCurrentPosition(requestId?: string) {
    if (!navigator.geolocation) { setLocationError("Location is not supported by this browser"); return; }
    navigator.geolocation.getCurrentPosition((position) => { void publishPosition(position, requestId); },
      (error) => setLocationError(error.message || "Location permission is required"),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 });
  }

  async function saveLocationSettings(nextMode: LocationMode, nextBasemap: Basemap) {
    setBasemap(nextBasemap);
    window.localStorage.setItem("osh26-basemap", nextBasemap);
    if (!signedIn) { setLocationMode(nextMode); return; }
    setLocationSaving(true); setLocationError("");
    try {
      const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", mode: nextMode, basemap: nextBasemap }) });
      const data = await response.json() as { settings?: { mode: LocationMode; basemap: Basemap }; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "Could not save settings");
      setLocationMode(data.settings.mode); setBasemap(data.settings.basemap);
      setLocationNotice("Settings saved.");
      void loadLocationState();
    } catch (error) { setLocationError(error instanceof Error ? error.message : "Could not save settings"); }
    finally { setLocationSaving(false); }
  }

  async function requestCrewLocations() {
    if (!crew) { setCrewModal("create"); return; }
    setLocationSaving(true); setLocationError("");
    try {
      const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request" }) });
      const data = await response.json() as { request?: CrewLocationRequest; error?: string };
      if (!response.ok || !data.request) throw new Error(data.error || "Could not request Crew locations");
      setCrewLocationRequest(data.request);
      setLocationNotice("Crew location request sent. Online members will appear as they respond.");
      setView("map");
      if (locationMode === "request" || locationMode === "tracking") {
        lastAnsweredRequestRef.current = data.request.id;
        publishCurrentPosition(data.request.id);
      }
      window.setTimeout(() => { void loadLocationState(); }, 2500);
    } catch (error) { setLocationError(error instanceof Error ? error.message : "Could not request Crew locations"); }
    finally { setLocationSaving(false); }
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(({ coords }) => mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 18, duration: 700 }));
  }

  function startVenueReport(name: string) {
    const venue = venueByName.get(name);
    const map = mapRef.current;
    if (!venue?.coordinates) return;
    if (!signedIn) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    setView("map");
    setSelectedEvent(null);
    setSelectedVenueName(name);
    setPlacementDraft(null);
    setReportNote("");
    setVenueError("");
    setPlacementMode(true);
    setReviewMode(false);
    setMapVenueName("");
    clearHighlight();
    setSelected(null);
    if (map) map.flyTo({ center: venue.coordinates, zoom: Math.max(map.getZoom(), 18), duration: 600 });
  }

  async function submitVenueReport() {
    if (!selectedVenue?.coordinates || !placementDraft) return;
    setVenueSaving(true); setVenueError("");
    try {
      const response = await fetch("/api/venue-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "submit",
        venueName: selectedVenue.name,
        currentLongitude: selectedVenue.coordinates[0],
        currentLatitude: selectedVenue.coordinates[1],
        proposedLongitude: placementDraft[0],
        proposedLatitude: placementDraft[1],
        note: reportNote,
      }) });
      const data = await response.json() as { report?: VenueReport; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || "Could not submit the location report");
      if (isAdmin) setVenueReports((current) => [...current, data.report!]);
      setPlacementMode(false);
      setPlacementDraft(null);
      setMapVenueName(selectedVenue.name);
      setVenueNotice("Location report sent for admin review.");
    } catch (error) { setVenueError(error instanceof Error ? error.message : "Could not submit the location report"); }
    finally { setVenueSaving(false); }
  }

  function previewVenueReport(report: VenueReport) {
    setSelectedReportId(report.id);
    setSelectedVenueName(report.venueName);
    setPlacementDraft([report.proposedLongitude, report.proposedLatitude]);
    setMapVenueName("");
    setVenueError("");
    mapRef.current?.flyTo({ center: [report.proposedLongitude, report.proposedLatitude], zoom: 18.3, duration: 600 });
  }

  function startReportReview() {
    setView("map");
    setPlacementMode(false);
    setReviewMode(true);
    setMapVenueName("");
    setSelected(null);
    setVenueNotice("");
    if (venueReports[0]) previewVenueReport(venueReports[0]);
    else { setSelectedReportId(""); setSelectedVenueName(""); setPlacementDraft(null); }
  }

  async function reviewVenueReport(action: "approve" | "reject") {
    if (!selectedReport) return;
    setVenueSaving(true); setVenueError("");
    try {
      const response = await fetch("/api/venue-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: selectedReport.id }) });
      const data = await response.json() as { placement?: VenuePlacement | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not review this report");
      if (data.placement) setManualVenuePlacements((current) => [...current.filter((placement) => placement.venueName !== data.placement!.venueName), data.placement!]);
      const remaining = venueReports.filter((report) => report.id !== selectedReport.id);
      setVenueReports(remaining);
      if (remaining[0]) previewVenueReport(remaining[0]);
      else { setSelectedReportId(""); setSelectedVenueName(""); setPlacementDraft(null); }
      setVenueNotice(action === "approve" ? "New location approved and published on the map." : "Location report rejected.");
    } catch (error) { setVenueError(error instanceof Error ? error.message : "Could not review this report"); }
    finally { setVenueSaving(false); }
  }

  function showVenueOnMap(name: string) {
    const venue = venueByName.get(name);
    if (!venue?.coordinates) return;
    setView("map");
    setSelectedEvent(null);
    setReviewMode(false);
    setPlacementMode(false);
    setMapVenueName(name);
    mapRef.current?.flyTo({ center: venue.coordinates, zoom: 18.2, duration: 700 });
  }

  const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const activeDate = CALENDAR_DATES.find((date) => date.value === selectedDate) || CALENDAR_DATES[2];
  const fullDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`)).toUpperCase();

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="logo">26</div>
        <nav>{(["map", "plan", "calendar"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><Icon name={item} /><span>{item === "plan" ? "Crew Plan" : item[0].toUpperCase() + item.slice(1)}</span>{item === "plan" && crewPlan.length > 0 && <b>{crewPlan.length}</b>}{item === "calendar" && crewCalendarItems.length > 0 && <b>{crewCalendarItems.length}</b>}</button>)}</nav>
        <button className={`rail-settings ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Icon name="settings"/><span>Settings</span></button>
        <button className="avatar" title={userName}>{initials || "GP"}</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><div className="logo">26</div><strong>OSH26</strong></div>
          <button className="crew-switcher" onClick={() => setCrewModal(crew ? "manage" : "create")}><Icon name="crew"/><span><small>YOUR CREW</small><strong>{crew?.name || "Create or join a Crew"}</strong></span><em>⌄</em></button>
          <button className={`mobile-settings ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")} aria-label="Settings"><Icon name="settings"/></button>
          <div className="search-box"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exhibitors, events or categories" aria-label="Search" />{query && <button onClick={() => setQuery("")}><Icon name="close"/></button>}
            {visibleResults.length > 0 && <div className="search-menu"><div className="search-scroll">{visibleResults.map((match) => match.kind === "exhibitor"
              ? <button key={`exhibitor-${match.item.id}`} onClick={() => selectExhibitor(match.item)}><span><strong>{match.item.name}</strong><small>{match.item.tags.slice(0, 2).join(" · ") || "Exhibitor"}</small></span><b>{match.item.booths.join(", ")}</b></button>
              : <button key={`event-${match.item.id}`} onClick={() => selectScheduleEvent(match.item)}><span><strong>{match.item.title}</strong><small>{match.item.category} · {match.item.venue}</small></span><b className="event-result-time">{formatShortDate(match.item.localDate)} · {match.item.localStart}</b></button>)}</div><div className="search-count">{searchMatches.length > visibleResults.length ? `Showing ${visibleResults.length} of ${searchMatches.length} results` : `${searchMatches.length} result${searchMatches.length === 1 ? "" : "s"}`}</div></div>}
          </div>
          <div className="status-pill"><i /> Offline ready</div>
        </header>

        <div className={`view map-view ${view === "map" ? "visible" : ""}`}>
          <div ref={mapContainer} className="map" />
          {!mapReady && <div className="map-loading"><span/><strong>Preparing the AirVenture map…</strong></div>}
          <div className="map-title"><small>AIRVENTURE 2026</small><h1>Explore the grounds</h1><p>Find exhibitors, event venues and build a shared plan.</p></div>
          {isAdmin && !placementMode && !reviewMode && <button className="venue-editor-toggle" onClick={startReportReview}>Review location reports <b>{venueReports.length}</b></button>}
          {crew && !placementMode && !reviewMode && <button className="crew-location-request" disabled={locationSaving} onClick={requestCrewLocations}><Icon name="crew"/> Locate Crew</button>}
          {!placementMode && !reviewMode && <button className="locate" onClick={locate} aria-label="Show my location"><Icon name="location"/></button>}
          {venueNotice && !placementMode && <aside className="venue-report-toast" role="status">{venueNotice}<button onClick={() => setVenueNotice("")} aria-label="Dismiss"><Icon name="close"/></button></aside>}
          {locationNotice && !placementMode && <aside className="venue-report-toast location-toast" role="status">{locationNotice}<button onClick={() => setLocationNotice("")} aria-label="Dismiss"><Icon name="close"/></button></aside>}
          {placementMode && selectedVenue?.coordinates && <aside className="venue-editor">
            <button className="close-card" onClick={() => { setPlacementMode(false); setPlacementDraft(null); }} aria-label="Close location report"><Icon name="close"/></button>
            <small>LOCATION REPORT</small><h2>Report incorrect location</h2>
            <p><strong>{selectedVenue.name}</strong> is marked by the purple dot. Tap the correct position on the map to place the yellow target.</p>
            {placementDraft && <code>{placementDraft[1].toFixed(6)}, {placementDraft[0].toFixed(6)}</code>}
            <label>Comment (optional)<textarea value={reportNote} onChange={(event) => setReportNote(event.target.value)} maxLength={500} placeholder="Add a landmark or explain what is wrong" /></label>
            {venueError && <p className="form-error">{venueError}</p>}
            <button className="primary" disabled={!placementDraft || venueSaving} onClick={submitVenueReport}>{venueSaving ? "Sending…" : "Send for admin review"}</button>
            <small className="placement-help">The map will not change until an administrator approves the report.</small>
          </aside>}
          {reviewMode && <aside className="venue-editor venue-review-editor">
            <button className="close-card" onClick={() => { setReviewMode(false); setPlacementDraft(null); setSelectedReportId(""); }} aria-label="Close report review"><Icon name="close"/></button>
            <small>ADMIN REVIEW</small><h2>{venueReports.length} pending report{venueReports.length === 1 ? "" : "s"}</h2>
            {selectedReport ? <>
              <label>Report<select value={selectedReport.id} onChange={(event) => { const report = venueReports.find((item) => item.id === event.target.value); if (report) previewVenueReport(report); }}>{venueReports.map((report) => <option key={report.id} value={report.id}>{report.venueName}</option>)}</select></label>
              <div className="venue-match-status"><strong>{selectedReport.venueName}</strong><small>Reported by {selectedReport.reportedBy}</small></div>
              {selectedReport.note && <p className="report-note">“{selectedReport.note}”</p>}
              <div className="coordinate-compare"><span><small>CURRENT</small><code>{selectedReport.currentLatitude.toFixed(6)}, {selectedReport.currentLongitude.toFixed(6)}</code></span><span><small>PROPOSED</small><code>{selectedReport.proposedLatitude.toFixed(6)}, {selectedReport.proposedLongitude.toFixed(6)}</code></span></div>
              {venueError && <p className="form-error">{venueError}</p>}
              <div className="review-actions"><button disabled={venueSaving} className="review-reject" onClick={() => reviewVenueReport("reject")}>Reject</button><button disabled={venueSaving} className="primary" onClick={() => reviewVenueReport("approve")}>{venueSaving ? "Saving…" : "Approve new location"}</button></div>
              <small className="placement-help">Purple is the current location. Yellow is the reported location.</small>
            </> : <p>No location reports are waiting for review.</p>}
          </aside>}
          {selected && !mapVenueName && !placementMode && !reviewMode && <article className="place-card">
            <button className="close-card" onClick={closeSelection} aria-label="Close"><Icon name="close"/></button>
            <div className="place-kicker">EXHIBITOR · BOOTH {selected.booths.join(", ")}</div>
            <h2>{selected.name}</h2>
            {selected.booths.length > 1 && <div className="booth-jumps"><small>SHOW BOOTH</small><div>{selected.booths.map((booth) => <button key={booth} onClick={() => highlightExhibitor(selected, booth)}>{booth}</button>)}</div></div>}
            <div className="chips">{selected.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
            {selected.description && <p>{selected.description}</p>}
            <button disabled={saving} className={plannedIds.has(selected.id) ? "primary added" : "primary"} onClick={() => addToPlan(selected)}>{plannedIds.has(selected.id) ? <><Icon name="check"/> Added to Crew Plan</> : "+ Add to Crew Plan"}</button>
          </article>}
          {mapVenueName && !placementMode && !reviewMode && venueByName.get(mapVenueName)?.coordinates && <article className="place-card venue-map-card"><button className="close-card" onClick={() => setMapVenueName("")} aria-label="Close"><Icon name="close"/></button><div className="place-kicker">EVENT VENUE · {venueByName.get(mapVenueName)?.eventCount} EVENTS</div><h2>{mapVenueName}</h2><p>Mapped from {venueByName.get(mapVenueName)?.source === "openstreetmap" ? "OpenStreetMap" : venueByName.get(mapVenueName)?.source === "booth-map" ? "the exhibitor booth map" : venueByName.get(mapVenueName)?.source === "visitor-map" ? "the Official Visitors Map" : "a manual placement"}.</p><button className="report-location" onClick={() => startVenueReport(mapVenueName)}>Report incorrect location</button></article>}
        </div>

        <div className={`view content-view ${view === "plan" ? "visible" : ""}`}>
          <div className="content-header"><div><span>SHARED WITH YOUR CREW</span><h1>Crew Plan</h1><p>Exhibitors and booths your Crew wants to visit.</p></div><button className="primary compact" onClick={() => setView("map")}>+ Add exhibitors</button></div>
          {!crew ? <Empty icon="crew" title="Create a Crew to start planning" text="Invite friends and build one shared list for AirVenture." action="Create Crew" onAction={() => setCrewModal("create")} secondary="Join with a code" onSecondary={() => setCrewModal("join")} />
          : crewPlan.length === 0 ? <Empty icon="plan" title="Your Crew Plan is empty" text="Explore the map and add exhibitors your Crew wants to visit." action="Explore the map" onAction={() => setView("map")} />
          : <div className="plan-list">{crewPlan.map((item) => <article key={item.id} className={item.visited ? "visited" : ""}><button className="check-button" onClick={() => toggleVisited(item)} aria-label={item.visited ? "Mark as not visited" : "Mark as visited"}>{item.visited && <Icon name="check"/>}</button><div><small>Exhibitor</small><h2>{item.title}</h2><p>{item.meta}</p><p className="added-by">Added by: <strong>{addedByName(item)}</strong></p></div><div className="plan-actions"><span className="shared-status">{item.visited ? "Visited by Crew" : "Planned"}</span>{exhibitorById.has(item.referenceId) && <button className="show-on-map" onClick={() => showExhibitorOnMap(item)}><Icon name="location"/> Show on map</button>}<button className="remove-item" onClick={() => removeCrewItem(item)} aria-label={`Remove ${item.title}`}><Icon name="trash"/> Remove</button></div></article>)}</div>}
        </div>

        <div className={`view content-view settings-view ${view === "settings" ? "visible" : ""}`}>
          <div className="content-header"><div><span>YOUR PREFERENCES</span><h1>Settings</h1><p>Control location sharing and choose the map background on this device.</p></div></div>
          <div className="settings-grid">
            <section className="settings-card">
              <div className="settings-card-head"><span><Icon name="location"/></span><div><small>PRIVACY</small><h2>Location sharing</h2></div></div>
              {!signedIn ? <div className="settings-signin"><p>Sign in to share your position with a Crew.</p><a className="primary" href="/signin-with-chatgpt?return_to=%2F">Sign in</a></div> : <>
                <div className="setting-options location-options">
                  <button className={locationMode === "off" ? "active" : ""} disabled={locationSaving} onClick={() => saveLocationSettings("off", basemap)}><strong>Off</strong><small>No location is shared. Your saved trail is removed.</small></button>
                  <button className={locationMode === "request" ? "active" : ""} disabled={locationSaving} onClick={() => saveLocationSettings("request", basemap)}><strong>On Crew Request</strong><small>Share one current position when an online Crew member asks.</small></button>
                  <button className={locationMode === "tracking" ? "active" : ""} disabled={locationSaving} onClick={() => saveLocationSettings("tracking", basemap)}><strong>Tracking</strong><small>Continuously share and save your trail while the app is open.</small></button>
                </div>
                <p className="privacy-note">Your choice is personal. Crew members cannot turn location sharing on for you. Mobile browsers may pause tracking when the app is in the background.</p>
                <div className="crew-location-box">
                  <div><strong>Crew positions</strong><small>{latestCrewLocations.length ? `${latestCrewLocations.length} member${latestCrewLocations.length === 1 ? "" : "s"} currently visible` : "No recent Crew positions"}</small></div>
                  <button disabled={!crew || locationSaving} onClick={requestCrewLocations}><Icon name="crew"/> Request locations</button>
                </div>
                {crewLocationRequest && <p className="request-status">Latest request by <strong>{crewLocationRequest.requestedByName}</strong> at {new Date(crewLocationRequest.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
              </>}
              {locationError && <p className="form-error">{locationError}</p>}
            </section>

            <section className="settings-card">
              <div className="settings-card-head"><span><Icon name="map"/></span><div><small>MAP</small><h2>Basemap</h2></div></div>
              <div className="setting-options basemap-options">
                <button className={basemap === "osm" ? "active" : ""} disabled={locationSaving} onClick={() => saveLocationSettings(locationMode, "osm")}><span className="map-preview osm-preview"/><strong>OpenStreetMap</strong><small>Clear streets, buildings and place names.</small></button>
                <button className={basemap === "ortho" ? "active" : ""} disabled={locationSaving} onClick={() => saveLocationSettings(locationMode, "ortho")}><span className="map-preview ortho-preview"/><strong>Ortho</strong><small>Aerial imagery beneath the event map layers.</small></button>
              </div>
              <button className="text-button view-map-setting" onClick={() => setView("map")}>View map</button>
            </section>
          </div>
        </div>

        <div className={`view content-view ${view === "calendar" ? "visible" : ""}`}>
          <div className="content-header"><div><span>{fullDay} · JULY {activeDate.date}</span><h1>{calendarMode === "crew" ? "Crew Calendar" : "Event Schedule"}</h1><p>{calendarMode === "crew" ? "Your Crew's shared, chronological event calendar." : "Browse the complete official AirVenture schedule."}</p></div><button className="date-button" onClick={() => { setSelectedDate("2026-07-20"); setSelectedEvent(null); }}>Opening day</button></div>
          <div className="calendar-mode-tabs"><button className={calendarMode === "crew" ? "active" : ""} onClick={() => { setCalendarMode("crew"); setSelectedEvent(null); }}>Crew Calendar <b>{crewCalendarItems.length}</b></button><button className={calendarMode === "all" ? "active" : ""} onClick={() => { setCalendarMode("all"); setSelectedEvent(null); }}>All Events <b>{events.length}</b></button></div>
          <div className="calendar-strip">{CALENDAR_DATES.map((date) => <button key={date.value} className={date.value === selectedDate ? "active" : ""} onClick={() => { setSelectedDate(date.value); setSelectedEvent(null); }}><small>{date.day}</small><strong>{date.date}</strong></button>)}</div>

          <div className="calendar-filters"><label>Category<select value={eventCategory} onChange={(event) => setEventCategory(event.target.value)}><option value="">All categories</option>{eventCategories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Place<select value={eventVenue} onChange={(event) => setEventVenue(event.target.value)}><option value="">All places</option>{eventVenues.map((venue) => <option key={venue}>{venue}</option>)}</select></label>{(eventCategory || eventVenue) && <button onClick={() => { setEventCategory(""); setEventVenue(""); }}>Clear filters</button>}</div>

          {selectedEvent && <article className="event-detail">
            <button className="close-card" onClick={() => setSelectedEvent(null)} aria-label="Close"><Icon name="close"/></button>
            <div className="place-kicker">{selectedEvent.category} · {selectedEvent.localStart}–{selectedEvent.localEnd}</div>
            <h2>{selectedEvent.title}</h2>
            <p className="event-venue">{selectedEvent.venue}</p>
            {plannedItemByReference.get(selectedEvent.id) && <p className="added-by">Added by: <strong>{addedByName(plannedItemByReference.get(selectedEvent.id)!)}</strong></p>}
            {calendarMode === "crew" && selectedSeries.length > 1 && <button className="recurrence-summary" onClick={() => setSeriesExpanded((expanded) => !expanded)}><Icon name="repeat"/><span><strong>Recurring event</strong><small>{selectedSeries.length} scheduled instances</small></span><b>{seriesExpanded ? "Hide" : "View all"}</b></button>}
            <div className="chips">{selectedEvent.interests.map((interest) => <span key={interest}>{interest}</span>)}</div>
            <div className="event-detail-actions"><div><a href={selectedEvent.url} target="_blank" rel="noreferrer">Official listing ↗</a>{venueByName.get(selectedEvent.venue)?.coordinates && <><button className="show-on-map" onClick={() => showVenueOnMap(selectedEvent.venue)}><Icon name="location"/> Show on map</button><button className="report-location" onClick={() => startVenueReport(selectedEvent.venue)}>Report incorrect location</button></>}</div>{plannedItemByReference.has(selectedEvent.id) ? <button disabled={saving} className="primary remove-primary" onClick={() => removeCrewItem(plannedItemByReference.get(selectedEvent.id)!)}><Icon name="trash"/> Remove from Crew Calendar</button> : <button disabled={saving} className="primary" onClick={() => addEventToCalendar(selectedEvent)}>+ Add to Crew Calendar</button>}</div>
            {calendarMode === "crew" && seriesExpanded && selectedSeries.length > 1 && <div className="series-instances"><div><strong>All instances</strong><small>Select a date and time to view or add that specific instance.</small></div>{selectedSeries.map((instance) => <button key={instance.id} className={instance.id === selectedEvent.id ? "active" : ""} onClick={() => { setSelectedEvent(instance); setSelectedDate(instance.localDate); }}><span><strong>{formatShortDate(instance.localDate)}</strong><small>{instance.localStart}–{instance.localEnd}</small></span><em>{instance.venue}</em><b>{plannedIds.has(instance.id) ? "✓ Added" : "View"}</b></button>)}</div>}
          </article>}

          {calendarMode === "crew" ? <section className="calendar-section crew-schedule">
            <div className="calendar-section-head"><div><small>SHARED CREW CALENDAR</small><h2>{fullDay[0] + fullDay.slice(1).toLowerCase()}, July {activeDate.date}</h2></div><b>{crewEventsForDate.length}</b></div>
            {crewEventsForDate.length === 0 ? <div className="calendar-empty"><Icon name="calendar"/><span><strong>No matching Crew events on this day</strong><small>Open All Events to add scheduled activities.</small></span><button onClick={() => setCalendarMode("all")}>Browse events</button></div>
              : <div className="calendar-time-grid" style={{ height: timeline.height }}>{timeline.hours.map((minute) => <div className="time-rule" key={minute} style={{ top: (minute - timeline.startMinute) * 0.9 }}><time>{String(Math.floor(minute / 60) % 24).padStart(2, "0")}:00</time><span/></div>)}{timeline.placements.map(({ event, start, end, column, columns }) => { const crewItem = plannedItemByReference.get(event.id)!; return <article key={event.id} className="timeline-event" style={{ top: (start - timeline.startMinute) * 0.9, height: Math.max(34, (end - start) * 0.9), left: `calc(65px + (100% - 72px) * ${column} / ${columns})`, width: `calc((100% - 72px) / ${columns} - 5px)` }} onClick={() => openEventDetails(event)}><span><time>{event.localStart}–{event.localEnd}</time><strong>{event.title}</strong><small>{event.venue}</small><em>Added by: {addedByName(crewItem)}</em></span><div className="timeline-actions">{(eventSeries.get(seriesKey(event))?.length || 0) > 1 && <button className="repeat-button" onClick={(click) => { click.stopPropagation(); openEventDetails(event, true); }} aria-label="View all instances"><Icon name="repeat"/></button>}<button className="repeat-button remove" onClick={(click) => { click.stopPropagation(); removeCrewItem(crewItem); }} aria-label="Remove from Crew Calendar"><Icon name="trash"/></button></div></article>; })}</div>}
          </section> : <section className="calendar-section official-schedule">
            <div className="calendar-section-head"><div><small>AIRVENTURE 2026</small><h2>All scheduled events</h2></div><b>{scheduleForDate.length}</b></div>
            <p className="schedule-count">Chronological schedule for {fullDay[0] + fullDay.slice(1).toLowerCase()}, July {activeDate.date}</p>
            <div className="schedule-list">{scheduleForDate.map((event) => { const key = seriesKey(event); const instances = eventSeries.get(key) || [event]; const expanded = expandedSeriesKey === key; return <div className="schedule-event-group" key={event.id}><article className="schedule-event" onClick={() => openEventDetails(event)}><time>{event.localStart}<small>{event.localEnd}</small></time><span><strong>{event.title}</strong><small>{event.category} · {event.venue}</small>{instances.length > 1 && <button className="recurrence-inline" onClick={(click) => { click.stopPropagation(); setExpandedSeriesKey(expanded ? null : key); }}><Icon name="repeat"/>{instances.length} instances · {expanded ? "Hide" : "View all"}</button>}</span><button className={plannedIds.has(event.id) ? "event-add planned" : "event-add"} onClick={(click) => { click.stopPropagation(); const planned = plannedItemByReference.get(event.id); if (planned) removeCrewItem(planned); else addEventToCalendar(event); }}>{plannedIds.has(event.id) ? "Remove" : "+ Add"}</button></article>{expanded && <div className="inline-series-list"><div><strong>All instances</strong><small>Dates use day/month format.</small></div>{instances.map((instance) => { const planned = plannedItemByReference.get(instance.id); return <div key={instance.id} className={instance.id === event.id ? "current" : ""}><time><strong>{formatShortDate(instance.localDate)}</strong><small>{instance.localStart}–{instance.localEnd}</small></time><span>{instance.venue}</span><button className={planned ? "planned" : ""} onClick={() => planned ? removeCrewItem(planned) : addEventToCalendar(instance)}>{planned ? "Remove" : "+ Add"}</button></div>; })}</div>}</div>; })}</div>
          </section>}
        </div>
      </section>

      <nav className="bottom-nav">{(["map", "plan", "calendar"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><Icon name={item}/><span>{item === "plan" ? "Crew Plan" : item[0].toUpperCase() + item.slice(1)}</span>{item === "plan" && crewPlan.length > 0 && <b>{crewPlan.length}</b>}{item === "calendar" && crewCalendarItems.length > 0 && <b>{crewCalendarItems.length}</b>}</button>)}</nav>

      {crewModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCrewModal(null); }}><section className="crew-modal"><button className="modal-close" onClick={() => setCrewModal(null)}><Icon name="close"/></button><div className="modal-icon"><Icon name="crew"/></div>{crewModal === "create" ? <><span>START PLANNING TOGETHER</span><h1>Create a Crew</h1><p>Name your Crew now. You will get an invite code and QR code to share with friends.</p><label>Crew name<input autoFocus value={draftCrewName} onChange={(event) => setDraftCrewName(event.target.value)} placeholder="e.g. Nordic Flyers" onKeyDown={(event) => { if (event.key === "Enter") createCrew(); }}/></label>{crewError && <p className="form-error">{crewError}</p>}<button className="primary" disabled={saving || !draftCrewName.trim()} onClick={createCrew}>{saving ? "Creating…" : "Create Crew"}</button><button className="text-button" onClick={() => { setCrewError(""); setCrewModal("join"); }}>I have an invite code</button></> : crewModal === "join" ? <><span>JOIN YOUR FRIENDS</span><h1>Join a Crew</h1><p>Enter the six-character invite code shared by a Crew member.</p><label>Invite code<input autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} placeholder="OSH26X" onKeyDown={(event) => { if (event.key === "Enter") joinCrew(); }}/></label>{crewError && <p className="form-error">{crewError}</p>}<button className="primary" disabled={saving || joinCode.trim().length < 4} onClick={joinCrew}>{saving ? "Joining…" : "Join Crew"}</button><button className="text-button" onClick={() => { setCrewError(""); setCrewModal("create"); }}>Create a new Crew instead</button></> : crew ? <><span>INVITE CREW MEMBERS</span><h1>{crew.name}</h1><p>Share this invite code or let a friend scan the QR code.</p>{qrCode && <Image unoptimized className="invite-qr" width={180} height={180} src={qrCode} alt={`QR code to join ${crew.name}`} />}<div className="invite-code"><small>INVITE CODE</small><strong>{crew.inviteCode}</strong></div><button className="primary" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?join=${crew.inviteCode}`)}>Copy invite link</button></> : null}</section></div>}

      {pendingRemoval && <aside className="undo-toast" role="status"><span><strong>Removed from {pendingRemoval.kind === "event" ? "Crew Calendar" : "Crew Plan"}</strong><small>{pendingRemoval.title}</small></span><button onClick={undoRemoval}>Undo</button></aside>}

      {!signedIn && <a className="signin-notice" href="/signin-with-chatgpt?return_to=%2F">Sign in to save and share your Crew →</a>}
    </main>
  );
}

function Empty({ icon, title, text, action, onAction, secondary, onSecondary }: { icon: "crew" | "plan" | "calendar"; title: string; text: string; action: string; onAction: () => void; secondary?: string; onSecondary?: () => void }) {
  return <section className="empty-state"><div><Icon name={icon}/></div><h2>{title}</h2><p>{text}</p><button className="primary compact" onClick={onAction}>{action}</button>{secondary && <button className="text-button" onClick={onSecondary}>{secondary}</button>}</section>;
}
