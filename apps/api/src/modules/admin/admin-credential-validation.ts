import { BadRequestException } from '@nestjs/common';

export function normalizeAdminAccount(value: string): string {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) throw new BadRequestException('Account must contain 1–100 printable characters without control characters or invalid Unicode.');
  const account = value.trim();
  if (!account || Array.from(account).length > 100) throw new BadRequestException('Account must contain 1–100 printable characters without control characters.');
  return account;
}

export function validateAdminAssignedPassword(value: string): void {
  if (typeof value !== 'string' || Array.from(value).length < 8 || Array.from(value).length > 128 || Buffer.byteLength(value, 'utf8') > 72) throw new BadRequestException('Password must be 8–128 characters and at most 72 UTF-8 bytes.');
}

export function validateAdminReason(value: string): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 500) throw new BadRequestException('Reason must contain 1–500 characters.');
  return value.trim();
}
