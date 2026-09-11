import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * True only when the request comes from the shop's own admin account.
 *
 * verify_jwt on its own is not enough. The gateway accepted the site's public
 * key as though it were a login, and that key is readable by anyone in main.js,
 * so both shipping functions answered callers who had no account at all.
 *
 * The database decides instead. is_admin() is the same function the table
 * policies use, so who counts as admin is defined in exactly one place. An
 * admin ID copied into several places went stale once already - the policies
 * named an account that had since been deleted.
 */
export async function callerIsAdmin(req: Request): Promise<boolean> {
  const authorization = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return false;

  // Act as the caller, so is_admin() sees their identity rather than a service one
  const client = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data, error } = await client.rpc('is_admin');
  if (error) console.warn('Admin check could not be completed:', error.message);
  return !error && data === true;
}
