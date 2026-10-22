import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DISCORD_GUILD_ID = "691138101367668736";
const DISCORD_API = "https://discord.com/api/v10";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getCorsHeaders(origin: string | null) {
  const allowedOrigin = Deno.env.get("APP_ALLOWED_ORIGIN") || "https://mgg-animator.github.io";
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function getDiscordUserId(user: {
  user_metadata?: Record<string, unknown>;
  identities?: Array<{
    provider?: string;
    identity_data?: Record<string, unknown> | null;
  }>;
}) {
  const identity = user.identities?.find(item => item.provider === "discord");
  const identityData = identity?.identity_data || {};
  const metadata = user.user_metadata || {};
  const rawId = identityData.provider_id || identityData.sub || identityData.id ||
    metadata.provider_id || metadata.sub;
  const discordUserId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
  return /^\d{17,22}$/.test(discordUserId) ? discordUserId : null;
}

Deno.serve(async request => {
  const corsHeaders = getCorsHeaders(request.headers.get("Origin"));
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
  }
  if (corsHeaders["Access-Control-Allow-Origin"] === "null") {
    return jsonResponse({ error: "Origin not allowed." }, 403, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = request.headers.get("Authorization");
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");

    if (!supabaseUrl || !supabaseAnonKey || !authorization) {
      throw new HttpError(401, "A valid Supabase session is required.");
    }
    if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured.");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) throw new HttpError(401, "A valid Supabase session is required.");

    const discordUserId = getDiscordUserId(user);
    if (!discordUserId) {
      throw new HttpError(403, "Could not find the linked Discord account for this user.");
    }

    const response = await fetch(
      `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (response.status === 200) return jsonResponse({ inGuild: true }, 200, corsHeaders);
    if (response.status === 404) return jsonResponse({ inGuild: false }, 200, corsHeaders);
    if (response.status === 401) {
      throw new Error("Discord rejected the bot token; check the Supabase secret.");
    }
    if (response.status === 403) {
      throw new Error("Discord denied access; verify that the bot belongs to this server.");
    }
    if (response.status === 429) {
      throw new HttpError(503, "Discord rate-limited the membership check; retry later.");
    }
    throw new HttpError(502, `Discord membership check failed (HTTP ${response.status}).`);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (status >= 500) console.error("Discord membership function failed.", error);
    return jsonResponse({ error: message }, status, corsHeaders);
  }
});
