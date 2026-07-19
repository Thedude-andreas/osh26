import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { venuePlacements } from "../../../db/schema";
import { isAdminEmail } from "../../admin";
import { getSupabaseApiUser } from "../auth-user";

export async function GET() {
  const db = await getDb();
  const placements = await db.select().from(venuePlacements).orderBy(asc(venuePlacements.venueName));
  return Response.json({ placements });
}

export async function POST(request: Request) {
  const user = await getSupabaseApiUser(request);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!isAdminEmail(user.email)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const payload = await request.json() as { venueName?: string; longitude?: number; latitude?: number };
  const venueName = payload.venueName?.trim();
  const longitude = Number(payload.longitude);
  const latitude = Number(payload.latitude);
  if (!venueName || venueName.length > 180 || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return Response.json({ error: "Venue name and coordinates are required" }, { status: 400 });
  }
  if (longitude < -88.7 || longitude > -88.4 || latitude < 43.85 || latitude > 44.1) {
    return Response.json({ error: "Placement is outside the Oshkosh event area" }, { status: 400 });
  }
  const placement = { venueName, longitude, latitude, placedBy: user.email, updatedAt: new Date().toISOString() };
  const db = await getDb();
  await db.insert(venuePlacements).values(placement).onConflictDoUpdate({
    target: venuePlacements.venueName,
    set: { longitude, latitude, placedBy: user.email, updatedAt: placement.updatedAt },
  });
  return Response.json({ placement });
}
