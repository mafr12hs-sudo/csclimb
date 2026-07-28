// ============================================================================
// supabaseClient.js
// Single Supabase client instance. Every other service module imports FROM
// here — nothing else should call createClient().
// ============================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Replace with your project's values (Project Settings → API).
// The anon key is safe to expose client-side — RLS is what actually
// protects the data.
const SUPABASE_URL = '
https://wuptnpwntadknqmqmzle.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1cHRucHdudGFka25xbXFtemxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTc5MzYsImV4cCI6MjEwMDgzMzkzNn0.5o58fIwW5-G1C5Xizye-B1DHRj-nIEe3jDyZYK824TA
';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
