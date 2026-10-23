/**
 * Envo's own numbers (Enfinito's 09639 437 block): calls between them are free. The server decides
 * what is charged; this only marks them in the app.
 */
export const isEnvoNumber = (n: string) => /^09639437\d{3}$/.test(n.replace(/\D/g, ''));
