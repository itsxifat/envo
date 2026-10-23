import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, FolderOpen, Images } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import type { Source } from './pickers';

const OPTIONS: { source: Source; title: string; text: string; icon: (color: string) => ReactNode }[] = [
  { source: 'camera', title: 'Take a photo', text: 'With the camera, now', icon: (c) => <Camera size={20} color={c} /> },
  { source: 'gallery', title: 'Choose from gallery', text: 'A photo already on your phone', icon: (c) => <Images size={20} color={c} /> },
  { source: 'files', title: 'Choose a file', text: 'A photo or a PDF scan', icon: (c) => <FolderOpen size={20} color={c} /> },
];

/** Asks where a document comes from: camera, gallery or the phone's files, in a sheet from below. */
export function useSourceSheet(): { choose: (title: string) => Promise<Source | null>; sheet: ReactNode } {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState<string | null>(null);
  const resolver = useRef<((s: Source | null) => void) | null>(null);

  const choose = useCallback(
    (t: string) =>
      new Promise<Source | null>((resolve) => {
        resolver.current = resolve;
        setTitle(t);
      }),
    [],
  );
  const close = (s: Source | null) => {
    setTitle(null);
    // Let the sheet slide away before the camera or picker opens over it.
    setTimeout(() => resolver.current?.(s), 250);
  };

  const sheet = (
    <Modal visible={title !== null} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close(null)}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={() => close(null)} />
      <View style={[styles.panel, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.lg }]}>
        <View style={[styles.grip, { backgroundColor: colors.elementPressed }]} />
        <Text variant="heading">{title}</Text>
        <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
          All four corners in the picture, nothing covered.
        </Text>
        <View style={styles.options}>
          {OPTIONS.map((o) => (
            <Pressable key={o.source} accessibilityRole="button" accessibilityLabel={o.title} onPress={() => close(o.source)} style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.elementPressed : colors.surface }]}>
              <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>{o.icon(colors.brand)}</View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{o.title}</Text>
                <Text variant="caption" tone="secondary">
                  {o.text}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => close(null)} style={styles.cancel}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
  return { choose, sheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,13,18,0.45)' },
  panel: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.xl, paddingTop: space.md },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: space.lg },
  options: { gap: space.sm, marginTop: space.lg },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, padding: space.md },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancel: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
});
