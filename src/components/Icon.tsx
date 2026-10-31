import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Line icons (24 × 24, drawn with a 2 px stroke in the given color). */
const paths = {
  calendar: (
    <>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  users: (
    <>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </>
  ),
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M8 12.5l2.8 2.8L16.5 9.5" />
    </>
  ),
  x: <Path d="M6 6l12 12M18 6L6 18" />,
  xCircle: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  chevronLeft: <Path d="M15 5l-7 7 7 7" />,
  chevronRight: <Path d="M9 5l7 7-7 7" />,
  chevronDown: <Path d="M6 9l6 6 6-6" />,
  settings: (
    <>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  grid: (
    <>
      <Rect x={3} y={4} width={18} height={16} rx={2} />
      <Path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    </>
  ),
  list: <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  repeat: (
    <>
      <Path d="M17 2l4 4-4 4" />
      <Path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" />
      <Path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </>
  ),
  tv: (
    <>
      <Rect x={2.5} y={4} width={19} height={13} rx={2} />
      <Path d="M8 21h8M12 17v4" />
    </>
  ),
  tablet: (
    <>
      <Rect x={5} y={2.5} width={14} height={19} rx={2} />
      <Path d="M11 18h2" />
    </>
  ),
  ban: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  star: <Path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  scale: <Path d="M12 3v18M7 21h10M4 7h16M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z" />,
  cloud: <Path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z" />,
  move: <Path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  trash: <Path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />,
  edit: <Path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  search: (
    <>
      <Circle cx={11} cy={11} r={6.5} />
      <Path d="M16 16l4.5 4.5" />
    </>
  ),
  logout: <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />,
  ball: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Circle cx={12} cy={8} r={1} />
      <Circle cx={8.5} cy={13} r={1} />
      <Circle cx={15.5} cy={13} r={1} />
      <Circle cx={12} cy={17} r={1} />
    </>
  ),
  machine: (
    <>
      <Rect x={6} y={8} width={12} height={12} rx={2} />
      <Circle cx={12} cy={14} r={2.5} />
      <Path d="M9 8V5h6v3" />
    </>
  ),
  bell: <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  link: <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  dollar: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M15 9c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6v1.5M12 16.5V18" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}
