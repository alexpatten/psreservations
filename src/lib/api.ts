import { supabase } from './supabase';

/** Calls a database function; its error message (written for players) becomes the Error's. */
/** Calls one of the Edge Functions (payments and texts); their errors are written for players. */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // The function's own message is in the response body.
    const context = (error as { context?: Response }).context;
    const detail = context ? await context.json().catch(() => null) : null;
    throw new Error(detail?.error ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Something went wrong. Try again.');
  return data as T;
}

export type Role = 'member' | 'staff' | 'admin' | 'owner';

export const isStaff = (role: Role | null | undefined) => role === 'staff' || role === 'admin' || role === 'owner';
export const isManager = (role: Role | null | undefined) => role === 'admin' || role === 'owner';

export interface Rules {
  minMinutes: number;
  maxMinutes: number;
  advanceDays: number;
  maxUpcoming: number;
  maxPerDay: number;
  cancelCutoffHours: number;
  lateCancelFeeCents: number;
  noShowFeeCents: number;
  strikeLimit: number;
  strikeWindowDays: number;
  suspensionDays: number;
  checkInMinutesBefore: number;
}

export interface Court {
  id: string;
  name: string;
  kind: 'court' | 'ball_machine';
  sport: 'pickleball' | 'tennis' | 'padel' | 'other';
  indoor: boolean;
  parentId: string | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  membersCanBook: boolean;
  sortOrder: number;
}

export interface ReservationType {
  id: string;
  name: string;
  color: string;
  minPlayers: number;
  maxPlayers: number;
  membersCanBook: boolean;
  sortOrder: number;
}

export interface Scheduler {
  id: string;
  name: string;
  courtIds: string[];
  days: number[];
  opens: string;
  closes: string;
  slotMinutes: number;
  membersCanBook: boolean;
  sortOrder: number;
}

export interface PrimeTime {
  id: string;
  name: string;
  courtIds: string[];
  days: number[];
  starts: string;
  ends: string;
  maxMinutes: number | null;
  maxPerWeek: number | null;
  advanceDays: number | null;
}

export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'select';
  options?: string[];
  required?: boolean;
}

export interface Club {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  parkId: string | null;
  rules: Rules;
  customFields: CustomField[];
  lobbyShowNames: boolean;
  lobbyToken: string | null;
  myRole: Role | null;
  suspendedUntil: number | null;
  memberCount: number;
  courts: Court[];
  types: ReservationType[];
  schedulers: Scheduler[];
  primeTimes: PrimeTime[];
}

export interface ClubSummary {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  role: Role | null;
}

export interface Player {
  id: string;
  userId: string | null;
  name: string;
  guest: boolean;
  playerCode: string | null;
  checkedInAt: number | null;
  noShow: boolean;
}

export interface Reservation {
  id: string;
  clubId: string;
  courtId: string;
  typeId: string;
  seriesId: string | null;
  ownerId: string | null;
  title: string | null;
  notes: string | null;
  startsAt: number;
  endsAt: number;
  isPrime: boolean;
  custom: Record<string, unknown>;
  /** held: a public booking waiting for payment, which keeps the court until holdExpiresAt. */
  status: 'booked' | 'cancelled' | 'held' | 'expired';
  cancelReason: string | null;
  lateCancel: boolean;
  players: Player[];
  /** A lesson or clinic date taught by this instructor. */
  instructorId?: string | null;
  clinicId?: string | null;
  /** Booked on the public page by a guest without an account. */
  isPublic?: boolean;
  holdExpiresAt?: number | null;
  amountCents?: number | null;
  paidCents?: number | null;
  refundedCents?: number | null;
  /** Staff only. */
  publicGuest?: { name: string; phone: string; email: string | null; bookings: number } | null;
}

/** One of your reservations, with what's needed to show it outside its club. */
export interface MyReservation extends Reservation {
  clubName: string;
  clubSlug: string;
  timezone: string;
  courtName: string;
  typeName: string;
  color: string;
  cancelCutoffHours: number;
  checkInMinutesBefore: number;
}

export interface Closure {
  id: string;
  courtIds: string[];
  startsAt: number;
  endsAt: number;
  reason: string | null;
}

export interface Schedule {
  reservations: Reservation[];
  closures: Closure[];
}

export interface Strike {
  id: string;
  userId: string;
  name: string;
  kind: 'late_cancel' | 'no_show';
  feeCents: number;
  createdAt: number;
  waivedAt: number | null;
  reservationId: string | null;
  reservationStartsAt: number | null;
  courtName: string | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  playerCode: string;
  role: Role;
  joinedAt: number;
  strikes: number;
  suspendedUntil: number | null;
}

export interface KioskPlayer {
  userId: string;
  name: string;
  playerCode: string;
  isMember: boolean;
  suspendedUntil: number | null;
  reservations: Reservation[];
}

export interface Lobby {
  club: { name: string; timezone: string; slug: string };
  now: number;
  courts: { id: string; name: string; kind: Court['kind']; parentId: string | null }[];
  reservations: {
    id: string;
    courtId: string;
    startsAt: number;
    endsAt: number;
    title: string | null;
    typeName: string;
    color: string;
    names: string[];
    checkedIn: boolean;
  }[];
  closures: { courtIds: string[]; startsAt: number; endsAt: number; reason: string | null }[];
}

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  playerCode: string;
}

export async function myProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, player_code')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, firstName: data.first_name, lastName: data.last_name, playerCode: data.player_code };
}

// Clubs
export const myClubs = () => rpc<ClubSummary[]>('res_my_clubs');
export const findClubs = (query: string) => rpc<ClubSummary[]>('res_find_clubs', { p_query: query });
export const getClub = (slug: string) => rpc<Club | null>('res_club', { p_slug: slug });
export const createClub = (input: { name: string; slug: string; timezone: string; courts: number; address?: string }) =>
  rpc<Club>('res_create_club', {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
    p_courts: input.courts,
    p_address: input.address ?? null,
  });
export const joinClub = (clubId: string) => rpc<Club>('res_join_club', { p_club: clubId });
export const leaveClub = (clubId: string) => rpc<void>('res_leave_club', { p_club: clubId });

// Schedule and reservations
export const schedule = (clubId: string, from: number, to: number) =>
  rpc<Schedule>('res_schedule', { p_club: clubId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
export const myReservations = (clubId?: string) => rpc<MyReservation[]>('res_my_reservations', { p_club: clubId ?? null });

export interface BookInput {
  courtId: string;
  typeId: string;
  startsAt: number;
  endsAt: number;
  playerCodes?: string[];
  guests?: string[];
  title?: string;
  notes?: string;
  custom?: Record<string, unknown>;
  /** Staff: book for this player ID. */
  ownerCode?: string;
  /** Staff: book for no one (a club event). */
  noOwner?: boolean;
}

export const book = (i: BookInput) =>
  rpc<Reservation>('res_book', {
    p_court: i.courtId,
    p_type: i.typeId,
    p_starts_at: new Date(i.startsAt).toISOString(),
    p_ends_at: new Date(i.endsAt).toISOString(),
    p_player_codes: i.playerCodes ?? [],
    p_guests: i.guests ?? [],
    p_title: i.title ?? null,
    p_notes: i.notes ?? null,
    p_custom: i.custom ?? {},
    p_owner_code: i.ownerCode ?? null,
    p_no_owner: i.noOwner ?? false,
  });
export const cancelReservation = (id: string, reason?: string) =>
  rpc<Reservation>('res_cancel', { p_id: id, p_reason: reason ?? null });
export const leaveReservation = (id: string) => rpc<void>('res_leave_reservation', { p_id: id });
export const editReservation = (
  id: string,
  changes: { typeId?: string; title?: string; notes?: string; custom?: Record<string, unknown>; playerCodes?: string[]; guests?: string[] },
) => rpc<Reservation>('res_edit', { p_id: id, p: changes });
export const moveReservation = (id: string, courtId: string, startsAt: number, endsAt: number) =>
  rpc<Reservation>('res_move', {
    p_id: id,
    p_court: courtId,
    p_starts_at: new Date(startsAt).toISOString(),
    p_ends_at: new Date(endsAt).toISOString(),
  });
export const checkIn = (reservationId: string, playerId: string | null = null, undo = false) =>
  rpc<Reservation>('res_check_in', { p_reservation: reservationId, p_player: playerId, p_undo: undo });
export const markNoShow = (reservationId: string, playerId: string, undo = false) =>
  rpc<Reservation>('res_mark_no_show', { p_reservation: reservationId, p_player: playerId, p_undo: undo });

// Strikes
export const strikes = (clubId: string, userId?: string) => rpc<Strike[]>('res_strikes', { p_club: clubId, p_user: userId ?? null });
export const waiveStrike = (id: string, undo = false) => rpc<void>('res_waive_strike', { p_id: id, p_undo: undo });

// Recurring
export const createSeries = (i: {
  courtId: string;
  typeId: string;
  days: number[];
  startTime: string;
  minutes: number;
  from: string;
  until: string;
  title?: string;
  ownerCode?: string;
}) =>
  rpc<{ seriesId: string; created: number; skipped: { date: string; reason: string }[] }>('res_create_series', {
    p_court: i.courtId,
    p_type: i.typeId,
    p_days: i.days,
    p_start_time: i.startTime,
    p_minutes: i.minutes,
    p_from: i.from,
    p_until: i.until,
    p_title: i.title ?? null,
    p_owner_code: i.ownerCode ?? null,
  });
export const cancelSeries = (seriesId: string, from?: number) =>
  rpc<number>('res_cancel_series', { p_series: seriesId, p_from: from ? new Date(from).toISOString() : null });

// Closures
export const createClosure = (clubId: string, courtIds: string[], startsAt: number, endsAt: number, reason: string, cancel: boolean) =>
  rpc<{ id: string; cancelled: number }>('res_create_closure', {
    p_club: clubId,
    p_court_ids: courtIds,
    p_starts_at: new Date(startsAt).toISOString(),
    p_ends_at: new Date(endsAt).toISOString(),
    p_reason: reason,
    p_cancel: cancel,
  });
export const deleteClosure = (id: string) => rpc<void>('res_delete_closure', { p_id: id });
export const closures = (clubId: string) => rpc<Closure[]>('res_closures', { p_club: clubId });

// Settings
export const saveClub = (clubId: string, changes: Partial<Omit<Club, 'rules'>> & { rules?: Partial<Rules>; newLobbyLink?: boolean }) =>
  rpc<Club>('res_save_club', { p_club: clubId, p: changes });
export const saveCourt = (clubId: string, court: Partial<Court> & { name: string; schedulerIds?: string[] }) =>
  rpc<Club>('res_save_court', { p_club: clubId, p: court });
export const deleteCourt = (id: string) => rpc<Club>('res_delete_court', { p_id: id });
export const saveType = (clubId: string, t: Partial<ReservationType> & { name: string }) => rpc<Club>('res_save_type', { p_club: clubId, p: t });
export const deleteType = (id: string) => rpc<Club>('res_delete_type', { p_id: id });
export const saveScheduler = (clubId: string, s: Partial<Scheduler> & { name: string; opens: string; closes: string }) =>
  rpc<Club>('res_save_scheduler', { p_club: clubId, p: s });
export const deleteScheduler = (id: string) => rpc<Club>('res_delete_scheduler', { p_id: id });
export const savePrimeTime = (clubId: string, p: Partial<PrimeTime> & { starts: string; ends: string }) =>
  rpc<Club>('res_save_prime_time', { p_club: clubId, p });
export const deletePrimeTime = (id: string) => rpc<Club>('res_delete_prime_time', { p_id: id });

// Members
export const members = (clubId: string, query?: string) => rpc<Member[]>('res_members', { p_club: clubId, p_query: query ?? null });
export const addMember = (clubId: string, who: string) =>
  rpc<{ userId: string; name: string; playerCode: string }>('res_add_member', { p_club: clubId, p_who: who });
export const setMemberRole = (clubId: string, userId: string, role: Role) =>
  rpc<void>('res_set_member_role', { p_club: clubId, p_user: userId, p_role: role });
export const removeMember = (clubId: string, userId: string) => rpc<void>('res_remove_member', { p_club: clubId, p_user: userId });

// Kiosk and lobby
export const kioskPlayer = (clubId: string, code: string) => rpc<KioskPlayer>('res_kiosk_player', { p_club: clubId, p_code: code });
export const lobby = (token: string) => rpc<Lobby | null>('res_lobby', { p_token: token });

// Public booking: staff settings
export interface PublicSettings {
  enabled: boolean;
  advanceDays: number;
  maxUpcoming: number;
  currency: string;
  stripeConnected: boolean;
  chargesEnabled: boolean;
  schedulers: { id: string; name: string; public: boolean }[];
  types: { id: string; name: string; color: string; public: boolean; priceCents: number | null }[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  bookings: number;
  spentCents: number;
  firstBookedAt: number;
  lastBookedAt: number;
  isMember: boolean;
}

export const publicSettings = (clubId: string) => rpc<PublicSettings>('res_public_settings', { p_club: clubId });
export const savePublicSettings = (
  clubId: string,
  p: { enabled?: boolean; advanceDays?: number; maxUpcoming?: number; schedulerIds?: string[]; types?: { id: string; public?: boolean; priceCents?: number | null }[] },
) => rpc<PublicSettings>('res_save_public_settings', { p_club: clubId, p });
export const publicPlayers = (clubId: string, query?: string) => rpc<PublicPlayer[]>('res_public_players', { p_club: clubId, p_query: query ?? null });

const origin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : undefined);

export const stripeOnboard = (clubId: string) => invoke<{ url: string }>('stripe-connect', { action: 'onboard', clubId, origin: origin() });
export const stripeRefresh = (clubId: string) => invoke<{ connected: boolean; chargesEnabled: boolean }>('stripe-connect', { action: 'refresh', clubId });
export const stripeDashboard = (clubId: string) => invoke<{ url: string }>('stripe-connect', { action: 'dashboard', clubId });
/** Staff cancel of a public booking, refunding what the guest paid. */
export const staffCancelPublic = (reservationId: string) =>
  invoke<{ cancelled: boolean; refundedCents: number }>('public-booking', { action: 'staff-cancel', reservationId });

// Public booking: the page guests use (no account)
export interface PublicClub {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  timezone: string;
  currency: string;
  paymentsReady: boolean;
  advanceDays: number;
  cancelCutoffHours: number;
  minMinutes: number;
  maxMinutes: number;
  slotMinutes: number;
  sports: Court['sport'][];
  types: { id: string; name: string; color: string; minPlayers: number; maxPlayers: number; priceCents: number }[];
}

export interface PublicBooking {
  token: string;
  status: Reservation['status'];
  club: { name: string; slug: string; address: string | null; timezone: string; currency: string };
  courtName: string;
  typeName: string;
  color: string;
  startsAt: number;
  endsAt: number;
  players: number;
  guestName: string;
  amountCents: number;
  paidCents: number;
  refundedCents: number;
  holdExpiresAt: number | null;
  cancelCutoffHours: number;
  cancelReason: string | null;
  refundable: boolean;
}

export const publicClub = (slug: string) => rpc<PublicClub | null>('res_public_club', { p_slug: slug });
export const publicAvailability = (slug: string, day: string, sport: string, minutes: number) =>
  rpc<{ startsAt: number; courts: number }[]>('res_public_availability', { p_slug: slug, p_day: day, p_sport: sport, p_minutes: minutes });
export const publicBooking = (token: string) => rpc<PublicBooking | null>('res_public_reservation', { p_token: token });
export const sendPublicCode = (slug: string, phone: string) => invoke<{ sent: boolean; phone: string }>('public-booking', { action: 'send-code', slug, phone });
export const checkPublicCode = (slug: string, phone: string, code: string) =>
  invoke<{ verification: string; phone: string }>('public-booking', { action: 'check-code', slug, phone, code });
export const bookPublic = (i: {
  slug: string;
  verification: string;
  typeId: string;
  sport: string;
  startsAt: number;
  minutes: number;
  players: number;
  firstName: string;
  lastName: string;
  email: string;
}) => invoke<{ token: string; checkoutUrl?: string }>('public-booking', { action: 'book', ...i, origin: origin() });
export const releasePublic = (token: string) => invoke<{ released: boolean }>('public-booking', { action: 'release', token });
export const cancelPublic = (token: string) => invoke<{ cancelled: boolean; refundedCents: number }>('public-booking', { action: 'cancel', token });

// Lessons
export interface AvailabilityWindow {
  id?: string;
  days: number[];
  starts: string;
  ends: string;
}

export interface Instructor {
  id: string;
  name: string;
  typeId: string | null;
  bio: string | null;
  color: string;
  membersCanBook: boolean;
  sortOrder: number;
  isMe: boolean;
  availability: AvailabilityWindow[];
  /** Staff only. */
  userId?: string | null;
  account?: { name: string; playerCode: string } | null;
  timeOff?: { id: string; startsAt: number; endsAt: number; reason: string | null }[];
}

export interface InstructorType {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Rate {
  id: string;
  instructorId: string | null;
  instructorTypeId: string | null;
  name: string;
  maxPlayers: number;
  days: number[];
  starts: string;
  ends: string;
  priceCents: number;
}

export interface Lessons {
  instructors: Instructor[];
  instructorTypes: InstructorType[];
  rates: Rate[];
  lessonTypeIds: string[];
  myInstructorId: string | null;
}

export interface ClinicSession {
  reservationId: string;
  courtId: string;
  startsAt: number;
  endsAt: number;
  status: Reservation['status'];
  spots: number;
  iDropIn: boolean;
  checkedIn: number | null;
}

export interface Clinic {
  id: string;
  title: string;
  description: string | null;
  instructorId: string | null;
  typeId: string;
  maxPlayers: number;
  priceCents: number;
  dropInPriceCents: number | null;
  waitlist: boolean;
  published: boolean;
  cancelled: boolean;
  registered: number;
  waitlisted: number;
  myStatus: 'registered' | 'waitlisted' | 'pending' | null;
  myRegistrationId?: string | null;
  myWaitlistPosition: number | null;
  sessions: ClinicSession[];
  categoryId?: string | null;
  gender?: 'any' | 'women' | 'men';
  minAge?: number | null;
  maxAge?: number | null;
  minRating?: number | null;
  maxRating?: number | null;
  disclosure?: string | null;
  customFields?: CustomField[];
  membersOnly?: boolean;
  registrationOpensAt?: number | null;
  registrationClosesAt?: number | null;
  requirePayment?: boolean;
  /** Why you can't register (restrictions), if you can't. */
  ineligible?: string | null;
}

export interface RosterEntry {
  id: string;
  userId: string;
  name: string;
  playerCode: string;
  status: 'registered' | 'waitlisted';
  dropInReservationId: string | null;
  amountCents: number;
  paidCents: number;
  registeredAt: number;
  attended: number;
}

export interface InstructorReportRow {
  instructorId: string;
  name: string;
  typeId: string | null;
  lessons: number;
  clinicSessions: number;
  hours: number;
  availableHours: number;
  utilization: number | null;
  revenueCents: number;
  paidCents: number;
  students: number;
  attendance: number | null;
}

export const lessons = (clubId: string) => rpc<Lessons>('res_lessons', { p_club: clubId });
export const lessonTimes = (instructorId: string, day: string, minutes: number, players = 1) =>
  rpc<{ startsAt: number; priceCents: number | null }[]>('res_lesson_times', { p_instructor: instructorId, p_day: day, p_minutes: minutes, p_players: players });
export const instructorTimeOff = (clubId: string, from: number, to: number) =>
  rpc<{ id: string; instructorId: string; startsAt: number; endsAt: number; reason: string | null }[]>('res_instructor_time_off', {
    p_club: clubId,
    p_from: new Date(from).toISOString(),
    p_to: new Date(to).toISOString(),
  });
export const bookLesson = (i: {
  instructorId: string;
  typeId: string;
  startsAt: number;
  minutes: number;
  playerCodes?: string[];
  guests?: string[];
  notes?: string;
  ownerCode?: string;
  courtId?: string;
}) =>
  rpc<Reservation>('res_book_lesson', {
    p_instructor: i.instructorId,
    p_type: i.typeId,
    p_starts_at: new Date(i.startsAt).toISOString(),
    p_minutes: i.minutes,
    p_player_codes: i.playerCodes ?? [],
    p_guests: i.guests ?? [],
    p_notes: i.notes ?? null,
    p_owner_code: i.ownerCode ?? null,
    p_court: i.courtId ?? null,
  });
export const setPaid = (target: { reservationId?: string; registrationId?: string }, paidCents: number) =>
  rpc<void>('res_set_paid', { p_reservation: target.reservationId ?? null, p_registration: target.registrationId ?? null, p_paid_cents: paidCents });

export const clinics = (clubId: string) => rpc<Clinic[]>('res_clinics', { p_club: clubId });
export const createClinic = (
  clubId: string,
  p: {
    title: string;
    description?: string;
    instructorId?: string | null;
    typeId: string;
    courtId: string;
    days: number[];
    startTime: string;
    minutes: number;
    from: string;
    until: string;
    maxPlayers: number;
    priceCents: number;
    dropInPriceCents?: number | null;
    waitlist?: boolean;
    published?: boolean;
  },
) => rpc<{ clinicId: string; created: number; skipped: { date: string; reason: string }[] }>('res_create_clinic', { p_club: clubId, p });
export const updateClinic = (
  id: string,
  p: Partial<
    Pick<
      Clinic,
      | 'title' | 'description' | 'instructorId' | 'maxPlayers' | 'priceCents' | 'dropInPriceCents' | 'waitlist' | 'published'
      | 'categoryId' | 'gender' | 'minAge' | 'maxAge' | 'minRating' | 'maxRating' | 'disclosure' | 'customFields' | 'membersOnly'
      | 'registrationOpensAt' | 'registrationClosesAt' | 'requirePayment'
    >
  >,
) =>
  rpc<Clinic>('res_update_clinic', { p_id: id, p });
export const cancelClinic = (id: string) => rpc<void>('res_cancel_clinic', { p_id: id });
export const registerClinic = (clinicId: string, opts: { reservationId?: string; ownerCode?: string } = {}) =>
  rpc<{ status: 'registered' | 'waitlisted'; amountCents: number }>('res_register_clinic', {
    p_clinic: clinicId,
    p_reservation: opts.reservationId ?? null,
    p_owner_code: opts.ownerCode ?? null,
  });
export const unregisterClinic = (clinicId: string, opts: { reservationId?: string; userId?: string } = {}) =>
  rpc<void>('res_unregister_clinic', { p_clinic: clinicId, p_reservation: opts.reservationId ?? null, p_user: opts.userId ?? null });
export const clinicRoster = (clinicId: string) => rpc<RosterEntry[]>('res_clinic_roster', { p_clinic: clinicId });

export const myTeaching = (clubId: string, from: number, to: number) =>
  rpc<Reservation[]>('res_my_teaching', { p_club: clubId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
export const instructorReport = (clubId: string, from: string, to: string) =>
  rpc<InstructorReportRow[]>('res_instructor_report', { p_club: clubId, p_from: from, p_to: to });

export const saveInstructor = (
  clubId: string,
  p: Partial<Pick<Instructor, 'id' | 'name' | 'typeId' | 'bio' | 'color' | 'membersCanBook' | 'sortOrder'>> & { name: string; account?: string; availability?: AvailabilityWindow[] },
) => rpc<Lessons>('res_save_instructor', { p_club: clubId, p });
export const deleteInstructor = (id: string) => rpc<Lessons>('res_delete_instructor', { p_id: id });
export const addTimeOff = (instructorId: string, startsAt: number, endsAt: number, reason?: string) =>
  rpc<Lessons>('res_add_time_off', {
    p_instructor: instructorId,
    p_starts_at: new Date(startsAt).toISOString(),
    p_ends_at: new Date(endsAt).toISOString(),
    p_reason: reason ?? null,
  });
export const deleteTimeOff = (id: string) => rpc<Lessons>('res_delete_time_off', { p_id: id });
export const saveInstructorType = (clubId: string, p: { id?: string; name: string }) => rpc<Lessons>('res_save_instructor_type', { p_club: clubId, p });
export const deleteInstructorType = (id: string) => rpc<Lessons>('res_delete_instructor_type', { p_id: id });
export const saveRate = (clubId: string, p: Partial<Rate> & { priceCents: number }) => rpc<Lessons>('res_save_rate', { p_club: clubId, p });
export const deleteRate = (id: string) => rpc<Lessons>('res_delete_rate', { p_id: id });
export const setLessonType = (typeId: string, isLesson: boolean) => rpc<Lessons>('res_set_lesson_type', { p_type: typeId, p_is_lesson: isLesson });

// Pro shop & POS
export interface TaxRate {
  id: string;
  name: string;
  rateBp: number;
  inclusive: boolean;
}

export interface Product {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  costCents: number | null;
  taxRateId: string | null;
  trackInventory: boolean;
  stock: number;
  reorderLevel: number | null;
  low: boolean;
}

export interface Pos {
  categories: { id: string; name: string; sortOrder: number }[];
  products: Product[];
  taxRates: TaxRate[];
  lowStock: number;
}

export interface SaleItem {
  productId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export type PaymentMethod = 'cash' | 'card' | 'account' | 'other';

export interface Sale {
  id: string;
  number: number;
  userId: string | null;
  customerName: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  tenderedCents: number | null;
  status: 'completed' | 'refunded';
  note: string | null;
  staffName: string | null;
  createdAt: number;
  items: SaleItem[];
}

export interface SalesReport {
  sales: Sale[];
  summary: { count: number; grossCents: number; refundCents: number; discountCents: number; taxCents: number; netCents: number; byMethod: Record<string, number> };
  byCategory: { name: string; totalCents: number; quantity: number }[];
  topItems: { name: string; totalCents: number; quantity: number }[];
}

export interface LedgerEntry {
  id: string;
  kind: string;
  description: string;
  amountCents: number;
  createdAt: number;
  sourceType: string | null;
  sourceId: string | null;
}

export const pos = (clubId: string) => rpc<Pos>('res_pos', { p_club: clubId });
export const checkout = (
  clubId: string,
  p: {
    items: { productId?: string; name?: string; unitPriceCents?: number; quantity: number; discountCents?: number; taxRateId?: string | null }[];
    discountCents?: number;
    customerCode?: string;
    customerName?: string;
    paymentMethod: PaymentMethod;
    tenderedCents?: number;
    note?: string;
  },
) => rpc<Sale>('res_checkout', { p_club: clubId, p });
export const refundSale = (saleId: string, restock = true) => rpc<Sale>('res_refund_sale', { p_sale: saleId, p_restock: restock });
export const sales = (clubId: string, from: number, to: number) =>
  rpc<SalesReport>('res_sales', { p_club: clubId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
export const account = (clubId: string, userId?: string) => rpc<{ balanceCents: number; entries: LedgerEntry[] }>('res_account', { p_club: clubId, p_user: userId ?? null });
export const saveProduct = (clubId: string, p: Partial<Product> & { name: string; priceCents: number }) => rpc<Pos>('res_save_product', { p_club: clubId, p });
export const deleteProduct = (id: string) => rpc<Pos>('res_delete_product', { p_id: id });
export const adjustStock = (productId: string, change: number, reason: 'restock' | 'adjustment', note?: string) =>
  rpc<Pos>('res_adjust_stock', { p_product: productId, p_change: change, p_reason: reason, p_note: note ?? null });
export const saveProductCategory = (clubId: string, p: { id?: string; name: string }) => rpc<Pos>('res_save_product_category', { p_club: clubId, p });
export const deleteProductCategory = (id: string) => rpc<Pos>('res_delete_product_category', { p_id: id });
export const saveTaxRate = (clubId: string, p: { id?: string; name: string; ratePercent: number; inclusive?: boolean; active?: boolean }) =>
  rpc<Pos>('res_save_tax_rate', { p_club: clubId, p });

// Events
export interface EventCategory {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface MemberDetails {
  birthDate: string | null;
  gender: 'woman' | 'man' | 'nonbinary' | 'unspecified' | null;
  zip: string | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: number;
  clubName: string | null;
}

export const eventCategories = (clubId: string) => rpc<EventCategory[]>('res_event_categories', { p_club: clubId });
export const saveEventCategory = (clubId: string, p: { id?: string; name: string; color?: string }) => rpc<EventCategory[]>('res_save_event_category', { p_club: clubId, p });
export const deleteEventCategory = (id: string) => rpc<EventCategory[]>('res_delete_event_category', { p_id: id });
export const setPublicEvents = (clubId: string, on: boolean) => rpc<void>('res_set_public_events', { p_club: clubId, p_on: on });
export const registerEvent = (clinicId: string, opts: { reservationId?: string; ownerCode?: string; answers?: Record<string, unknown>; accept?: boolean } = {}) =>
  rpc<{ status: 'registered' | 'waitlisted' | 'pending'; amountCents: number; registrationId: string }>('res_register_event', {
    p_clinic: clinicId,
    p_reservation: opts.reservationId ?? null,
    p_owner_code: opts.ownerCode ?? null,
    p_answers: opts.answers ?? {},
    p_accept: opts.accept ?? false,
  });
/** Pays for a registration held for payment: sends you to Stripe Checkout. */
export const payEvent = (registrationId: string) => invoke<{ url: string }>('club-payments', { action: 'event', registrationId, origin: origin() });
export const publicEvents = (slug: string) =>
  rpc<{ club: { name: string; slug: string; address: string | null; timezone: string }; categories: EventCategory[]; events: Clinic[] } | null>('res_public_events', { p_slug: slug });
export const memberDetails = (clubId: string, userId?: string) => rpc<MemberDetails | null>('res_member_details', { p_club: clubId, p_user: userId ?? null });
export const saveMemberDetails = (clubId: string, p: Partial<MemberDetails>, userId?: string) =>
  rpc<MemberDetails>('res_save_member_details', { p_club: clubId, p, p_user: userId ?? null });
export const myNotifications = () => rpc<{ unread: number; items: Notification[] }>('res_my_notifications');
export const readNotifications = () => rpc<void>('res_read_notifications');

// Memberships
export type PlanPeriod = 'month' | 'quarter' | 'year' | 'once';

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  period: PlanPeriod;
  maxMembers: number;
  advanceDays: number | null;
  maxUpcoming: number | null;
  maxPerDay: number | null;
  selfSignup: boolean;
  sortOrder: number;
  activeMembers?: number | null;
}

export interface Membership {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  period: PlanPeriod;
  familyId: string | null;
  status: 'active' | 'cancelled' | 'expired';
  startsOn: string;
  endsOn: string | null;
  nextBillOn: string | null;
  priceCents: number;
  memberName: string;
}

export interface Waiver {
  id: string;
  title: string;
  body: string;
  required: boolean;
  version: number;
  signedAt: number | null;
  signatures?: number | null;
}

export interface MemberGroup {
  id: string;
  name: string;
  description: string | null;
  visible: boolean;
  members: number;
  joined: boolean;
}

export interface RatingScale {
  id: string;
  name: string;
  audience: 'all' | 'adults' | 'juniors';
  min: number;
  max: number;
  step: number;
  myRating: number | null;
}

export interface MembershipsData {
  requireMembership: boolean;
  plans: Plan[];
  mine: Membership[];
  family: { id: string; name: string; members: { userId: string; name: string; relationship: string | null }[] } | null;
  groups: MemberGroup[];
  waivers: Waiver[];
  ratingScales: RatingScale[];
}

export interface MemberProfile {
  userId: string;
  name: string;
  playerCode: string;
  email: string | null;
  phone: string | null;
  role: Role;
  joinedAt: number;
  birthDate: string | null;
  gender: MemberDetails['gender'];
  zip: string | null;
  duprDoubles: number | null;
  memberships: Membership[];
  family: { id: string; name: string; members: { userId: string; name: string; playerCode: string; relationship: string | null }[] } | null;
  groups: { id: string; name: string }[];
  ratings: { scaleId: string; name: string; value: number }[];
  waivers: { id: string; title: string; required: boolean; signedAt: number | null }[];
  balanceCents: number;
  visits30: number;
  reservations30: number;
  lastVisit: number | null;
}

export type EmailAudience = { audience: 'all' | 'active' | 'none' | 'plan' | 'group'; planIds?: string[]; groupIds?: string[] };

export const memberships = (clubId: string) => rpc<MembershipsData>('res_memberships', { p_club: clubId });
export const memberProfile = (clubId: string, userId: string) => rpc<MemberProfile>('res_member_profile', { p_club: clubId, p_user: userId });
export const savePlan = (clubId: string, p: Partial<Plan> & { name: string }) => rpc<MembershipsData>('res_save_plan', { p_club: clubId, p });
export const deletePlan = (id: string) => rpc<MembershipsData>('res_delete_plan', { p_id: id });
export const startMembership = (planId: string, opts: { ownerCode?: string; startsOn?: string; endsOn?: string } = {}) =>
  rpc<Membership>('res_start_membership', { p_plan: planId, p_owner_code: opts.ownerCode ?? null, p_starts_on: opts.startsOn ?? null, p_ends_on: opts.endsOn ?? null });
export const cancelMembership = (id: string) => rpc<Membership>('res_cancel_membership', { p_id: id });
export const setRequireMembership = (clubId: string, on: boolean) => rpc<void>('res_set_require_membership', { p_club: clubId, p_on: on });
export const saveFamily = (clubId: string, p: { id?: string; name: string; members: { code: string; relationship?: string }[] }) =>
  rpc<{ id: string }>('res_save_family', { p_club: clubId, p });
export const saveGroup = (clubId: string, p: { id?: string; name: string; description?: string; visible?: boolean }) => rpc<MembershipsData>('res_save_group', { p_club: clubId, p });
export const deleteGroup = (id: string) => rpc<MembershipsData>('res_delete_group', { p_id: id });
export const groupMember = (groupId: string, join: boolean, code?: string) => rpc<void>('res_group_member', { p_group: groupId, p_join: join, p_code: code ?? null });
export const groupMembers = (groupId: string) => rpc<{ userId: string; name: string; playerCode: string }[]>('res_group_members', { p_group: groupId });
export const saveRatingScale = (clubId: string, p: { id?: string; name: string; audience?: RatingScale['audience']; min?: number; max?: number; step?: number }) =>
  rpc<MembershipsData>('res_save_rating_scale', { p_club: clubId, p });
export const deleteRatingScale = (id: string) => rpc<MembershipsData>('res_delete_rating_scale', { p_id: id });
export const rateMember = (scaleId: string, userId: string, value: number | null) => rpc<void>('res_rate_member', { p_scale: scaleId, p_user: userId, p_value: value });
export const saveWaiver = (clubId: string, p: { id?: string; title: string; body: string; required?: boolean; active?: boolean }) => rpc<MembershipsData>('res_save_waiver', { p_club: clubId, p });
export const signWaiver = (waiverId: string, name: string, signatureSvg?: string) =>
  rpc<MembershipsData>('res_sign_waiver', { p_waiver: waiverId, p_name: name, p_signature_svg: signatureSvg ?? null });
export const waiverSignatures = (waiverId: string) =>
  rpc<{ userId: string; name: string; signedName: string; signedAt: number; signatureSvg: string | null }[]>('res_waiver_signatures', { p_waiver: waiverId });
export const memberCheckin = (clubId: string, code: string) =>
  rpc<{ name: string; membership: string | null; unsignedWaivers: string | null; balanceCents: number }>('res_member_checkin', { p_club: clubId, p_code: code });
export const emailAudienceCount = (clubId: string, audience: EmailAudience) => rpc<number>('res_email_audience_count', { p_club: clubId, p: audience });
export const emailHistory = (clubId: string) => rpc<{ id: string; subject: string; recipients: number; sentAt: number; sentBy: string | null }[]>('res_email_history', { p_club: clubId });
export const sendClubEmail = (clubId: string, subject: string, body: string, audience: EmailAudience, test = false) =>
  invoke<{ sent: number }>('club-email', { clubId, subject, body, audience, test });

// Billing & invoicing
export interface Invoice {
  id: string;
  userId: string;
  number: string;
  status: 'draft' | 'open' | 'overdue' | 'paid' | 'void';
  periodEnd: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalCents: number;
  paidCents: number;
  note: string | null;
  paidAt: number | null;
  memberName: string;
  playerCode: string;
  email: string | null;
  autopay: boolean;
  lines?: { id: string; kind: string; description: string; amountCents: number; date: string }[] | null;
  club?: { name: string; address: string | null; color: string; header: string | null; footer: string | null; currency: string; slug: string; paymentsReady: boolean } | null;
}

export interface InvoiceList {
  invoices: Invoice[];
  outstandingCents: number;
  overdueCents: number;
  draftCount: number;
  collectedThisMonthCents: number;
  unbilledCents: number;
}

export interface InvoiceSettings {
  prefix: string;
  dueDays: number;
  color: string;
  header: string | null;
  footer: string | null;
}

export const runBilling = (clubId: string, through: string, issue: boolean) =>
  rpc<{ invoices: number; totalCents: number; dues: number }>('res_run_billing', { p_club: clubId, p_through: through, p_issue: issue });
export const invoices = (clubId: string, status?: string | null, query?: string) => rpc<InvoiceList>('res_invoices', { p_club: clubId, p_status: status ?? null, p_query: query ?? null });
export const invoice = (id: string) => rpc<Invoice>('res_invoice', { p_id: id });
export const myBilling = (clubId: string) => rpc<{ invoices: Invoice[]; balanceCents: number; autopay: { on: boolean; card: string | null } | null }>('res_my_billing', { p_club: clubId });
export const issueInvoices = (clubId: string, ids?: string[]) => rpc<number>('res_issue_invoices', { p_club: clubId, p_ids: ids ?? null });
export const recordPayment = (invoiceId: string, cents: number, method: string) => rpc<Invoice>('res_record_payment', { p_invoice: invoiceId, p_cents: cents, p_method: method });
export const voidInvoice = (id: string) => rpc<void>('res_void_invoice', { p_id: id });
export const adjustAccount = (clubId: string, userId: string, cents: number, description: string) =>
  rpc<void>('res_adjust_account', { p_club: clubId, p_user: userId, p_cents: cents, p_description: description });
export const invoiceSettings = (clubId: string) => rpc<InvoiceSettings>('res_invoice_settings', { p_club: clubId });
export const saveInvoiceSettings = (clubId: string, p: Partial<InvoiceSettings>) => rpc<void>('res_save_invoice_settings', { p_club: clubId, p });
export const setAutopay = (clubId: string, on: boolean) => rpc<void>('res_set_autopay', { p_club: clubId, p_on: on });
export const payInvoice = (invoiceId: string, autopay: boolean) => invoke<{ url: string }>('club-payments', { action: 'invoice', invoiceId, autopay, origin: origin() });
export const runAutopay = (clubId: string) => invoke<{ charged: number; failed: string[] }>('club-payments', { action: 'autopay', clubId });

// Leagues & ladders
export interface LeagueSummary {
  id: string;
  name: string;
  kind: 'league' | 'ladder';
  format: 'singles' | 'doubles';
  description: string | null;
  status: 'registration' | 'active' | 'completed';
  startsOn: string;
  endsOn: string | null;
  dayOfWeek: number | null;
  startTime: string;
  feeCents: number;
  maxEntries: number | null;
  membersOnly: boolean;
  entries: number;
  joined: boolean;
}

export interface LeagueMatch {
  id: string;
  round: number | null;
  entryA: string;
  entryB: string;
  nameA: string;
  nameB: string;
  scheduledAt: number | null;
  courtName: string | null;
  scores: [number, number][];
  winner: string | null;
  status: 'scheduled' | 'reported' | 'confirmed';
  challenge: boolean;
  mine: boolean;
  reportedByMe: boolean;
  reportedBySide: 'a' | 'b' | null;
}

export interface LeagueDetail {
  league: LeagueSummary & { clubId: string; matchMinutes: number; courtIds: string[]; pointsWin: number; pointsLoss: number; challengeRange: number };
  myEntryId: string | null;
  standings: { entryId: string; name: string; rank: number | null; played: number; wins: number; losses: number; gamesFor: number; gamesAgainst: number; points: number }[];
  matches: LeagueMatch[];
  posts: { id: string; name: string; body: string; createdAt: number }[];
}

export const leagues = (clubId: string) => rpc<LeagueSummary[]>('res_leagues', { p_club: clubId });
export const league = (id: string) => rpc<LeagueDetail>('res_league', { p_id: id });
export const saveLeague = (clubId: string, p: Record<string, unknown>) => rpc<{ id: string }>('res_save_league', { p_club: clubId, p });
export const joinLeague = (leagueId: string, opts: { partnerCode?: string; teamName?: string; ownerCode?: string } = {}) =>
  rpc<{ entryId: string; name: string }>('res_join_league', { p_league: leagueId, p_partner_code: opts.partnerCode ?? null, p_team_name: opts.teamName ?? null, p_owner_code: opts.ownerCode ?? null });
export const withdrawLeague = (entryId: string) => rpc<void>('res_withdraw_league', { p_entry: entryId });
export const generateSchedule = (leagueId: string) => rpc<{ rounds: number; matches: number; unbooked: number }>('res_generate_schedule', { p_league: leagueId });
export const challenge = (leagueId: string, opponentEntryId: string) => rpc<{ matchId: string }>('res_challenge', { p_league: leagueId, p_opponent: opponentEntryId, p_at: null });
export const reportScore = (matchId: string, scores: [number, number][]) => rpc<void>('res_report_score', { p_match: matchId, p_scores: scores });
export const confirmScore = (matchId: string) => rpc<void>('res_confirm_score', { p_match: matchId });
export const leaguePost = (leagueId: string, body: string) => rpc<void>('res_league_post', { p_league: leagueId, p_body: body });

// Access control
export interface AccessSettings {
  mode: 'off' | 'reservation' | 'daily';
  minutesBefore: number;
  minutesAfter: number;
  codeLength: number;
  notifyStaff: boolean;
  points: { id: string; name: string; courtIds: string[]; seamDeviceId: string | null }[];
  dailyCodes: { day: string; door: string; code: string; status: string }[];
  failed: number;
}

export interface DoorCode {
  reservationId: string;
  door: string;
  code: string;
  startsAt: number;
  endsAt: number;
  pending: boolean;
}

export const accessSettings = (clubId: string) => rpc<AccessSettings>('res_access', { p_club: clubId });
export const saveAccess = (clubId: string, p: Partial<Omit<AccessSettings, 'points' | 'dailyCodes' | 'failed'>>) => rpc<AccessSettings>('res_save_access', { p_club: clubId, p });
export const saveAccessPoint = (clubId: string, p: { id?: string; name: string; courtIds: string[]; seamDeviceId?: string | null }) =>
  rpc<AccessSettings>('res_save_access_point', { p_club: clubId, p });
export const deleteAccessPoint = (id: string) => rpc<AccessSettings>('res_delete_access_point', { p_id: id });
export const setDailyCode = (clubId: string, day: string, code?: string) => rpc<AccessSettings>('res_set_daily_code', { p_club: clubId, p_day: day, p_code: code ?? null });
export const accessCodes = (clubId: string, from: number, to: number) =>
  rpc<{ id: string; door: string; code: string; status: string; error: string | null; startsAt: number; endsAt: number; day: string | null; who: string | null; courtName: string | null }[]>(
    'res_access_codes',
    { p_club: clubId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() },
  );
export const accessEvents = (clubId: string, from: number, to: number) =>
  rpc<{ id: string; kind: 'unlock' | 'denied' | 'manual'; occurredAt: number; door: string | null; code: string | null; who: string | null; reservation: { courtName: string; startsAt: number; endsAt: number } | null }[]>(
    'res_access_events',
    { p_club: clubId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() },
  );
export const myDoorCodes = (clubId: string) => rpc<DoorCode[]>('res_my_access_codes', { p_club: clubId });

// Reporting (Pulse)
export interface PulsePeriod {
  grossCents: number;
  netCents: number;
  refundCents: number;
  discountCents: number;
  taxCents: number;
  recurringCents: number;
  categories: Record<string, number>;
  utilization: number | null;
  bookedHours: number;
  availableHours: number;
  unsoldHours: number;
  reservations: number;
  activePlayers: number;
  newMembers: number;
  newGuests: number;
  revenuePerPlayerCents: number | null;
  checkins: number;
  noShows: number;
  lateCancels: number;
  walkups: { visits: number; players: number; hours: number };
}

export interface Pulse {
  from: string;
  to: string;
  current: PulsePeriod;
  previous: PulsePeriod;
  settings: { hiddenTabs?: string[]; hiddenCards?: string[] };
  linkedToPickleSpots: boolean;
  heatmap: { dow: number; hour: number; pct: number }[];
  byType: { name: string; color: string; hours: number }[];
  bySport: { name: string; hours: number }[];
  weekly: { week: string; players: number; reservations: number }[];
  retention: number | null;
  churn: number | null;
  members: number;
  activeMemberships: number;
  atRisk: { userId: string; name: string; lastSeen: number | null }[];
  demographics: { age: { name: string; count: number }[] | null; gender: { name: string; count: number }[] | null; skill: { name: string; count: number }[] | null; zips: { name: string; count: number }[] };
  instructors: InstructorReportRow[];
  insights: { tone: 'good' | 'warning' | 'info'; text: string }[];
}

export const pulse = (clubId: string, from: string, to: string) => rpc<Pulse>('res_pulse', { p_club: clubId, p_from: from, p_to: to });
export const canViewReports = (clubId: string) => rpc<boolean>('res_can_view_reports', { p_club: clubId });
export const savePulseSettings = (clubId: string, p: { hiddenTabs: string[]; hiddenCards: string[] }) => rpc<void>('res_save_pulse_settings', { p_club: clubId, p });
export const setReportAccess = (clubId: string, userId: string, on: boolean) => rpc<void>('res_set_report_access', { p_club: clubId, p_user: userId, p_on: on });
export const reportAccess = (clubId: string) => rpc<string[]>('res_report_access', { p_club: clubId });
/** Pickle Spots court locations by name (players can read parks), to link a club to its court. */
export async function searchParks(query: string): Promise<{ id: string; name: string; address: string | null }[]> {
  const { data, error } = await supabase.from('parks').select('id, name, address').ilike('name', `%${query.trim()}%`).limit(10);
  if (error) throw new Error(error.message);
  return data ?? [];
}
