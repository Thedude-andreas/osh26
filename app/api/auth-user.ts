import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

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
  if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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
