import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { crewItems, crewMembers } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";

async function isMember(crewId: string, email: string) {
  const db = await getDb();
  const [member] = await db.select().from(crewMembers).where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userEmail, email))).limit(1);
  return Boolean(member);
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const payload = await request.json() as {
    action?: "add" | "toggleVisited";
    crewId?: string;
    itemId?: string;
    kind?: "exhibitor" | "event";
    referenceId?: string;
    title?: string;
    meta?: string;
    startsAt?: string | null;
    visited?: boolean;
  };
  if (!payload.crewId || !(await isMember(payload.crewId, user.email))) return Response.json({ error: "Crew access required" }, { status: 403 });
  const db = await getDb();
  if (payload.action === "add") {
    if (!payload.referenceId || !payload.title || !payload.kind) return Response.json({ error: "Item details are required" }, { status: 400 });
    const item = { id: crypto.randomUUID(), crewId: payload.crewId, kind: payload.kind, referenceId: payload.referenceId, title: payload.title, meta: payload.meta ?? "", startsAt: payload.startsAt ?? null, addedBy: user.email };
    await db.insert(crewItems).values(item).onConflictDoNothing();
    const [saved] = await db.select().from(crewItems).where(and(eq(crewItems.crewId, payload.crewId), eq(crewItems.kind, payload.kind), eq(crewItems.referenceId, payload.referenceId))).limit(1);
    return Response.json({ item: saved }, { status: 201 });
  }
  if (payload.action === "toggleVisited" && payload.itemId) {
    const visited = Boolean(payload.visited);
    await db.update(crewItems).set({ visited, visitedBy: visited ? user.email : null, visitedAt: visited ? new Date().toISOString() : null })
      .where(and(eq(crewItems.id, payload.itemId), eq(crewItems.crewId, payload.crewId)));
    const [item] = await db.select().from(crewItems).where(eq(crewItems.id, payload.itemId)).limit(1);
    return Response.json({ item });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
