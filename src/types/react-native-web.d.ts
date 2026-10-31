import 'react-native';

// React Native Web adds hover and focus to Pressable's state (a mouse is around on the web).
declare module 'react-native' {
  interface PressableStateCallbackType {
    hovered?: boolean;
    focused?: boolean;
  }
}
