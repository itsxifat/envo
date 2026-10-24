import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { Mail, Phone } from 'lucide-react-native';

import { formatPhone } from '@/lib/format';
import { useSession } from '@/state/session';
import { space } from '@/theme/tokens';
import { Button } from './ui/Button';
import { IconTile } from './ui/IconTile';
import { ListGroup, ListRow } from './ui/ListRow';
import { Sheet } from './ui/Sheet';

/**
 * How to reach Enfinito's support: call or email, whichever is set in the phone settings. `available`
 * is false when neither is, and then nothing should offer help.
 */
export function useSupportSheet(): { available: boolean; open: () => void; sheet: ReactNode } {
  const { config } = useSession();
  const [visible, setVisible] = useState(false);
  const phone = config?.support.phone ?? '';
  const email = config?.support.email ?? '';
  const close = () => setVisible(false);
  const reach = (url: string) => {
    close();
    void Linking.openURL(url).catch(() => undefined);
  };

  const sheet = (
    <Sheet visible={visible} onClose={close} title="Help and support" subtitle="How would you like to reach us?">
      <ListGroup>
        {phone ? <ListRow title={`Call ${formatPhone(phone)}`} left={<IconTile icon={Phone} size="sm" on="surface" />} onPress={() => reach(`tel:${phone}`)} /> : null}
        {email ? <ListRow title="Email support" subtitle={email} left={<IconTile icon={Mail} size="sm" on="surface" />} onPress={() => reach(`mailto:${email}`)} /> : null}
      </ListGroup>
      <Button title="Cancel" variant="secondary" size="md" onPress={close} block style={styles.cancel} />
    </Sheet>
  );

  return { available: !!(phone || email), open: () => setVisible(true), sheet };
}

const styles = StyleSheet.create({
  cancel: { marginTop: space.lg },
});
