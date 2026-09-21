import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// ⚡ SUPABASE CONFIGURATION
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project credentials from
// your Supabase Dashboard: Settings -> API
// ─────────────────────────────────────────────────────────────────────────────

const gProcess = typeof globalThis !== 'undefined' ? (globalThis as any).process : undefined;

export const SUPABASE_URL: string =
  gProcess?.env?.['SUPABASE_URL'] || 'https://yoralnltzfrifmhxpdpo.supabase.co';

export const SUPABASE_ANON_KEY: string =
  gProcess?.env?.['SUPABASE_ANON_KEY'] ||
  'sb_publishable_OV8bJe4BzDCK0AaUrALjAA_UUVfkc78';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return supabaseClient;
}
