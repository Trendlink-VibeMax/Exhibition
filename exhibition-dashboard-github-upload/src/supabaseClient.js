import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

let client = null;
let clientError = "";

if (hasSupabaseConfig) {
  try {
    client = createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    clientError = error?.message || "Supabase configuration error";
  }
}

export const supabase = client;
export const supabaseConfigError = clientError;
