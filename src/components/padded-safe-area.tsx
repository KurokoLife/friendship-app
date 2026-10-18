import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// 2026-10-17: SafeAreaView sets its own padding (the phone's notch and home
// bar), which on the web wiped out padding classes like "px-6 py-10" put on
// it, so joining screens had text touching the screen edges. The safe area
// now wraps a plain View that carries the classes, so both apply.
export function PaddedSafeArea({
  className,
  style,
  children,
}: {
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View className={className} style={style}>
        {children}
      </View>
    </SafeAreaView>
  );
}
