import { createHash } from 'node:crypto';

/** 32 symbols: A-Z without I and O, digits 2-9 (excludes 0/O/1/I). */
export const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const sha1Hex = (s: string): string => createHash('sha1').update(s).digest('hex');
export const hex6 = (s: string): string => sha1Hex(s).slice(0, 6).toUpperCase();

export function safeCode(seed: string, length = 6): string {
  const digest = createHash('sha1').update(seed).digest();
  let out = '';
  for (let i = 0; i < length; i++) out += SAFE_ALPHABET[digest[i] % SAFE_ALPHABET.length];
  return out;
}

/** Stable JSON (sorted keys) for fingerprints and dataset hashes. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
