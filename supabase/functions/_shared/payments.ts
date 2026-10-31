/**
 * Stripe (payments, on each club's connected account) and Twilio (phone verification and
 * texts) for the reservations functions. Secrets, set with `npx supabase secrets set`:
 *
 *   STRIPE_SECRET_KEY            the platform's Stripe secret key (sk_live_… / sk_test_…)
 *   STRIPE_WEBHOOK_SECRET        signing secret of the Connect webhook endpoint (whsec_…)
 *   TWILIO_ACCOUNT_SID           AC…
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID    VA… (a Verify service, for the texted codes)
 *   TWILIO_MESSAGING_SERVICE_SID MG… (or TWILIO_FROM_NUMBER, +1…), for confirmations
 *   RESERVATIONS_URL             where the web app lives, e.g. https://book.picklespots.app
 */
import Stripe from 'stripe';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
});

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The web app's address: the configured one, or a local dev server the request came from. */
export function siteUrl(origin: unknown): string {
  const configured = (Deno.env.get('RESERVATIONS_URL') ?? '').replace(/\/$/, '');
  if (typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return configured || 'http://localhost:8081';
}

function twilioAuth() {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!sid || !token) return null;
  return { sid, header: `Basic ${btoa(`${sid}:${token}`)}` };
}

async function twilioPost(url: string, auth: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

/** Texts a verification code. Throws a message for the player. */
export async function sendCode(phone: string) {
  const auth = twilioAuth();
  const service = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  if (!auth || !service) throw new Error('Phone verification isn’t set up yet. Please call the club.');
  const { ok, body } = await twilioPost(`https://verify.twilio.com/v2/Services/${service}/Verifications`, auth.header, {
    To: phone,
    Channel: 'sms',
  });
  if (!ok) {
    console.error('Twilio Verify start failed:', body);
    // 60200: invalid number; 60203: too many sends.
    throw new Error(body?.code === 60203 ? 'Too many codes sent. Wait a few minutes and try again.' : 'We couldn’t text that number. Check it and try again.');
  }
}

/** Whether the code texted to the phone is right. */
export async function checkCode(phone: string, code: string): Promise<boolean> {
  const auth = twilioAuth();
  const service = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  if (!auth || !service) throw new Error('Phone verification isn’t set up yet. Please call the club.');
  const { ok, body } = await twilioPost(`https://verify.twilio.com/v2/Services/${service}/VerificationCheck`, auth.header, {
    To: phone,
    Code: code,
  });
  return ok && body?.status === 'approved';
}

/** Sends a text. Never throws: a confirmation that doesn't arrive shouldn't undo a booking. */
export async function sendText(phone: string | null | undefined, message: string) {
  const auth = twilioAuth();
  if (!auth || !phone) return;
  const service = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
  const from = Deno.env.get('TWILIO_FROM_NUMBER');
  if (!service && !from) return;
  const { ok, body } = await twilioPost(`https://api.twilio.com/2010-04-01/Accounts/${auth.sid}/Messages.json`, auth.header, {
    To: phone,
    Body: message,
    ...(service ? { MessagingServiceSid: service } : { From: from! }),
  });
  if (!ok) console.error('Twilio text failed:', body);
}

/** "Sat, Nov 1 at 7:30 PM" in the club's time zone. */
export function when(ms: number, timeZone: string) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

export function money(cents: number, currency = 'usd') {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
}

/** Refunds a payment on the club's account; returns the cents refunded (0 when nothing to refund). */
export async function refund(paymentIntent: string | null, cents: number, stripeAccount: string | null) {
  if (!paymentIntent || !stripeAccount || cents <= 0) return 0;
  await stripe.refunds.create({ payment_intent: paymentIntent, amount: cents }, { stripeAccount });
  return cents;
}
