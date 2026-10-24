/** What the app keeps on the phone (SecureStore), besides the sign-in and the sound settings. */
export const KEYS = {
  /** The KYC form's text fields, so a second try starts filled in. */
  kycDraft: 'envo.kycDraft',
  /** The "your number is ready" moment was shown for this number. */
  readySeen: (number: string) => `envo.readySeen.${number}`,
};
