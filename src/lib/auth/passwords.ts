import bcrypt from "bcryptjs";

/** bcrypt cost 12: ~250ms per hash on commodity hardware, a sensible 2026 default. */
export const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * A real hash of a throwaway password, compared against when the account does
 * not exist so that login timing does not reveal whether an email is registered.
 */
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash("companion-dummy-password-for-timing", BCRYPT_COST);
  return dummyHashPromise;
}
