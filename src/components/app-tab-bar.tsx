import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, palette } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export const TAB_ICONS: Record<string, IconName> = {
  circle: 'radio-button-on-outline',
  inbox: 'chatbubble-outline',
  home: 'sparkles-outline',
  profile: 'person-outline',
  dev: 'build-outline',
};

// The app's tabs (design guide v1, 2026-10-25). Phones: a bottom bar with an
// icon and a label. Wide screens (over ~720px): a top bar across the page,
// its contents in the same centered column as the screens, with "Limen" on
// the left and the tabs as pills on the right.
export function AppTabBar({ state, descriptors, navigation, wide, visible }: BottomTabBarProps & { wide: boolean; visible: string[] }) {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const routes = state.routes.filter((r) => visible.includes(r.name));
  const activeName = state.routes[state.index]?.name;

  const go = (name: string, key: string) => {
    const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true });
    if (activeName !== name && !event.defaultPrevented) navigation.navigate(name);
  };

  if (wide) {
    return (
      <View
        className="w-full items-center border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800"
        accessibilityRole="tablist">
        <View className="h-[68px] w-full flex-row items-center justify-between px-4" style={{ maxWidth: layout.column + 32 }}>
          <Text className="text-[22px] font-bold text-accent-500 dark:text-accent-400">Limen</Text>
          <View className="flex-row gap-1">
            {routes.map((route) => {
              const active = route.name === activeName;
              const label = (descriptors[route.key].options.title ?? route.name) as string;
              return (
                <Pressable
                  key={route.key}
                  onPress={() => go(route.name, route.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  aria-selected={active}
                  className={`min-h-11 justify-center rounded-full px-4 ${active ? 'bg-accent-100 dark:bg-stone-700' : 'active:bg-stone-100 dark:active:bg-stone-700'}`}>
                  <Text
                    className={`text-[15px] ${
                      active ? 'font-semibold text-accent-600 dark:text-accent-300' : 'font-medium text-stone-600 dark:text-stone-300'
                    }`}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      className="flex-row border-t border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      accessibilityRole="tablist">
      {routes.map((route) => {
        const active = route.name === activeName;
        const label = (descriptors[route.key].options.title ?? route.name) as string;
        const color = active ? (dark ? palette.darkLink : palette.link) : dark ? palette.darkTextSoft : palette.inkSoft;
        return (
          <Pressable
            key={route.key}
            onPress={() => go(route.name, route.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityLabel={label}
            className="min-h-14 flex-1 items-center justify-center gap-0.5 pt-2">
            <Ionicons name={TAB_ICONS[route.name] ?? 'ellipse-outline'} size={24} color={color} />
            <Text style={{ color }} className={`text-[14px] ${active ? 'font-bold' : 'font-medium'}`} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
