"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type CrewMembership = {
  crew_id: string;
  role: "owner" | "member";
  display_name: string | null;
  crews: { id: string; name: string; created_at: string } | null;
};

type AuthStatus = "idle" | "loading" | "sent" | "error";

export function CrewAuth() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [crewName, setCrewName] = useState("OSH26 Crew");
  const [memberships, setMemberships] = useState<CrewMembership[]>([]);
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadMemberships = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("crew_members")
      .select("crew_id, role, display_name, crews(id, name, created_at)")
      .order("created_at", { referencedTable: "crews", ascending: true });
    if (error) throw error;
    setMemberships((data ?? []) as CrewMembership[]);
  }, [supabase]);

  const syncUser = useCallback(async (user: User) => {
    if (!supabase) return;
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? null,
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;
    await loadMemberships();
  }, [loadMemberships, supabase]);

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    const handleSession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setMemberships([]);
        return;
      }
      syncUser(nextSession.user).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Kunde inte synka användaren.");
      });
    };

    supabase.auth.getSession().then(({ data }) => handleSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      handleSession(nextSession);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, syncUser]);

  async function signIn() {
    if (!supabase || !email.trim()) return;
    setStatus("loading");
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
    setMessage("Inloggningslank skickad. Kolla mejlen och oppna lanken pa samma enhet.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setMemberships([]);
  }

  async function createCrew() {
    if (!supabase || !session?.user || !crewName.trim()) return;
    setStatus("loading");
    setMessage(null);

    const { data: crew, error: crewError } = await supabase
      .from("crews")
      .insert({ name: crewName.trim(), created_by: session.user.id })
      .select("id")
      .single();
    if (crewError) {
      setStatus("error");
      setMessage(crewError.message);
      return;
    }

    const { error: memberError } = await supabase.from("crew_members").insert({
      crew_id: crew.id,
      user_id: session.user.id,
      role: "owner",
      display_name: session.user.email?.split("@")[0] ?? "Crew",
    });
    if (memberError) {
      setStatus("error");
      setMessage(memberError.message);
      return;
    }

    await loadMemberships();
    setStatus("idle");
  }

  if (!supabase) {
    return (
      <div className="crew-auth">
        <strong>Supabase saknas</strong>
        <span>Lagg in NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="crew-auth">
        <strong>Crew-login</strong>
        <div className="crew-auth-row">
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="namn@example.com" type="email" />
          <button onClick={signIn} disabled={status === "loading"}>Skicka lank</button>
        </div>
        {message && <span>{message}</span>}
      </div>
    );
  }

  const activeCrew = memberships[0]?.crews;

  return (
    <div className="crew-auth">
      <div className="crew-auth-head">
        <strong>{activeCrew ? activeCrew.name : "Ingen crew"}</strong>
        <button onClick={signOut}>Logga ut</button>
      </div>
      <span>{session.user.email}</span>
      {activeCrew ? (
        <span>{memberships.length} crew-medlemskap aktivt</span>
      ) : (
        <div className="crew-auth-row">
          <input value={crewName} onChange={(event) => setCrewName(event.target.value)} placeholder="Crew-namn" />
          <button onClick={createCrew} disabled={status === "loading"}>Skapa crew</button>
        </div>
      )}
      {message && <span>{message}</span>}
    </div>
  );
}
