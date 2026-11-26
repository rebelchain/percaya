export const DEFAULT_PERCAYA_PROGRAM_ID = '8ZMPKC79FfVvKsQXudDUJfGmmSMRd1HkY2QU7anrCcf6';
export const DEFAULT_PERCAYA_AMM_PROGRAM_ID = 'AzU89s97v6XKT8oKkyV82p2k17z1eK2aFhGwrXTpquxz';

const encoder = new TextEncoder();

export function u64LeBytes(value: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export const PDA_SEEDS = {
  config: () => [encoder.encode('config')],
  allowedToken: (mintBytes: Uint8Array) => [encoder.encode('allowed_token'), mintBytes],
  caller: (callerBytes: Uint8Array) => [encoder.encode('caller'), callerBytes],
  bondVault: (callerBytes: Uint8Array) => [encoder.encode('bond_vault'), callerBytes],
  genesis: (genesisMintBytes: Uint8Array) => [encoder.encode('genesis'), genesisMintBytes],
  call: (callId: bigint | number) => [encoder.encode('call'), u64LeBytes(callId)],
  solVault: (callId: bigint | number) => [encoder.encode('sol_vault'), u64LeBytes(callId)],
  position: (callId: bigint | number, participantBytes: Uint8Array) => [
    encoder.encode('position'),
    u64LeBytes(callId),
    participantBytes,
  ],
  ammPool: (mintBytes: Uint8Array) => [encoder.encode('amm_pool'), mintBytes],
  ammSolVault: (ammPoolBytes: Uint8Array) => [encoder.encode('amm_sol'), ammPoolBytes],
} as const;
