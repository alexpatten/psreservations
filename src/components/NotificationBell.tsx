import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as api from '@/lib/api';
import { type, useColors } from '@/lib/theme';
import { Icon } from './Icon';
import { Empty, Row, Sheet } from './ui';

/** How often the bell checks for news while the app is open. */
const POLL_MS = 60_000;

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`;
};

/** The header's bell: waitlist spots, invoices, door codes and other news from your clubs. */
export function NotificationBell() {
  const c = useColors();
  const [data, setData] = useState<{ unread: number; items: api.Notification[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    api.myNotifications().then(setData, () => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const show = () => {
    setOpen(true);
    if (data?.unread) api.readNotifications().then(load, () => {});
  };

  return (
    <>
      <Pressable accessibilityLabel="Notifications" onPress={show} style={{ padding: 8 }}>
        <Icon name="bell" color={c.secondaryLabel} />
        {data?.unread ? (
          <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.destructive, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
            <Text style={[type.caption, { color: '#fff', fontSize: 10, fontWeight: '700' }]}>{data.unread > 9 ? '9+' : data.unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Notifications" width={480}>
        {!data?.items.length ? <Empty icon="bell" title="Nothing new" /> : null}
        {data?.items.map((n, i) => (
          <Row
            key={n.id}
            title={n.title}
            subtitle={[n.body, [n.clubName, ago(n.createdAt)].filter(Boolean).join(' · ')].filter(Boolean).join('\n')}
            onPress={
              n.link
                ? () => {
                    setOpen(false);
                    router.push(n.link as never);
                  }
                : undefined
            }
            last={i === data.items.length - 1}
          />
        ))}
      </Sheet>
    </>
  );
}
