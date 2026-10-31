import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/lib/theme';
import { Button } from './ui';

const HEIGHT = 140;

/**
 * Sign with a finger or mouse. Reports the signature as an SVG path ("M x y L x y …"), or ''
 * once cleared.
 */
export function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const c = useColors();
  const [path, setPath] = useState('');
  const current = useRef('');
  const report = useRef(onChange);
  report.current = onChange;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          current.current += `${current.current ? ' ' : ''}M${x.toFixed(1)} ${y.toFixed(1)}`;
          setPath(current.current);
        },
        onPanResponderMove: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          current.current += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
          setPath(current.current);
        },
        onPanResponderRelease: () => report.current(current.current),
      }),
    [],
  );

  return (
    <View style={{ gap: 6 }}>
      <View
        {...responder.panHandlers}
        style={{ height: HEIGHT, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: '#FFFFFF', overflow: 'hidden', ...({ touchAction: 'none', cursor: 'crosshair' } as object) }}
      >
        <Svg width="100%" height={HEIGHT} pointerEvents="none">
          <Path d={path || 'M0 0'} stroke="#10241A" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 28, height: 1, backgroundColor: c.cardBorder }} />
      </View>
      <Button
        small
        kind="plain"
        title="Clear"
        style={{ alignSelf: 'flex-end' }}
        onPress={() => {
          current.current = '';
          setPath('');
          report.current('');
        }}
      />
    </View>
  );
}
