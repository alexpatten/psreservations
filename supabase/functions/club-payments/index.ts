/**
 * club-payments: online payments by signed-in members, on the club's connected Stripe account.
 *
 *   { action: 'event', registrationId, origin }   → { url }  pays a registration held for 15 minutes
 *   { action: 'invoice', invoiceId, autopay, origin } → { url }  pays an invoice; autopay saves the card
 *   { action: 'autopay', clubId }                 → { charged, failed }  staff: charges saved cards for open invoices
 *
 * stripe-webhook confirms the payment (metadata.kind tells it what was paid for).
 *
 * Deploy: npx supabase functions deploy club-payments
 */
import { withSupabase } from '@supabase/server';
import { json, siteUrl, stripe } from '../_shared/payments.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const uid = ctx.userClaims?.id;
    if (!uid) return json({ error: 'Please sign in again.' }, 401);
    const admin = ctx.supabaseAdmin;
    const site = siteUrl(body.origin);

    try {
      switch (body.action) {
        case 'event': {
          const { data: info } = await admin.rpc('res_event_checkout_info', { p_registration: String(body.registrationId ?? ''), p_user: uid });
          if (!info) return json({ error: 'This registration isn’t waiting for payment. It may have timed out; register again.' }, 400);
          if (!info.stripeAccount) return json({ error: 'The club isn’t taking online payments yet.' }, 400);
          const session = await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              line_items: [{ quantity: 1, price_data: { currency: info.currency, unit_amount: info.amountCents, product_data: { name: info.title, description: info.clubName } } }],
              customer_email: info.email ?? undefined,
              expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
              success_url: `${site}/c/${info.slug}/events?paid=1`,
              cancel_url: `${site}/c/${info.slug}/events`,
              metadata: { kind: 'event', registration_id: info.registrationId },
            },
            { stripeAccount: info.stripeAccount },
          );
          await admin.rpc('res_event_attach_session', { p_registration: info.registrationId, p_session: session.id });
          return json({ url: session.url });
        }

        case 'invoice': {
          const { data: info } = await admin.rpc('res_invoice_checkout_info', { p_invoice: String(body.invoiceId ?? ''), p_user: uid });
          if (!info) return json({ error: 'This invoice isn’t open for payment.' }, 400);
          if (!info.stripeAccount) return json({ error: 'The club isn’t taking online payments yet.' }, 400);
          const opts = { stripeAccount: info.stripeAccount };
          // A customer on the club's account, so the card can be saved for autopay.
          const customer = info.customer ?? (await stripe.customers.create({ email: info.email ?? undefined, metadata: { user_id: uid } }, opts)).id;
          const session = await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              customer,
              line_items: [{ quantity: 1, price_data: { currency: info.currency, unit_amount: info.dueCents, product_data: { name: `Invoice ${info.number}`, description: info.clubName } } }],
              payment_intent_data: body.autopay ? { setup_future_usage: 'off_session' } : undefined,
              success_url: `${site}/c/${info.slug}/billing?paid=1`,
              cancel_url: `${site}/c/${info.slug}/billing`,
              metadata: { kind: 'invoice', invoice_id: info.invoiceId, autopay: body.autopay ? '1' : '0' },
            },
            opts,
          );
          await admin.rpc('res_attach_invoice_session', { p_invoice: info.invoiceId, p_session: session.id });
          return json({ url: session.url });
        }

        case 'autopay': {
          const clubId = String(body.clubId ?? '');
          const { data: staff } = await ctx.supabase.rpc('res_is_staff', { p_club: clubId });
          if (!staff) return json({ error: 'Only club staff can run autopay.' }, 403);
          const { data: due } = await admin.rpc('res_autopay_due', { p_club: clubId });
          let charged = 0;
          const failed: string[] = [];
          for (const d of due ?? []) {
            try {
              const intent = await stripe.paymentIntents.create(
                { amount: d.dueCents, currency: d.currency, customer: d.customer, payment_method: d.paymentMethod, off_session: true, confirm: true, metadata: { kind: 'autopay', invoice_id: d.invoiceId } },
                { stripeAccount: d.stripeAccount },
              );
              if (intent.status === 'succeeded') {
                await admin.rpc('res_pay_invoice', { p_invoice: d.invoiceId, p_cents: d.dueCents, p_method: 'autopay', p_by: uid });
                charged++;
              } else failed.push(d.number);
            } catch (err) {
              console.warn('Autopay failed for', d.number, err);
              failed.push(d.number);
              await admin.rpc('res_notify', { p_club: clubId, p_user: d.userId, p_title: `Autopay didn’t go through for ${d.number}`, p_body: 'Please pay it online or update your card.' });
            }
          }
          return json({ charged, failed });
        }

        default:
          return json({ error: 'Unknown action' }, 400);
      }
    } catch (err) {
      console.error('club-payments failed:', err);
      return json({ error: 'Payments didn’t respond. Try again in a moment.' }, 502);
    }
  }),
};
