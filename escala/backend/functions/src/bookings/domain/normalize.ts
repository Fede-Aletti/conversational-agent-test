/** Case/space/hyphen/diacritic-insensitive key for surnames. */
export const normalizeName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const normalizePnr = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normalizeIata = (s: string): string => s.toUpperCase().replace(/[^A-Z]/g, '');
