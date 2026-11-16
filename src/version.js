/** Versão do Frio Tickets.
 *  Aumente RELEASE em 1 a cada nova entrega. Os dígitos viram a versão (como um odômetro):
 *  1 → 0.0.0.1 • 9 → 0.0.0.9 • 10 → 0.0.1.0 • 20 → 0.0.2.0 • 100 → 0.1.0.0
 */
export const RELEASE = 1;
export const STAGE = 'beta';
export const VERSION = String(RELEASE).padStart(4, '0').split('').join('.');
export const VERSION_LABEL = `${VERSION} ${STAGE}`;
