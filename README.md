# Pickle Spots Reservations

Court reservation software for clubs, in the spirit of the Pickle Spots app: web first, and
works on phones. It's an Expo (React Native) app with Expo Router and React Native Web,
running on the **same Supabase project as Pickle Spots** (`tyiviyefwgmlmzbzuzog`). Players
sign in with their Pickle Spots account and add each other by Pickle Spots Player ID.

The database side is in `supabase/`: migrations in `supabase/migrations/` and the payment and
text-message Edge Functions in `supabase/functions/`. It only adds its own tables and
functions (named `res_*`) to the shared database; nothing in the Pickle Spots app depends on
them.

## Set up

1. **Apply the migrations** with `supabase db query`, oldest first, each one once:
   ```sh
   npx supabase link --project-ref tyiviyefwgmlmzbzuzog
   for f in supabase/migrations/*.sql; do npx supabase db query --linked -f "$f"; done   # a fresh database
   npx supabase db query --linked -f supabase/migrations/<new file>.sql                # later: just the new one
   ```
   Not `supabase db push`: the project's migration history belongs to the Pickle Spots repo,
   so `db push` from here would refuse (the history has Pickle Spots migrations this folder
   doesn't), and recording these there would make `db push` in Pickle Spots refuse in turn.
   `db query` runs a file without touching that history.

   Payments, texts, email and smart locks need Edge Functions and their secrets (see *Edge
   Functions* below).
2. **Run the app** (Node 24+):
   ```sh
   npm install
   npm run web          # http://localhost:8081
   ```
   `npm run build:web` exports a static single-page site to `dist/`. Host it anywhere that
   sends unknown paths to `index.html` (Netlify, Vercel, Cloudflare Pages, S3 + CloudFront).

`.env` holds the Supabase URL and publishable key, the same values as `pickleparks/app/.env`.
Both are meant to ship; Row Level Security and the `res_*` database functions decide what
each person can see and do.

**Accounts.** Creating an account here makes a Pickle Spots account. Supabase's confirmation
email links to `picklespots.app/auth/confirm`, which opens the Pickle Spots app (or forwards
to it); once confirmed, the account signs in here too. Password reset works the same way.

## How it works

**Clubs.** Anyone signed in can create a club (*New Club* on Home) and becomes its owner. It
starts with the courts you ask for, one scheduler with all of them (7 AM–10 PM, 30-minute
slots) and the usual reservation types. Players find a club on Home and join it; joining
tells them that staff will see their full name and email. Roles per club:

| Role   | Can |
| ------ | --- |
| Member | Book within the rules, cancel their own, add players, check themselves in |
| Staff  | Book anything for anyone (or no one), move reservations, check in, mark no-shows, close courts, add members, waive strikes, run the kiosk |
| Admin  | Also change settings: rules, courts, types, schedulers, prime time, custom fields |
| Owner  | Also make other owners. A club always keeps one. |

Pickle Spots admins (`admin_users`) count as owners of every club.

**The schedule** (`/c/<club>`) is a column per court and a row per slot. Tap a free slot to
book it; tap a reservation to see it. Reservations are colored by type. Prime time is shaded,
closed and past times are gray, and the red line is now. Staff on a computer drag
reservations to another court or time. On a phone, *Move* on the reservation does the same.

**Booking rules** (members only; staff skip them): how far ahead, shortest and longest
reservation (a court or ball machine can override these), upcoming reservations at once,
reservations per day, players per type (staff-only types for lessons, clinics, maintenance),
times that fit a member-bookable scheduler on its slot grid, required custom fields, and
**prime time** windows with their own longest reservation, weekly limit and booking window.
Nobody, staff included, can book over another reservation or a closure.

**Combo courts.** A court can be part of another (two pickleball courts in a tennis court).
Booking the whole court blocks its parts and the other way around; the schedule shows
"In use (Tennis 1)" on the blocked columns.

**Ball machines** are courts of kind *ball machine*, with their own length limits and
staff-only switch.

**Custom schedulers** are views of some courts with their own days, hours and slot length.
Members book a court at times that fit a scheduler it's in.

**Recurring reservations.** Staff turn on *Repeat Weekly* when booking: the days of the week,
through a date, up to a year. Dates that are already taken or closed are skipped and listed.
*Cancel All Upcoming in This Series* is on each of its reservations.

**Closures.** *Close for Weather* closes every court for the rest of today and cancels what's
booked. *New Closure* closes some or all courts for any stretch, with or without cancelling.
Closures cancel without penalty.

**Check-in and cancellation penalties.** Players check themselves in from the club's window
before the start (default 30 minutes), or staff check them in. Once a reservation starts,
staff can mark a player a no-show. Cancelling inside the cutoff (default 24 hours) is a late
cancellation. Both are strikes, each recording the club's fee for invoicing later. Enough
strikes in the window (default 3 in 30 days) pauses that player's booking for a while
(default 7 days). Staff waive strikes from *Manage › Cancellation Penalties* or a member's
page.

**Lobby view** (`/lobby/<token>`) is a big-screen board for a TV: each court's status now,
when it's next free, and what's coming up today. It needs no sign-in; the token is the key.
Names are first name + last initial, and admins can hide them or make a new link.

**Kiosk** (`/kiosk/<club>`) is a front-desk tablet station, opened while signed in as staff:
players enter their Player ID to check in or book the next open court (they're checked in
right away), and new players create an account. It returns to the start screen after a
minute idle.

**Public booking** (`/book/<club>`) lets anyone book without an account or membership. They
pick the sport, reservation type, players, length, day and time, verify their mobile number
with a texted code, and pay upfront on Stripe Checkout (cards, Apple Pay, Google Pay) straight
into the club's own Stripe account, with no per-booking fee. The court is held for 15 minutes
while they pay; unpaid holds are released. They get a confirmation text with a link to see or
cancel the booking (refunded if before the club's cutoff). Staff turn it on under
*Manage › Public Booking*: which schedulers (courts and hours) and reservation types are
public, each type's price per hour, how far ahead and how many upcoming bookings per phone,
plus Stripe setup and a share kit (link, QR code, website button and embed code, and how to add
the link as the "Book online" button on a Google Business Profile). Online bookings show on
the schedule with a link icon (outlined while awaiting payment), with the guest's contact
details. Staff cancelling one refunds it in full. Every guest is kept under *Manage › Guests*
(with CSV export) for follow-up.

**Lessons** (`/c/<club>/lessons`). Clubs add their pros under *Manage › Instructors*: type
(Head Pro, Coach…), color, bio, weekly teaching hours, time off, whether members can book them
online, and optionally their Pickle Spots account. *Manage › Pro Pricing* sets hourly rates for
one pro, an instructor type or everyone, for some days and hours, and up to a number of
players (private, semi-private…); a lesson uses the rate for the smallest group that fits, and
of those the most specific. Members pick a pro, length, players, day and one of the pro's open
times (each with its price), and get the next free court. The schedule's *Instructors* view is
the instructor scheduler: a column per pro, with their hours open, time off gray, and their
lessons and clinic dates as blocks (tap an open slot to book). **Clinics** (*Manage › Clinics*)
are group programs on one or more dates with spots, a program price, an optional drop-in price,
and a waitlist that moves the next player up automatically when someone drops; registered
players are on every date, so attendance works like court check-in. Pros linked to an account
get a **Teaching** tab: their week with each roster to tap players in, and their time off.
*Manage › Instructor Report* is time reporting: hours on court against hours available
(utilization), lessons and clinic dates, billed and paid, students and attendance, with CSV
export. Lesson and clinic prices are recorded for the front desk to collect (*Mark Paid*);
online payment and charging to an account come with Batch Billing & Invoicing.

**Pro Shop & POS** (*Pro Shop* tab, staff). A register with products by category, search or
barcode scan, custom items (court time, guest fees), line and cart discounts, and taxes
added or included per product; paid by cash (with change), card, charge to a member's account,
or other; with a receipt. Products track stock with restocks and adjustments, and anything at
or below its reorder level is flagged everywhere. Sales show totals, payment methods, sales
by category and best sellers; refunds put stock back and credit accounts.

**Events** (*Events* tab; *Manage › Events & Clinics*). Clinics grow into programs, socials
and tournaments: categories, gender/age/rating restrictions (members add their birth date and
gender under My Details; ratings are the club's own scale or Pickle Spots DUPR), terms to
accept, custom questions, a registration window, members-only or open to anyone, and online
payment (the spot is held 15 minutes while they pay). A public page lists published events
for the club's website (`/events/<club>`, with embed code). A bell in the header carries
notifications (moving up from a waitlist, new invoices, door codes, league news).

**Memberships** (*Membership* tab; *Manage › Membership Plans, Groups, Waivers, Email
Members, Custom Ratings*). Plans with a price and period and booking perks (book further ahead,
more upcoming or per day); clubs can require a membership to book. Families share family
plans. Groups can be visible for members to join. Waivers are signed online with a drawn
signature; required ones must be signed before booking, and changing the text asks everyone
to sign again. Staff check members in at the desk or kiosk without a reservation, email
members by plan, group or status, and see each member's profile (plans, balance, visits,
waivers, family, groups, ratings).

**Billing** (*Billing* tab; *Manage › Billing & Invoices*). Lessons, events, league fees,
strike fees, dues and pro shop charges land on members' accounts as they happen; desk
payments and cancellations post automatically. A billing run charges dues that have come due
and turns unbilled charges into invoices (drafts to review, or sent with a notification).
Invoices use the club's template (color, header, how to pay) and print or save as PDF; staff
record payments, void, and charge or credit accounts; members pay online and can save a card,
which *Run Autopay* charges.

**Leagues & Ladders** (*Leagues* tab). Singles or doubles leagues: sign-ups (with a partner),
a generated round-robin schedule booked on courts each league night, score reporting with
the other side confirming, standings, and a message board. Ladders: challenge up to N places
above you; a winning challenger takes the place.

**Access Control** (*Manage › Access Control*; codes on *My Reservations*). Each reservation
gets a door code for the doors covering its court (or one daily code for everyone with a
reservation that day), valid a few minutes before to a few after, following the booking
when it moves or is cancelled. Locks connected through Seam get codes automatically; the access
log shows every unlock matched to its reservation, with optional staff notifications.

**Pulse** (*Pulse* tab: admins, and staff they allow). Financials (gross to net, recurring
vs one-off, sales by category), utilization (booked vs open court-hours, a weekday × hour heat
map, by type and sport, unsold hours, and walk-up play from Pickle Spots check-ins once the
club is linked to its court under Club Details), engagement (active and new players,
retention, churn, members at risk), demographics (age, gender, skill, ZIP codes) and
instructors, each against the period before, with automated insights. Admins choose which tabs
and cards show; every tab exports to CSV, and Print saves a PDF.

## Public booking setup

The database side is `supabase/migrations/20261030000000_public_booking.sql`; the Edge
Functions are in `supabase/functions/`: `public-booking` (texts and Checkout),
`stripe-webhook` (confirms payments) and `stripe-connect` (clubs connect Stripe).

1. **Stripe.** In the platform's Stripe account, turn on Connect (Express accounts). Add a
   webhook endpoint for *events on connected accounts* at
   `https://tyiviyefwgmlmzbzuzog.supabase.co/functions/v1/stripe-webhook` with
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired` and `account.updated`.
2. **Twilio.** Create a Verify service (for the codes) and a Messaging Service or number (for
   confirmations).
3. **Secrets and deploy** (from this repo, once linked as above):
   ```sh
   npx supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_... \
     TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_VERIFY_SERVICE_SID=VA... \
     TWILIO_MESSAGING_SERVICE_SID=MG... RESERVATIONS_URL=https://<where this app is hosted>
   npx supabase functions deploy public-booking
   npx supabase functions deploy stripe-webhook
   npx supabase functions deploy stripe-connect
   ```
   `config.toml` turns off the platform JWT check for `public-booking` (it checks the
   publishable key itself) and `stripe-webhook` (Stripe signs its calls).

## Edge Functions

| Function | Does | Secrets |
| --- | --- | --- |
| `public-booking` | Public booking: texted codes, Checkout, cancel/refund | Stripe, Twilio, `RESERVATIONS_URL` |
| `stripe-webhook` | Confirms public bookings, event registrations and invoice payments | `STRIPE_WEBHOOK_SECRET` |
| `stripe-connect` | Clubs connect their Stripe account | `STRIPE_SECRET_KEY` |
| `club-payments` | Members pay events and invoices online; staff run autopay | `STRIPE_SECRET_KEY` |
| `club-email` | Staff email members (via Resend) | `RESEND_API_KEY`, `EMAIL_FROM` |
| `access-sync` | Pushes door codes to Seam locks; run every minute | `SEAM_API_KEY` |
| `seam-webhook` | Records unlocks into the access log | `SEAM_WEBHOOK_SECRET` |

Deploy each with `npx supabase functions deploy <name>`. To run `access-sync` every minute,
in the dashboard's SQL editor (Integrations › Cron, with pg_net on):

```sql
select cron.schedule('access-sync', '* * * * *', $$
  select net.http_post(url := 'https://tyiviyefwgmlmzbzuzog.supabase.co/functions/v1/access-sync',
                       headers := jsonb_build_object('apikey', '<secret key>', 'Content-Type', 'application/json'))
$$);
```

## Code

- `src/app/`: screens (Expo Router). `c/[slug]/` is a club: `index` (schedule), `mine`,
  `manage`. `kiosk/[slug]` and `lobby/[token]` are full-screen. `book/[slug]` is the public
  booking page and `book/[slug]/r/[token]` a guest's booking.
- `src/components/`: `SchedulerGrid` (the grid and drag-and-drop), `BookingSheet`,
  `ReservationSheet`, `manage/*` (settings screens), `ui` (buttons, fields, sheets).
- `src/lib/api.ts`: typed wrappers for the `res_*` database functions.
- `src/lib/time.ts`: times in the club's time zone (hours, prime time and daily limits use
  it, wherever the viewer is).
- `src/lib/theme.ts`: Pickle Spots' light colors and background gradient (without the court
  lines). Like the Pickle Spots website, the app stays light even when the device is in dark
  mode.

```sh
npm run typecheck
```
