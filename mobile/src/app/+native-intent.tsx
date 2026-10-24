/*
 * Links into the app, before Expo Router opens a screen for them. After an online payment the payment
 * page sends the person back with envophone://payment?payment=…&invoice=…: the recharge screen reads
 * that link itself (WebBrowser.openAuthSessionAsync listens for it), so the router must not open a
 * screen for it (there is none, it would show "Unmatched Route" over the recharge screen).
 */

/** The router gets the whole link ("envophone://payment?…"); a bare path ("/payment?…") is matched too. */
const PAYMENT_LINK = /^(?:envophone:\/\/\/?|\/)payment\/?(?:[?#]|$)/i;

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  // While the app runs it stays where it is; if the link opened the app (it was closed meanwhile),
  // it starts at home, where the balance shows what the payment did.
  if (PAYMENT_LINK.test(path)) return initial ? '/' : null;
  return path;
}
