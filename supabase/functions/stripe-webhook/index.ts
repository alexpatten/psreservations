/**
 * stripe-webhook: Stripe's events from clubs' connected accounts.
 *
 *   checkout.session.completed  confirms a public booking (or refunds it if the court was
 *                               taken after its 15-minute hold ran out) and texts the guest,
 *                               or an event registration a member paid for (metadata.kind)
 *   checkout.session.expired    lets the held court go
 *   account.updated             records whether the club can take payments yet
 *
 * In the Stripe dashboard, add a Connect webhook endpoint ("Events on connected accounts")
 * at https://<project>.supabase.co/functions/v1/stripe-webhook with those three events, and
 * save its signing secret as STRIPE_WEBHOOK_SECRET.
 *
 * Deploy: npx supabase functions deploy stripe-webhook   (verify_jwt = false in config.toml)
 */
import { withSupabase } from '@supabase/server';
import { cryptoProvider, json, money, refund, sendText, siteUrl, stripe, when } from '../_shared/payments.ts';
import type Stripe from 'stripe';

export default {
  // Stripe signs the request instead; there's no Supabase credential.
  fetch: withSupabase({ auth: 'none', cors: false }, async (req, ctx) => {
    const signature = req.headers.get('stripe-signature');
    const payload = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(payload, signature ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '', undefined, cryptoProvider);
    } catch (err) {
      console.warn('Bad Stripe signature:', err);
      return json({ error: 'Bad signature' }, 400);
    }
    const admin = ctx.supabaseAdmin;

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.payment_status !== 'paid') break;
        const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

        // A member paying for an event registration.
        if (session.metadata?.kind === 'event') {
          const { data: e, error } = await admin.rpc('res_event_confirm', { p_session: session.id, p_payment_intent: paymentIntent, p_paid_cents: session.amount_total ?? 0 });
          if (error) {
            console.error('Confirming an event payment failed:', error);
            return json({ error: 'retry' }, 500);
          }
          if (e?.refund) {
            await refund(e.paymentIntent, e.paidCents, e.stripeAccount ?? event.account ?? null);
            await admin.rpc('res_notify', { p_club: e.clubId, p_user: e.userId, p_title: `Refunded: ${e.title}`, p_body: 'Your payment came in after your spot was released and the event filled up, so we refunded it.' });
          }
          break;
        }

        // A member paying an invoice (and maybe saving the card for autopay).
        if (session.metadata?.kind === 'invoice') {
          let card: string | null = null;
          let method: string | null = null;
          if (paymentIntent && event.account) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['payment_method'] }, { stripeAccount: event.account });
            const pm = pi.payment_method;
            if (pm && typeof pm !== 'string') {
              method = pm.id;
              card = pm.card ? `${pm.card.brand[0].toUpperCase()}${pm.card.brand.slice(1)} •${pm.card.last4}` : null;
            }
          }
          const { error } = await admin.rpc('res_invoice_paid_online', {
            p_session: session.id,
            p_cents: session.amount_total ?? 0,
            p_customer: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
            p_payment_method: method,
            p_card: card,
            p_autopay: session.metadata?.autopay === '1',
          });
          if (error) {
            console.error('Recording an invoice payment failed:', error);
            return json({ error: 'retry' }, 500);
          }
          break;
        }

        const { data: c, error } = await admin.rpc('res_public_confirm', {
          p_session: session.id,
          p_payment_intent: paymentIntent,
          p_paid_cents: session.amount_total ?? 0,
        });
        // A database error makes Stripe retry later.
        if (error) {
          console.error('Confirming a public booking failed:', error);
          return json({ error: 'retry' }, 500);
        }
        if (!c) break;
        const link = `${siteUrl(null)}/book/${c.slug}/r/${c.token}`;
        if (c.refund) {
          const refunded = await refund(c.paymentIntent, c.paidCents, c.stripeAccount ?? event.account ?? null);
          if (refunded) await admin.rpc('res_public_refunded', { p_reservation: c.reservationId, p_cents: refunded });
          await sendText(
            c.phone,
            `Sorry! Your payment for ${c.clubName} came in after the court was booked by someone else, so we refunded ${money(refunded)}. Book another time: ${siteUrl(null)}/book/${c.slug}`,
          );
        } else if (c.status === 'booked') {
          await sendText(c.phone, `You're booked at ${c.clubName}: ${c.courtName}, ${when(c.startsAt, c.timezone)}. Details or cancel: ${link}`);
        }
        break;
      }

      case 'checkout.session.expired': {
        await admin.rpc('res_public_release', { p_session: event.data.object.id });
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        await admin.from('clubs').update({ stripe_charges_enabled: account.charges_enabled }).eq('stripe_account_id', account.id);
        break;
      }
    }
    return json({ received: true });
  }),
};
