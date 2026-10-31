/**
 * public-booking: the Pickle Spots Reservations public booking page (/book/<slug>), for guests
 * without an account, and refunds when staff cancel a paid public booking.
 *
 *   { action: 'send-code', slug, phone }                 texts a verification code
 *   { action: 'check-code', slug, phone, code }          → { verification }
 *   { action: 'book', slug, verification, typeId, sport, startsAt, minutes, players,
 *     firstName, lastName, email, origin }               → { token, checkoutUrl? }
 *   { action: 'release', token }                         the guest backed out of paying
 *   { action: 'cancel', token }                          the guest cancels (refund before the cutoff)
 *   { action: 'staff-cancel', reservationId }            staff cancel (signed in; full refund)
 *
 * Paid bookings are held for 15 minutes while the guest pays on Stripe Checkout (on the
 * club's connected account; no platform fee). stripe-webhook confirms them.
 * Database side: supabase/migrations/20261030000000_public_booking.sql.
 *
 * Deploy: npx supabase functions deploy public-booking   (verify_jwt = false in config.toml)
 */
import { withSupabase } from '@supabase/server';
import { checkCode, json, money, refund, sendCode, sendText, siteUrl, stripe, when } from '../_shared/payments.ts';

/** US numbers typed any which way, or anything already in +E.164. */
function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const bare = digits.replace(/\D/g, '');
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return null;
}

/** Database errors raised for guests are already in plain words. */
const message = (error: { message?: string } | null) => error?.message || 'Something went wrong. Try again.';

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const admin = ctx.supabaseAdmin;

    try {
      switch (body.action) {
        case 'send-code': {
          const phone = normalizePhone(body.phone);
          if (!phone) return json({ error: 'Enter a mobile number, like (512) 555-0100.' }, 400);
          const { data: club } = await admin.rpc('res_public_club', { p_slug: String(body.slug ?? '') });
          if (!club) return json({ error: 'This club isn’t taking public bookings right now.' }, 404);
          await sendCode(phone);
          return json({ sent: true, phone });
        }

        case 'check-code': {
          const phone = normalizePhone(body.phone);
          const code = String(body.code ?? '').replace(/\D/g, '');
          if (!phone || code.length < 4) return json({ error: 'Enter the code we texted you.' }, 400);
          const { data: club } = await admin.rpc('res_public_club', { p_slug: String(body.slug ?? '') });
          if (!club) return json({ error: 'This club isn’t taking public bookings right now.' }, 404);
          if (!(await checkCode(phone, code))) return json({ error: 'That code didn’t work. Check it, or send a new one.' }, 400);
          const { data, error } = await admin.from('public_verifications').insert({ club_id: club.id, phone }).select('token').single();
          if (error) throw error;
          return json({ verification: data.token, phone });
        }

        case 'book': {
          const { data: hold, error } = await admin.rpc('res_public_hold', {
            p_slug: String(body.slug ?? ''),
            p_verification: String(body.verification ?? ''),
            p_type: body.typeId,
            p_sport: String(body.sport ?? ''),
            p_starts_at: new Date(Number(body.startsAt)).toISOString(),
            p_minutes: Number(body.minutes),
            p_players: Number(body.players),
            p_first_name: String(body.firstName ?? ''),
            p_last_name: String(body.lastName ?? ''),
            p_email: body.email ? String(body.email) : null,
          });
          if (error) return json({ error: message(error) }, 400);

          const site = siteUrl(body.origin);
          const link = `${site}/book/${hold.slug}/r/${hold.token}`;
          if (hold.status === 'booked') {
            await sendText(hold.phone, `You're booked at ${hold.clubName}: ${hold.courtName}, ${when(hold.startsAt, hold.timezone)}. Details or cancel: ${link}`);
            return json({ token: hold.token });
          }

          // Stripe keeps a Checkout session open for at least 30 minutes; the court is held for
          // 15, and a payment after that is confirmed only if the court is still free.
          const session = await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: hold.currency,
                    unit_amount: hold.amountCents,
                    product_data: {
                      name: `${hold.typeName} · ${hold.courtName}`,
                      description: `${hold.clubName}, ${when(hold.startsAt, hold.timezone)}`,
                    },
                  },
                },
              ],
              customer_email: hold.email ?? undefined,
              expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
              success_url: `${link}?paid=1`,
              cancel_url: `${site}/book/${hold.slug}?released=${hold.token}`,
              metadata: { reservation_id: hold.reservationId, token: hold.token },
              payment_intent_data: { metadata: { reservation_id: hold.reservationId } },
            },
            { stripeAccount: hold.stripeAccount },
          );
          await admin.rpc('res_public_attach_session', { p_reservation: hold.reservationId, p_session: session.id });
          return json({ token: hold.token, checkoutUrl: session.url });
        }

        case 'release': {
          const { data } = await admin.rpc('res_public_release', { p_token: String(body.token ?? '') });
          if (data?.session && data?.stripeAccount) {
            await stripe.checkout.sessions.expire(data.session, {}, { stripeAccount: data.stripeAccount }).catch(() => {});
          }
          return json({ released: !!data });
        }

        case 'cancel':
        case 'staff-cancel': {
          let reservationId: string | null = null;
          if (body.action === 'staff-cancel') {
            if (ctx.authMode !== 'user' || !ctx.userClaims?.id) return json({ error: 'Please sign in again.' }, 401);
            reservationId = String(body.reservationId ?? '');
            const { data: row } = await admin.from('reservations').select('club_id').eq('id', reservationId).maybeSingle();
            const { data: staff } = row ? await ctx.supabase.rpc('res_is_staff', { p_club: row.club_id }) : { data: false };
            if (!staff) return json({ error: 'Only club staff can do that.' }, 403);
          }
          const { data: c, error } = await admin.rpc('res_public_cancel', {
            p_token: reservationId ? null : String(body.token ?? ''),
            p_reservation: reservationId,
            p_by: reservationId ? ctx.userClaims?.id : null,
          });
          if (error) return json({ error: message(error) }, 400);
          if (c.session && c.stripeAccount) {
            await stripe.checkout.sessions.expire(c.session, {}, { stripeAccount: c.stripeAccount }).catch(() => {});
          }
          const refunded = await refund(c.paymentIntent ?? null, c.refundCents ?? 0, c.stripeAccount ?? null);
          if (refunded) await admin.rpc('res_public_refunded', { p_reservation: c.reservationId, p_cents: refunded });
          if (c.reservationId) {
            await sendText(
              c.phone,
              `Your booking at ${c.clubName} on ${when(c.startsAt, c.timezone)} is cancelled.` +
                (refunded ? ` We refunded ${money(refunded, c.currency)} to your card.` : '') +
                (reservationId ? ' Sorry for the trouble!' : ''),
            );
          }
          return json({ cancelled: true, refundedCents: refunded });
        }

        default:
          return json({ error: 'Unknown action' }, 400);
      }
    } catch (err) {
      console.error('public-booking failed:', err);
      return json({ error: err instanceof Error && !('type' in err) ? err.message : 'Something went wrong. Try again.' }, 500);
    }
  }),
};
