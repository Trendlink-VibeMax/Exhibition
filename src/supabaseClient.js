import { createClient } from "@supabase/supabase-js";

const cleanEnvValue = (value) =>
  String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");

const supabaseUrl = cleanEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

let client = null;
let clientError = "";

if (hasSupabaseConfig) {
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Supabase URL must start with https://");
    }
    client = createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    clientError = `Supabase config error: ${error?.message || "check URL and anon key"}`;
  }
}

export const supabase = client;
export const supabaseConfigError = clientError;
