import { createElement, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, useColors, useStyles, type Colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

/** The system font stack React Native Web uses, for the browser's own date and time inputs. */
export const WEB_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Wide layouts (a laptop or tablet in landscape) get side-by-side panes. */
export function useWide(breakpoint = 900) {
  return useWindowDimensions().width >= breakpoint;
}

/** A scrolling page with a readable maximum width. */
export function Page({ children, maxWidth = 1100, scroll = true }: { children: ReactNode; maxWidth?: number; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const inner = (
    <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 48 + insets.bottom, gap: 16 }}>
      {children}
    </View>
  );
  if (!scroll) return inner;
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
      {inner}
    </ScrollView>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const s = useStyles(styles);
  return <View style={[s.card, padded && { padding: 16 }, style]}>{children}</View>;
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[type.title1, { color: c.label }, style]}>{children}</Text>;
}

export function Heading({ children, style, right }: { children: ReactNode; style?: StyleProp<TextStyle>; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[type.title3, { color: c.label, flexShrink: 1 }, style]}>{children}</Text>
      {right}
    </View>
  );
}

export function Body({ children, style, muted, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; numberOfLines?: number }) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[type.body, { color: muted ? c.secondaryLabel : c.label }, style]}>
      {children}
    </Text>
  );
}

export function Small({ children, style, muted = true, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; numberOfLines?: number }) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[type.footnote, { color: muted ? c.secondaryLabel : c.label }, style]}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'plain' | 'destructive' | 'destructiveSoft';

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  small,
  style,
}: {
  title: string;
  onPress?: () => unknown;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const [running, setRunning] = useState(false);
  const loading = busy || running;
  const bg: Record<ButtonKind, string> = {
    primary: c.tint,
    secondary: c.tintSoft,
    plain: 'transparent',
    destructive: c.destructive,
    destructiveSoft: c.fill,
  };
  const fg: Record<ButtonKind, string> = {
    primary: c.onTint,
    secondary: c.tint,
    plain: c.tint,
    destructive: '#FFFFFF',
    destructiveSoft: c.destructive,
  };
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={async () => {
        if (!onPress) return;
        const result = onPress();
        if (result instanceof Promise) {
          setRunning(true);
          try {
            await result;
          } finally {
            setRunning(false);
          }
        }
      }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        {
          backgroundColor: bg[kind],
          minHeight: small ? 34 : 44,
          paddingHorizontal: kind === 'plain' ? 8 : small ? 12 : 18,
          borderRadius: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: disabled ? 0.45 : pressed ? 0.75 : hovered ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[kind]} size="small" />
      ) : icon ? (
        <Icon name={icon} size={small ? 16 : 18} color={fg[kind]} />
      ) : null}
      <Text style={[small ? type.subheadline : type.headline, { color: fg[kind], fontWeight: '600' }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color, size = 20 }: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed || hovered ? c.fill : 'transparent',
      })}
    >
      <Icon name={icon} size={size} color={color ?? c.tint} />
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  const c = useColors();
  const s = useStyles(styles);
  return (
    <View style={[{ gap: 6 }, style as StyleProp<ViewStyle>]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.tertiaryLabel}
        {...input}
        style={[s.input, input.multiline && { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]}
      />
      {error ? <Text style={[type.footnote, { color: c.destructive }]}>{error}</Text> : hint ? <Small>{hint}</Small> : null}
    </View>
  );
}

/** A number field that keeps what's typed and reports a number (or null when empty). */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  suffix,
  allowEmpty,
  style,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  hint?: string;
  suffix?: string;
  allowEmpty?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value || (t === '' && value == null) ? t : value == null ? '' : String(value)));
  }, [value]);
  return (
    <Field
      label={suffix ? `${label} (${suffix})` : label}
      value={text}
      hint={hint}
      keyboardType="number-pad"
      inputMode="numeric"
      style={style}
      placeholder={allowEmpty ? 'No limit' : undefined}
      onChangeText={(t) => {
        const clean = t.replace(/[^0-9.]/g, '');
        setText(clean);
        if (clean === '') onChange(allowEmpty ? null : 0);
        else if (!Number.isNaN(Number(clean))) onChange(Number(clean));
      }}
    />
  );
}

/** A date picker: the browser's on the web, typed YYYY-MM-DD elsewhere. */
export function DateField({ label, value, onChange, min, max }: { label?: string; value: string; onChange: (day: string) => void; min?: string; max?: string }) {
  const s = useStyles(styles);
  const c = useColors();
  if (Platform.OS === 'web') {
    return (
      <View style={{ gap: 6 }}>
        {label ? <Text style={s.label}>{label}</Text> : null}
        {createElement('input', {
          type: 'date',
          value,
          min,
          max,
          onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value),
          style: {
            ...StyleSheet.flatten(s.input),
            fontFamily: WEB_FONT,
            colorScheme: 'light',
          },
        })}
      </View>
    );
  }
  return <Field label={label} value={value} onChangeText={(t) => /^\d{4}-\d{2}-\d{2}$/.test(t) && onChange(t)} placeholder="YYYY-MM-DD" />;
}

/** A time-of-day picker ("HH:MM", 24-hour), the browser's on the web. */
export function TimeField({ label, value, onChange, step = 15 }: { label?: string; value: string; onChange: (hm: string) => void; step?: number }) {
  const s = useStyles(styles);
  const c = useColors();
  if (Platform.OS === 'web') {
    return (
      <View style={{ gap: 6 }}>
        {label ? <Text style={s.label}>{label}</Text> : null}
        {createElement('input', {
          type: 'time',
          value,
          step: step * 60,
          onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value.slice(0, 5)),
          style: {
            ...StyleSheet.flatten(s.input),
            fontFamily: WEB_FONT,
            colorScheme: 'light',
          },
        })}
      </View>
    );
  }
  return <Field label={label} value={value} onChangeText={(t) => /^\d{1,2}:\d{2}$/.test(t) && onChange(t.padStart(5, '0'))} placeholder="HH:MM" />;
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: IconName;
  small?: boolean;
}) {
  const c = useColors();
  const accent = color ?? c.tint;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: small ? 10 : 12,
        paddingVertical: small ? 5 : 8,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? accent : c.cardBorder,
        backgroundColor: selected ? accent + '22' : c.card,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
      {icon ? <Icon name={icon} size={14} color={selected ? accent : c.secondaryLabel} /> : null}
      <Text style={[small ? type.footnote : type.subheadline, { color: selected ? c.label : c.secondaryLabel, fontWeight: selected ? '600' : '400' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/** Pick one of a few options. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: 10, padding: 2, alignSelf: 'flex-start', flexWrap: 'wrap' }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: on ? c.card : 'transparent',
              boxShadow: on ? '0 1px 3px rgba(0,0,0,0.12)' : undefined,
            }}
          >
            <Text style={[type.subheadline, { color: on ? c.label : c.secondaryLabel, fontWeight: on ? '600' : '400' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.tint, false: c.fill }} thumbColor="#FFFFFF" />
    </Pressable>
  );
}

export function Banner({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success'; icon?: IconName }) {
  const c = useColors();
  const tones = {
    info: [c.slateFill, c.slateText],
    warning: [c.warningFill, c.warning],
    error: [c.destructive + '1A', c.destructive],
    success: [c.tintSoft, c.tint],
  } as const;
  const [bg, fg] = tones[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[type.subheadline, { color: fg, flex: 1 }]}>{children}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Banner tone="error" icon="xCircle">
      {error}
    </Banner>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ padding: 48, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={c.tint} />
      {label ? <Small>{label}</Small> : null}
    </View>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: 32, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.tintSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.tint} />
      </View>
      <Text style={[type.headline, { color: c.label, textAlign: 'center' }]}>{title}</Text>
      {children ? <Small style={{ textAlign: 'center', maxWidth: 360 }}>{children}</Small> : null}
    </View>
  );
}

/** A row in a list card: tap target with title, subtitle and an optional right side. */
export function Row({
  title,
  subtitle,
  right,
  left,
  onPress,
  last,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: onPress && (pressed || hovered) ? c.cardPressed : 'transparent',
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.separator,
      })}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === 'string' ? <Body numberOfLines={1}>{title}</Body> : title}
        {typeof subtitle === 'string' ? <Small numberOfLines={2}>{subtitle}</Small> : subtitle}
      </View>
      {right}
      {onPress && !right ? <Icon name="chevronRight" size={16} color={c.tertiaryLabel} /> : null}
    </Pressable>
  );
}

/**
 * A modal sheet: centered on wide screens, from the bottom on phones. Its body scrolls;
 * the footer (buttons) stays put.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  width = 560,
  accent,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  accent?: string;
}) {
  const c = useColors();
  const wide = useWide(700);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8, 24, 16, 0.45)' }]} />
        <View
          style={{
            width: '100%',
            maxWidth: wide ? width : undefined,
            maxHeight: wide ? height - 48 : height - insets.top - 24,
            backgroundColor: c.card,
            borderRadius: 18,
            borderBottomLeftRadius: wide ? 18 : 0,
            borderBottomRightRadius: wide ? 18 : 0,
            overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(14, 42, 34, 0.25)',
          }}
        >
          {accent ? <View style={{ height: 5, backgroundColor: accent }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 10, paddingTop: 14, paddingBottom: 8 }}>
            <Text style={[type.title3, { color: c.label, flex: 1 }]} numberOfLines={2}>
              {title}
            </Text>
            <IconButton icon="x" label="Close" onPress={onClose} color={c.secondaryLabel} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                gap: 10,
                padding: 16,
                paddingBottom: 16 + (wide ? 0 : insets.bottom),
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: c.separator,
              }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />;
}

/** A small colored label, e.g. "Prime" or "Staff only". */
export function Tag({ label, tone = 'slate' }: { label: string; tone?: 'slate' | 'teal' | 'violet' | 'warning' | 'tint' | 'danger' }) {
  const c = useColors();
  const tones = {
    slate: [c.slateFill, c.slateText],
    teal: [c.tealFill, c.tealText],
    violet: [c.violetFill, c.violetText],
    warning: [c.warningFill, c.warning],
    tint: [c.tintSoft, c.tint],
    danger: [c.destructive + '1A', c.destructive],
  } as const;
  const [bg, fg] = tones[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={[type.caption, { color: fg, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.cardBorder,
      boxShadow: '0 1px 2px rgba(14, 42, 34, 0.06), 0 4px 14px rgba(14, 42, 34, 0.05)',
    },
    label: { ...type.footnote, color: c.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
    input: {
      ...type.body,
      color: c.label,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 44,
    },
  });
