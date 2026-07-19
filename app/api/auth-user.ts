import { createClient } from "@supabase/supabase-js";

export type ApiUser = {
  email: string;
  displayName: string;
};

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
}

export async function getSupabaseApiUser(request: Request): Promise<ApiUser | null> {
  const token = getBearerToken(request);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !supabasePublishableKey) return null;

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user.email) return null;

  const displayName =
    typeof data.user.user_metadata?.full_name === "string" && data.user.user_metadata.full_name.trim()
      ? data.user.user_metadata.full_name.trim()
      : data.user.email.split("@")[0];

  return { email: data.user.email, displayName };
}
