import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { venueLocationReports, venuePlacements } from "../../../db/schema";
import { isAdminEmail } from "../../admin";
import { getSupabaseApiUser } from "../auth-user";

type Payload = {
  action?: "submit" | "approve" | "reject";
  id?: string;
  venueName?: string;
  currentLongitude?: number;
  currentLatitude?: number;
  proposedLongitude?: number;
  proposedLatitude?: number;
  note?: string;
};

function validCoordinate(longitude: number, latitude: number) {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -88.7 && longitude <= -88.4
    && latitude >= 43.85 && latitude <= 44.1;
}

export async function GET(request: Request) {
  const user = await getSupabaseApiUser(request);
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const db = await getDb();
  const reports = await db.select().from(venueLocationReports)
    .where(eq(venueLocationReports.status, "pending"))
    .orderBy(asc(venueLocationReports.createdAt));
  return Response.json({ reports });
}

export async function POST(request: Request) {
  const user = await getSupabaseApiUser(request);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const payload = await request.json() as Payload;
  const db = await getDb();

  if (payload.action === "submit") {
    const venueName = payload.venueName?.trim();
    const currentLongitude = Number(payload.currentLongitude);
    const currentLatitude = Number(payload.currentLatitude);
    const proposedLongitude = Number(payload.proposedLongitude);
    const proposedLatitude = Number(payload.proposedLatitude);
    if (!venueName || venueName.length > 180 || !validCoordinate(currentLongitude, currentLatitude) || !validCoordinate(proposedLongitude, proposedLatitude)) {
      return Response.json({ error: "Venue and valid coordinates are required" }, { status: 400 });
    }
    const report = {
      id: crypto.randomUUID(),
      venueName,
      currentLongitude,
      currentLatitude,
      proposedLongitude,
      proposedLatitude,
      note: payload.note?.trim().slice(0, 500) || "",
      status: "pending" as const,
      reportedBy: user.email,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    };
    await db.insert(venueLocationReports).values(report);
    return Response.json({ report });
  }

  if (!isAdminEmail(user.email)) return Response.json({ error: "Admin access required" }, { status: 403 });
  if (!payload.id || (payload.action !== "approve" && payload.action !== "reject")) {
    return Response.json({ error: "Report and review action are required" }, { status: 400 });
  }
  const [report] = await db.select().from(venueLocationReports).where(and(
    eq(venueLocationReports.id, payload.id),
    eq(venueLocationReports.status, "pending"),
  ));
  if (!report) return Response.json({ error: "Pending report not found" }, { status: 404 });

  const reviewedAt = new Date().toISOString();
  if (payload.action === "approve") {
    await db.insert(venuePlacements).values({
      venueName: report.venueName,
      longitude: report.proposedLongitude,
      latitude: report.proposedLatitude,
      placedBy: user.email,
      updatedAt: reviewedAt,
    }).onConflictDoUpdate({
      target: venuePlacements.venueName,
      set: { longitude: report.proposedLongitude, latitude: report.proposedLatitude, placedBy: user.email, updatedAt: reviewedAt },
    });
  }
  await db.update(venueLocationReports).set({
    status: payload.action === "approve" ? "approved" : "rejected",
    reviewedBy: user.email,
    reviewedAt,
  }).where(eq(venueLocationReports.id, report.id));

  return Response.json({
    report: { ...report, status: payload.action === "approve" ? "approved" : "rejected", reviewedBy: user.email, reviewedAt },
    placement: payload.action === "approve" ? {
      venueName: report.venueName,
      longitude: report.proposedLongitude,
      latitude: report.proposedLatitude,
      placedBy: user.email,
      updatedAt: reviewedAt,
    } : null,
  });
}
