import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, FolderOpen, Images, type LucideIcon } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { IconTile } from '@/components/ui/IconTile';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { Sheet } from '@/components/ui/Sheet';
import { space } from '@/theme/tokens';
import type { Source } from './pickers';

const OPTIONS: { source: Source; title: string; text: string; icon: LucideIcon }[] = [
  { source: 'camera', title: 'Take a photo', text: 'With the camera, now', icon: Camera },
  { source: 'gallery', title: 'Choose from gallery', text: 'A photo already on your phone', icon: Images },
  { source: 'files', title: 'Choose a file', text: 'A photo or a PDF scan', icon: FolderOpen },
];

/** Asks where a document comes from: the camera, the gallery or the phone's files, in a sheet from below. */
export function useSourceSheet(): { choose: (title: string) => Promise<Source | null>; sheet: ReactNode } {
  // The title stays while the sheet slides away.
  const [title, setTitle] = useState('');
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((s: Source | null) => void) | null>(null);

  const choose = useCallback(
    (t: string) =>
      new Promise<Source | null>((resolve) => {
        // A second tap while the sheet is up answers the first one with nothing.
        resolver.current?.(null);
        resolver.current = resolve;
        setTitle(t);
        setVisible(true);
      }),
    [],
  );
  const close = (s: Source | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setVisible(false);
    // Let the sheet slide away before the camera or picker opens over it.
    setTimeout(() => resolve?.(s), 250);
  };

  const sheet = (
    <Sheet visible={visible} onClose={() => close(null)} title={title} subtitle="All four corners in the picture, nothing covered.">
      <ListGroup>
        {OPTIONS.map((o) => (
          <ListRow key={o.source} title={o.title} subtitle={o.text} left={<IconTile icon={o.icon} tone="brand" />} onPress={() => close(o.source)} />
        ))}
      </ListGroup>
      <Button title="Cancel" variant="secondary" size="md" onPress={() => close(null)} block style={styles.cancel} />
    </Sheet>
  );
  return { choose, sheet };
}

const styles = StyleSheet.create({
  cancel: { marginTop: space.lg },
});
