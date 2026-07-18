import { and, asc, desc, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { crewMembers, locationPreferences, locationRequests, locationSamples } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

type LocationMode = "off" | "request" | "tracking";
type Basemap = "osm" | "ortho";

const REQUEST_WINDOW_MS = 2 * 60 * 1000;
const REQUEST_POSITION_TTL_MS = 10 * 60 * 1000;
const TRACK_WINDOW_MS = 24 * 60 * 60 * 1000;

async function membershipFor(email: string) {
  const db = await getDb();
  const [membership] = await db.select().from(crewMembers).where(eq(crewMembers.userEmail, email)).orderBy(asc(crewMembers.joinedAt)).limit(1);
  return membership ?? null;
}

function validCoordinate(longitude: number, latitude: number, accuracy: number) {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const [preference] = await db.select().from(locationPreferences).where(eq(locationPreferences.userEmail, user.email)).limit(1);
  const settings = { mode: preference?.mode ?? "off", basemap: preference?.basemap ?? "osm" };
  const membership = await membershipFor(user.email);
  if (!membership) return Response.json({ settings, request: null, samples: [] });

  const now = Date.now();
  const requestCutoff = new Date(now - REQUEST_WINDOW_MS).toISOString();
  const requestPositionCutoff = new Date(now - REQUEST_POSITION_TTL_MS).toISOString();
  const trackCutoff = new Date(now - TRACK_WINDOW_MS).toISOString();
  await db.delete(locationSamples).where(and(eq(locationSamples.kind, "request"), lt(locationSamples.capturedAt, requestPositionCutoff)));

  const [latestRequest] = await db.select().from(locationRequests)
    .where(and(eq(locationRequests.crewId, membership.crewId), gte(locationRequests.createdAt, requestCutoff)))
    .orderBy(desc(locationRequests.createdAt)).limit(1);
  const members = await db.select({ userEmail: crewMembers.userEmail, displayName: crewMembers.displayName })
    .from(crewMembers).where(eq(crewMembers.crewId, membership.crewId));
  const memberName = new Map(members.map((member) => [member.userEmail, member.displayName]));
  const samples = await db.select().from(locationSamples)
    .where(and(eq(locationSamples.crewId, membership.crewId), or(
      and(eq(locationSamples.kind, "request"), gte(locationSamples.capturedAt, requestPositionCutoff)),
      and(eq(locationSamples.kind, "tracking"), gte(locationSamples.capturedAt, trackCutoff)),
    ))).orderBy(asc(locationSamples.capturedAt));

  return Response.json({
    settings,
    request: latestRequest ? { ...latestRequest, requestedByName: memberName.get(latestRequest.requestedBy) ?? "Crew member" } : null,
    samples: samples.map((sample) => ({ ...sample, displayName: memberName.get(sample.userEmail) ?? "Crew member" })),
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const payload = await request.json() as {
    action?: "settings" | "request" | "position";
    mode?: LocationMode;
    basemap?: Basemap;
    requestId?: string;
    longitude?: number;
    latitude?: number;
    accuracy?: number;
    capturedAt?: string;
  };
  const db = await getDb();

  if (payload.action === "settings") {
    if (!(["off", "request", "tracking"] as const).includes(payload.mode as LocationMode)
      || !(["osm", "ortho"] as const).includes(payload.basemap as Basemap)) {
      return Response.json({ error: "Invalid location settings" }, { status: 400 });
    }
    const settings = { userEmail: user.email, mode: payload.mode!, basemap: payload.basemap!, updatedAt: new Date().toISOString() };
    await db.insert(locationPreferences).values(settings).onConflictDoUpdate({ target: locationPreferences.userEmail, set: settings });
    if (payload.mode === "off") await db.delete(locationSamples).where(eq(locationSamples.userEmail, user.email));
    return Response.json({ settings: { mode: settings.mode, basemap: settings.basemap } });
  }

  const membership = await membershipFor(user.email);
  if (!membership) return Response.json({ error: "Join a Crew first" }, { status: 403 });

  if (payload.action === "request") {
    const locationRequest = { id: crypto.randomUUID(), crewId: membership.crewId, requestedBy: user.email, createdAt: new Date().toISOString() };
    await db.insert(locationRequests).values(locationRequest);
    return Response.json({ request: { ...locationRequest, requestedByName: user.displayName } }, { status: 201 });
  }

  if (payload.action === "position") {
    const longitude = Number(payload.longitude);
    const latitude = Number(payload.latitude);
    const accuracy = Number(payload.accuracy);
    if (!validCoordinate(longitude, latitude, accuracy)) return Response.json({ error: "Invalid position" }, { status: 400 });
    const [preference] = await db.select().from(locationPreferences).where(eq(locationPreferences.userEmail, user.email)).limit(1);
    const mode = preference?.mode ?? "off";
    if (mode === "off") return Response.json({ error: "Location sharing is off" }, { status: 403 });
    if (mode === "request") {
      if (!payload.requestId) return Response.json({ error: "A current Crew request is required" }, { status: 403 });
      const requestCutoff = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString();
      const [activeRequest] = await db.select().from(locationRequests).where(and(
        eq(locationRequests.id, payload.requestId),
        eq(locationRequests.crewId, membership.crewId),
        gte(locationRequests.createdAt, requestCutoff),
      )).limit(1);
      if (!activeRequest) return Response.json({ error: "This location request has expired" }, { status: 410 });
    }
    const capturedAt = new Date().toISOString();
    const sample = {
      id: crypto.randomUUID(), crewId: membership.crewId, userEmail: user.email,
      kind: mode === "tracking" ? "tracking" as const : "request" as const,
      requestId: payload.requestId ?? null, longitude, latitude, accuracy, capturedAt,
    };
    await db.insert(locationSamples).values(sample);
    return Response.json({ sample: { ...sample, displayName: user.displayName } }, { status: 201 });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
