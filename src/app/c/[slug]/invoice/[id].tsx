import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { toast } from '@/components/Dialogs';
import { InvoiceView } from '@/components/InvoiceView';
import { Button, ErrorText, Loading, Page, Toggle } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** One invoice, printable (save as PDF from the print dialog), with Pay for its member. */
export default function InvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [inv, setInv] = useState<api.Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autopay, setAutopay] = useState(false);
  useEffect(() => {
    api.invoice(String(id)).then(setInv, (e: Error) => setError(e.message));
  }, [id]);
  if (!inv) return <Page>{error ? <ErrorText error={error} /> : <Loading />}</Page>;
  const mine = inv.userId === session?.user.id;
  const payable = mine && (inv.status === 'open' || inv.status === 'overdue') && inv.club?.paymentsReady;

  return (
    <Page maxWidth={820}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {Platform.OS === 'web' ? <Button kind="secondary" title="Print or Save PDF" onPress={() => window.print()} /> : null}
        {payable ? (
          <>
            <Toggle label="Save my card for autopay" value={autopay} onChange={setAutopay} />
            <Button
              title="Pay Online"
              icon="dollar"
              onPress={async () => {
                try {
                  const { url } = await api.payInvoice(inv.id, autopay);
                  if (Platform.OS === 'web') window.location.assign(url);
                  else Linking.openURL(url);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            />
          </>
        ) : null}
      </View>
      <InvoiceView invoice={inv} />
    </Page>
  );
}
