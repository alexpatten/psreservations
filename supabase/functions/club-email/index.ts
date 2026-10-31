/**
 * club-email: staff email their members (all, with or without a membership, on some plans, or
 * in some groups) through Resend.
 *
 *   { clubId, subject, body, audience: { audience, planIds?, groupIds? }, test? } → { sent }
 *
 * `test: true` sends only to the staff member sending it. Each member gets their own copy
 * (no one sees other addresses); "{first_name}" in the text becomes theirs.
 *
 * Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "Pickle Spots <clubs@picklespots.app>", on a domain
 * verified in Resend).
 *
 * Deploy: npx supabase functions deploy club-email
 */
import { withSupabase } from '@supabase/server';
import { json } from '../_shared/payments.ts';

const BATCH = 100; // Resend's batch limit

const escape = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const clubId = String(body.clubId ?? '');
    const subject = String(body.subject ?? '').trim();
    const text = String(body.body ?? '').trim();
    if (!subject || !text) return json({ error: 'Write a subject and a message.' }, 400);
    const { data: staff } = await ctx.supabase.rpc('res_is_staff', { p_club: clubId });
    if (!staff) return json({ error: 'Only club staff can email members.' }, 403);
    const key = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('EMAIL_FROM');
    if (!key || !from) return json({ error: 'Email isn’t set up yet (RESEND_API_KEY and EMAIL_FROM).' }, 500);

    const admin = ctx.supabaseAdmin;
    const { data: club } = await admin.from('clubs').select('name').eq('id', clubId).single();
    let recipients: { email: string; first_name: string }[];
    if (body.test) {
      recipients = [{ email: ctx.userClaims?.email ?? '', first_name: 'there' }];
    } else {
      const { data, error } = await admin.rpc('res_email_recipients', { p_club: clubId, p: body.audience ?? {} });
      if (error) return json({ error: error.message }, 400);
      recipients = data ?? [];
    }
    recipients = recipients.filter((r) => r.email);
    if (!recipients.length) return json({ error: 'No one matches that audience.' }, 400);

    const html = (name: string) =>
      `<div style="font:16px/1.5 system-ui,sans-serif;color:#13211B;max-width:560px">${escape(text.replaceAll('{first_name}', name))
        .split('\n')
        .map((line) => line || '&nbsp;')
        .join('<br>')}<p style="color:#6b7a73;font-size:13px;margin-top:24px">${escape(club?.name ?? '')} · sent with Pickle Spots</p></div>`;

    let sent = 0;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH).map((r) => ({
        from: `${club?.name ?? 'Your club'} <${from.replace(/^.*<|>.*$/g, '')}>`,
        to: [r.email],
        subject,
        html: html(r.first_name || 'there'),
        text: text.replaceAll('{first_name}', r.first_name || 'there'),
      }));
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error('Resend failed:', await res.text());
        return json({ error: sent ? `Sent ${sent}, then email stopped responding. Try again for the rest.` : 'Email didn’t send. Try again in a moment.' }, 502);
      }
      sent += batch.length;
    }
    if (!body.test) await admin.rpc('res_log_email', { p_club: clubId, p_subject: subject, p_body: text, p_audience: body.audience ?? {}, p_recipients: sent, p_by: ctx.userClaims?.id });
    return json({ sent });
  }),
};
