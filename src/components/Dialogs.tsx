import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { type, useColors } from '@/lib/theme';
import { Button, Sheet } from './ui';

/**
 * Confirmations and short messages that work the same on the web (where Alert does nothing)
 * and on phones. Render <DialogHost /> once; call confirm() or toast() from anywhere.
 */

interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  resolve: (ok: boolean) => void;
}

let showConfirm: ((r: ConfirmRequest) => void) | null = null;
let showToast: ((message: string) => void) | null = null;

export function confirm(
  title: string,
  message?: string,
  opts: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showConfirm) return resolve(false);
    showConfirm({
      title,
      message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      resolve,
    });
  });
}

/** Just a message with OK. */
export function notice(title: string, message?: string) {
  return confirm(title, message, { cancelLabel: '', confirmLabel: 'OK' });
}

export function toast(message: string) {
  showToast?.(message);
}

export function DialogHost() {
  const c = useColors();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    showConfirm = setRequest;
    showToast = setMessage;
    return () => {
      showConfirm = null;
      showToast = null;
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <>
      <Sheet
        visible={!!request}
        onClose={() => close(false)}
        title={request?.title ?? ''}
        width={440}
        footer={
          <>
            {request?.cancelLabel ? <Button kind="secondary" title={request.cancelLabel} onPress={() => close(false)} /> : null}
            <Button kind={request?.destructive ? 'destructive' : 'primary'} title={request?.confirmLabel ?? 'OK'} onPress={() => close(true)} />
          </>
        }
      >
        {request?.message ? <Text style={[type.body, { color: c.secondaryLabel }]}>{request.message}</Text> : null}
      </Sheet>
      {message ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 32, alignItems: 'center', paddingHorizontal: 16 }}>
          <View style={{ backgroundColor: c.label, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 480, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
            <Text style={[type.subheadline, { color: c.card }]}>{message}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}
