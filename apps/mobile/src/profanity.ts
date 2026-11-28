/**
 * Lightweight client-side profanity / harsh-slang detector for thread theses.
 * Blurs/flags unedited text behind a quiet tap-to-reveal bar without altering raw on-chain data.
 */

const FLAGGED_PATTERNS = [
  /\bf+u+c+k+(?:ing|ed|er|s)?\b/i,
  /\b(?:bull)?s+h+i+t+(?:ty|s)?\b/i,
  /\bb+i+t+c+h+(?:es)?\b/i,
  /\ba+s+s+h+o+l+e+s?\b/i,
  /\bb+a+s+t+a+r+d+s?\b/i,
  /\bd+i+c+k+h+e+a+d+s?\b/i,
  /\bc+u+n+t+s?\b/i,
  /\bm+o+t+h+e+r+f+u+c+k/i,
  /\bs+c+a+m+m+e+r+s?\b/i,
];

export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  return FLAGGED_PATTERNS.some((re) => re.test(text));
}
