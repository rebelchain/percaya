import crypto from 'node:crypto';
import {
  DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  DEFAULT_PERCAYA_PROGRAM_ID,
  u64LeBytes,
} from '@percaya/core';

/**
 * Computes exact 8-byte Anchor global instruction discriminator: sha256("global:<snake_name>")[0..8]
 */
export function anchorIxDiscriminator(snakeName: string): Buffer {
  return crypto.createHash('sha256').update(`global:${snakeName}`).digest().subarray(0, 8);
}

/**
 * Computes exact 8-byte Anchor account discriminator: sha256("account:<PascalName>")[0..8]
 */
export function anchorAccountDiscriminator(pascalName: string): Buffer {
  return crypto.createHash('sha256').update(`account:${pascalName}`).digest().subarray(0, 8);
}

export function encodeInitPositionIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('init_position'));
}

export function encodeDepositIxData(amountLamports: bigint): Buffer {
  return Buffer.concat([
    anchorIxDiscriminator('deposit'),
    Buffer.from(u64LeBytes(amountLamports)),
  ]);
}

export function encodeWithdrawIxData(amountLamports: bigint): Buffer {
  return Buffer.concat([
    anchorIxDiscriminator('withdraw'),
    Buffer.from(u64LeBytes(amountLamports)),
  ]);
}

export function encodeBuyIxData(minTokensOut: bigint): Buffer {
  return Buffer.concat([anchorIxDiscriminator('buy'), Buffer.from(u64LeBytes(minTokensOut))]);
}

export function encodeCheckpointIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('checkpoint'));
}

export function encodeSellIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('sell'));
}

export function encodeRefundIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('refund'));
}

export function encodeSplitIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('split'));
}

export function encodeClaimIxData(): Buffer {
  return Buffer.from(anchorIxDiscriminator('claim'));
}

export function encodeOpenCallIxData(args: {
  windowDuration: number;
  takeProfitBps: number;
  stopLossBps: number;
  maxHoldDuration: number;
  shareBps: number;
  stakeLamports: bigint;
  thesis: string;
}): Buffer {
  const thesisBuf = Buffer.from(args.thesis, 'utf8');
  if (thesisBuf.length > 280) {
    throw new Error('Thesis exceeds 280 UTF-8 bytes');
  }
  const fixed = Buffer.alloc(4 + 4 + 2 + 4 + 2 + 8 + 4);
  let offset = 0;
  fixed.writeUInt32LE(args.windowDuration, offset);
  offset += 4;
  fixed.writeUInt32LE(args.takeProfitBps, offset);
  offset += 4;
  fixed.writeUInt16LE(args.stopLossBps, offset);
  offset += 2;
  fixed.writeUInt32LE(args.maxHoldDuration, offset);
  offset += 4;
  fixed.writeUInt16LE(args.shareBps, offset);
  offset += 2;
  fixed.writeBigUInt64LE(args.stakeLamports, offset);
  offset += 8;
  fixed.writeUInt32LE(thesisBuf.length, offset);

  return Buffer.concat([anchorIxDiscriminator('open_call'), fixed, thesisBuf]);
}

export function getProgramIds() {
  return {
    percayaProgramId: process.env.PERCAYA_PROGRAM_ID || DEFAULT_PERCAYA_PROGRAM_ID,
    ammProgramId: process.env.PERCAYA_AMM_PROGRAM_ID || DEFAULT_PERCAYA_AMM_PROGRAM_ID,
  };
}
