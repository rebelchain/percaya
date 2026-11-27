/**
 * Deep-link helpers shared by the QR generator and the camera scanner.
 * Supported payloads:
 *   percaya://c/<id>
 *   https://percaya.duckdns.org/c/<id>
 *   https://percaya.app/c/<id>
 */
export const CALL_LINK_HOST = 'https://percaya.duckdns.org';

export function buildCallDeepLink(callId: number): string {
  return `percaya://c/${callId}`;
}

export function buildCallWebLink(callId: number): string {
  return `${CALL_LINK_HOST}/c/${callId}`;
}

export function parseCallIdFromLink(raw: string): number | null {
  const text = raw.trim();
  const match =
    /^(?:percaya:\/\/|https:\/\/percaya\.(?:duckdns\.org|app)\/)c\/(\d{1,9})(?:[/?#].*)?$/i.exec(
      text,
    );
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}
