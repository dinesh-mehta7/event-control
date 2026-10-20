import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud console warning rather than a silent failure — this is the #1 cause
  // of a blank screen after wiring up Supabase for the first time.
  // eslint-disable-next-line no-console
  console.error(
    'Missing Supabase environment variables. Create a .env file (copy .env.example) ' +
      'with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart `npm run dev`.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
