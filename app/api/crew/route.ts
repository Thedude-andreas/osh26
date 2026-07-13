import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { crewItems, crewMembers, crews } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const memberships = await db.select({ crew: crews, role: crewMembers.role })
    .from(crewMembers).innerJoin(crews, eq(crewMembers.crewId, crews.id))
    .where(eq(crewMembers.userEmail, user.email)).orderBy(asc(crewMembers.joinedAt));
  const membership = memberships[0];
  if (!membership) return Response.json({ crew: null, items: [] });
  const items = await db.select().from(crewItems).where(eq(crewItems.crewId, membership.crew.id)).orderBy(asc(crewItems.createdAt));
  return Response.json({ crew: { ...membership.crew, role: membership.role }, items });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const payload = await request.json() as { action?: "create" | "join"; name?: string; code?: string };
  const db = await getDb();
  if (payload.action === "create") {
    const name = payload.name?.trim();
    if (!name) return Response.json({ error: "Crew name is required" }, { status: 400 });
    const crew = { id: crypto.randomUUID(), name, inviteCode: inviteCode(), createdBy: user.email };
    await db.insert(crews).values(crew);
    await db.insert(crewMembers).values({ crewId: crew.id, userEmail: user.email, displayName: user.displayName, role: "owner" });
    return Response.json({ crew: { ...crew, role: "owner" }, items: [] }, { status: 201 });
  }
  if (payload.action === "join") {
    const code = payload.code?.trim().toUpperCase();
    if (!code) return Response.json({ error: "Invite code is required" }, { status: 400 });
    const [crew] = await db.select().from(crews).where(eq(crews.inviteCode, code)).limit(1);
    if (!crew) return Response.json({ error: "Invite code not found" }, { status: 404 });
    await db.insert(crewMembers).values({ crewId: crew.id, userEmail: user.email, displayName: user.displayName, role: "member" }).onConflictDoNothing();
    const items = await db.select().from(crewItems).where(eq(crewItems.crewId, crew.id)).orderBy(asc(crewItems.createdAt));
    return Response.json({ crew: { ...crew, role: "member" }, items });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
