/**
 * access-sync: pushes door codes to smart locks through Seam (new and moved codes are set on
 * the lock with their time window; revoked ones are removed). Run it every minute with Supabase
 * Cron (see the README); it's called with the secret key.
 *
 * Secret: SEAM_API_KEY.
 *
 * Deploy: npx supabase functions deploy access-sync   (verify_jwt = false in config.toml)
 */
import { withSupabase } from '@supabase/server';
import { json } from '../_shared/payments.ts';

const SEAM = 'https://connect.getseam.com';

async function seam(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${SEAM}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('SEAM_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Seam ${res.status}`);
  return data;
}

interface Pending {
  id: string;
  status: 'pending' | 'revoked';
  code: string;
  deviceId: string;
  seamCodeId: string | null;
  startsAt: string;
  endsAt: string;
  name: string;
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    if (!Deno.env.get('SEAM_API_KEY')) return json({ error: 'SEAM_API_KEY is not set.' }, 500);
    const admin = ctx.supabaseAdmin;
    const { data, error } = await admin.rpc('res_access_to_sync');
    if (error) return json({ error: error.message }, 500);
    let ok = 0;
    let failed = 0;
    for (const c of (data ?? []) as Pending[]) {
      try {
        let seamCodeId = c.seamCodeId;
        if (c.status === 'revoked') {
          await seam('/access_codes/delete', { access_code_id: c.seamCodeId });
        } else if (seamCodeId) {
          await seam('/access_codes/update', { access_code_id: seamCodeId, starts_at: c.startsAt, ends_at: c.endsAt });
        } else {
          const r = await seam('/access_codes/create', { device_id: c.deviceId, code: c.code, name: c.name, starts_at: c.startsAt, ends_at: c.endsAt });
          seamCodeId = r.access_code?.access_code_id ?? null;
        }
        await admin.rpc('res_access_synced', { p_id: c.id, p_seam_code_id: seamCodeId, p_ok: true });
        ok++;
      } catch (err) {
        await admin.rpc('res_access_synced', { p_id: c.id, p_seam_code_id: null, p_ok: false, p_error: String(err instanceof Error ? err.message : err) });
        failed++;
      }
    }
    return json({ synced: ok, failed });
  }),
};
