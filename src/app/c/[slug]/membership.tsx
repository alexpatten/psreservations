import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, toast } from '@/components/Dialogs';
import { MyDetailsForm } from '@/components/EventCard';
import { SignaturePad } from '@/components/SignaturePad';
import { Banner, Body, Button, Card, ErrorText, Field, Heading, Loading, Page, Row, Sheet, Small, Tag, useWide } from '@/components/ui';
import * as api from '@/lib/api';
import { useClub } from '@/lib/club-context';
import { type, useColors } from '@/lib/theme';
import { dayLabel, dayOf, money } from '@/lib/time';

const PERIOD: Record<api.PlanPeriod, string> = { month: '/mo', quarter: '/quarter', year: '/yr', once: ' once' };

/** Your membership at a club: plans, waivers to sign, groups, family, ratings, details and account. */
export default function MembershipPage() {
  const c = useColors();
  const wide = useWide();
  const { club, reload: reloadClub } = useClub();
  const tz = club.timezone;
  const [data, setData] = useState<api.MembershipsData | null>(null);
  const [account, setAccount] = useState<{ balanceCents: number; entries: api.LedgerEntry[] } | null>(null);
  const [signing, setSigning] = useState<api.Waiver | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.memberships(club.id).then(setData, (e: Error) => setError(e.message));
    api.account(club.id).then(setAccount, () => {});
  }, [club.id]);
  useEffect(load, [load]);

  if (!data) return <Page>{error ? <ErrorText error={error} /> : <Loading />}</Page>;
  const current = data.mine.filter((m) => m.status !== 'expired');
  const unsigned = data.waivers.filter((w) => !w.signedAt);

  const join = async (plan: api.Plan) => {
    if (!(await confirm(`Join ${plan.name}?`, plan.priceCents ? `${money(plan.priceCents)}${PERIOD[plan.period]}, billed to your club account starting today.` : undefined, { confirmLabel: 'Join' }))) return;
    try {
      await api.startMembership(plan.id);
      toast(`Welcome to ${plan.name}!`);
      load();
      reloadClub();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Page>
      {unsigned.some((w) => w.required) ? (
        <Banner tone="warning" icon="edit">
          Please sign {unsigned.filter((w) => w.required).map((w) => w.title).join(', ')} before booking.
        </Banner>
      ) : null}
      {data.requireMembership && !current.length ? <Banner tone="info">{club.name} asks for a membership to book courts.</Banner> : null}

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 3 : undefined, width: '100%', gap: 12 }}>
          <Heading>My Membership</Heading>
          {current.length === 0 ? <Small>You don’t have a membership plan.</Small> : null}
          {current.map((m) => (
            <Card key={m.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[type.headline, { color: c.label, flex: 1 }]}>{m.planName}</Text>
                <Tag label={m.status === 'active' ? 'Active' : 'Ends soon'} tone={m.status === 'active' ? 'tint' : 'warning'} />
              </View>
              <Small>
                {money(m.priceCents)}
                {PERIOD[m.period]} · since {dayLabel(m.startsOn)}
                {m.endsOn ? ` · through ${dayLabel(m.endsOn)}` : m.nextBillOn ? ` · next billed ${dayLabel(m.nextBillOn)}` : ''}
                {m.familyId ? ' · family plan' : ''}
              </Small>
              {m.status === 'active' && !m.familyId ? (
                <Button
                  small
                  kind="destructiveSoft"
                  title="Cancel Membership"
                  style={{ alignSelf: 'flex-start' }}
                  onPress={async () => {
                    if (!(await confirm('Cancel your membership?', 'It runs to the end of the period you’ve been billed for.', { confirmLabel: 'Cancel Membership', destructive: true }))) return;
                    api.cancelMembership(m.id).then(load, (e: Error) => toast(e.message));
                  }}
                />
              ) : null}
            </Card>
          ))}

          {data.plans.length ? <Heading>Plans</Heading> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {data.plans.map((p) => {
              const perks = [
                p.advanceDays ? `Book ${p.advanceDays} days ahead` : null,
                p.maxUpcoming ? `${p.maxUpcoming} upcoming bookings` : null,
                p.maxPerDay ? `${p.maxPerDay} a day` : null,
                p.maxMembers > 1 ? `Up to ${p.maxMembers} family members` : null,
              ].filter(Boolean);
              const have = current.some((m) => m.planId === p.id && m.status === 'active');
              return (
                <Card key={p.id} style={{ flexBasis: 240, flexGrow: 1, gap: 8 }}>
                  <Text style={[type.headline, { color: c.label }]}>{p.name}</Text>
                  <Text style={[type.title2, { color: c.tint }]}>
                    {p.priceCents ? money(p.priceCents) : 'Free'}
                    <Text style={[type.subheadline, { color: c.secondaryLabel }]}>{p.priceCents ? PERIOD[p.period] : ''}</Text>
                  </Text>
                  {p.description ? <Small>{p.description}</Small> : null}
                  {perks.map((x) => (
                    <Small key={x} muted={false}>
                      ✓ {x}
                    </Small>
                  ))}
                  {have ? <Tag label="Your plan" tone="tint" /> : p.selfSignup ? <Button title="Join" onPress={() => join(p)} /> : <Small>Ask the front desk.</Small>}
                </Card>
              );
            })}
          </View>

          {data.waivers.length ? <Heading>Waivers</Heading> : null}
          {data.waivers.length ? (
            <Card padded={false}>
              {data.waivers.map((w, i) => (
                <Row
                  key={w.id}
                  title={w.title}
                  subtitle={w.signedAt ? `Signed ${dayLabel(dayOf(w.signedAt, tz))}` : w.required ? 'Required to book' : 'Not signed'}
                  right={w.signedAt ? <Tag label="Signed" tone="tint" /> : <Button small title="Read & Sign" onPress={() => setSigning(w)} />}
                  last={i === data.waivers.length - 1}
                />
              ))}
            </Card>
          ) : null}
        </View>

        <View style={{ flex: wide ? 2 : undefined, width: '100%', gap: 12 }}>
          <Heading>My Account</Heading>
          <Card style={{ gap: 6 }}>
            <Text style={[type.title2, { color: (account?.balanceCents ?? 0) > 0 ? c.warning : c.label }]}>{money(account?.balanceCents ?? 0)}</Text>
            <Small>{(account?.balanceCents ?? 0) > 0 ? 'Balance due' : (account?.balanceCents ?? 0) < 0 ? 'Credit on your account' : 'Nothing due'}</Small>
            {account?.entries.slice(0, 6).map((e) => (
              <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Small muted={false} style={{ flex: 1 }} numberOfLines={1}>
                  {dayLabel(dayOf(e.createdAt, tz))} · {e.description}
                </Small>
                <Small muted={false}>{e.amountCents < 0 ? `−${money(-e.amountCents)}` : money(e.amountCents)}</Small>
              </View>
            ))}
          </Card>

          {data.groups.length ? <Heading>Groups</Heading> : null}
          {data.groups.length ? (
            <Card padded={false}>
              {data.groups.map((g, i) => (
                <Row
                  key={g.id}
                  title={g.name}
                  subtitle={[g.description, `${g.members} member${g.members === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  right={
                    g.joined ? (
                      <Button small kind="plain" title="Leave" onPress={() => api.groupMember(g.id, false).then(load, (e: Error) => toast(e.message))} />
                    ) : g.visible ? (
                      <Button small kind="secondary" title="Join" onPress={() => api.groupMember(g.id, true).then(load, (e: Error) => toast(e.message))} />
                    ) : undefined
                  }
                  last={i === data.groups.length - 1}
                />
              ))}
            </Card>
          ) : null}

          {data.family ? (
            <>
              <Heading>{data.family.name}</Heading>
              <Card style={{ gap: 4 }}>
                {data.family.members.map((m) => (
                  <Small key={m.userId} muted={false}>
                    {m.name}
                    {m.relationship ? ` · ${m.relationship}` : ''}
                  </Small>
                ))}
              </Card>
            </>
          ) : null}

          {data.ratingScales.some((s) => s.myRating != null) ? (
            <>
              <Heading>My Ratings</Heading>
              <Card style={{ gap: 4 }}>
                {data.ratingScales
                  .filter((s) => s.myRating != null)
                  .map((s) => (
                    <Small key={s.id} muted={false}>
                      {s.name}: {s.myRating}
                    </Small>
                  ))}
              </Card>
            </>
          ) : null}

          <MyDetailsForm clubId={club.id} />
        </View>
      </View>
      {signing ? (
        <SignSheet
          waiver={signing}
          onClose={() => setSigning(null)}
          onSigned={(d) => {
            setData(d);
            setSigning(null);
          }}
        />
      ) : null}
    </Page>
  );
}

function SignSheet({ waiver, onClose, onSigned }: { waiver: api.Waiver; onClose: () => void; onSigned: (d: api.MembershipsData) => void }) {
  const [name, setName] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={waiver.title}
      footer={
        <>
          <Button kind="secondary" title="Cancel" onPress={onClose} />
          <Button title="Sign" disabled={name.trim().length < 2 || !svg} onPress={() => api.signWaiver(waiver.id, name, svg).then(onSigned, (e: Error) => setError(e.message))} />
        </>
      }
    >
      <Card style={{ maxHeight: 320 }}>
        <Body style={{ fontSize: 14 }}>{waiver.body}</Body>
      </Card>
      <Field label="Full Name" value={name} onChangeText={setName} autoComplete="name" />
      <Small style={{ fontWeight: '600' }}>SIGN BELOW</Small>
      <SignaturePad onChange={setSvg} />
      <Small>Signing electronically is the same as signing on paper. The club keeps your signature with the date and time.</Small>
      <ErrorText error={error} />
    </Sheet>
  );
}
