import { API_BASE_PATH } from '@icon/contracts';
import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'icon_rt';
const COOKIE_PATH = `${API_BASE_PATH}/auth`;

function baseOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expires: Date,
  secure: boolean,
): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(secure), expires });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(secure));
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : undefined;
}
