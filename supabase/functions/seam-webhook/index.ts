/**
 * seam-webhook: Seam tells us when a lock is unlocked (or a wrong code is tried); it goes in
 * the club's access log, matched to the code and reservation, and staff are notified when the
 * club wants that.
 *
 * In the Seam console, add a webhook to https://<project>.supabase.co/functions/v1/seam-webhook
 * for lock.unlocked and lock.access_denied, and save its secret as SEAM_WEBHOOK_SECRET.
 *
 * Deploy: npx supabase functions deploy seam-webhook   (verify_jwt = false in config.toml)
 */
import { withSupabase } from '@supabase/server';
import { Webhook } from 'svix';
import { json } from '../_shared/payments.ts';

export default {
  // Seam signs its calls (Svix) instead of sending a Supabase credential.
  fetch: withSupabase({ auth: 'none', cors: false }, async (req, ctx) => {
    const payload = await req.text();
    let event: { event_type?: string; device_id?: string; access_code_id?: string; occurred_at?: string; method?: string };
    try {
      event = new Webhook(Deno.env.get('SEAM_WEBHOOK_SECRET') ?? '').verify(payload, {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      }) as typeof event;
    } catch {
      return json({ error: 'Bad signature' }, 400);
    }
    if (event.event_type === 'lock.unlocked' || event.event_type === 'lock.access_denied') {
      await ctx.supabaseAdmin.rpc('res_access_event', {
        p_device_id: event.device_id,
        p_seam_code_id: event.access_code_id ?? null,
        p_kind: event.event_type === 'lock.access_denied' ? 'denied' : 'unlock',
        p_at: event.occurred_at ?? new Date().toISOString(),
        p_detail: { method: event.method ?? null },
      });
    }
    return json({ received: true });
  }),
};
