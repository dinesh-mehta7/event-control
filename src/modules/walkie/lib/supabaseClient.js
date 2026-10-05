import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    // Loud console warning rather than a silent failure — this is the #1 cause
    // of a blank screen after wiring up Supabase for the first time.
    // eslint-disable-next-line no-console
    console.error(
        'Missing Supabase environment variables. Create a .env file (copy .env.example) ' +
        'with REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY, then restart `npm start`.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
