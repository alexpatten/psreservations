/**
 * stripe-connect: connects a club's own Stripe account so it can take payments (public
 * booking now; pro shop, events and dues later). Payments go straight to the club.
 *
 *   { action: 'onboard', clubId, origin }   → { url }  Stripe's sign-up/verification pages
 *   { action: 'refresh', clubId }           → { connected, chargesEnabled }
 *   { action: 'dashboard', clubId }         → { url }  the club's Stripe Express dashboard
 *
 * Club admins only.
 *
 * Deploy: npx supabase functions deploy stripe-connect
 */
import { withSupabase } from '@supabase/server';
import { json, siteUrl, stripe } from '../_shared/payments.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => ({}));
    const clubId = String(body.clubId ?? '');
    const { data: manager } = await ctx.supabase.rpc('res_is_manager', { p_club: clubId });
    if (!manager) return json({ error: 'Only club admins can set up payments.' }, 403);

    const admin = ctx.supabaseAdmin;
    const { data: club } = await admin.from('clubs').select('id, name, slug, stripe_account_id').eq('id', clubId).single();
    if (!club) return json({ error: 'Club not found.' }, 404);

    try {
      switch (body.action) {
        case 'onboard': {
          let account = club.stripe_account_id as string | null;
          if (!account) {
            const created = await stripe.accounts.create({
              type: 'express',
              email: ctx.userClaims?.email,
              business_profile: { name: club.name, mcc: '7997' }, // membership clubs (sports, recreation)
              capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
              metadata: { club_id: club.id },
            });
            account = created.id;
            await admin.from('clubs').update({ stripe_account_id: account }).eq('id', club.id);
          }
          const back = `${siteUrl(body.origin)}/c/${club.slug}/manage?section=public&stripe=done`;
          const link = await stripe.accountLinks.create({
            account,
            type: 'account_onboarding',
            refresh_url: `${siteUrl(body.origin)}/c/${club.slug}/manage?section=public&stripe=retry`,
            return_url: back,
          });
          return json({ url: link.url });
        }

        case 'refresh': {
          if (!club.stripe_account_id) return json({ connected: false, chargesEnabled: false });
          const account = await stripe.accounts.retrieve(club.stripe_account_id);
          await admin.from('clubs').update({ stripe_charges_enabled: account.charges_enabled }).eq('id', club.id);
          return json({ connected: true, chargesEnabled: account.charges_enabled, detailsSubmitted: account.details_submitted });
        }

        case 'dashboard': {
          if (!club.stripe_account_id) return json({ error: 'Connect Stripe first.' }, 400);
          const login = await stripe.accounts.createLoginLink(club.stripe_account_id);
          return json({ url: login.url });
        }

        default:
          return json({ error: 'Unknown action' }, 400);
      }
    } catch (err) {
      console.error('stripe-connect failed:', err);
      return json({ error: 'Stripe didn’t respond. Try again in a moment.' }, 502);
    }
  }),
};
