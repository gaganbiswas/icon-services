import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Accept a caller-supplied request ID only if it is a short, safe token. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const userAgent = req.header('user-agent');
  storage.run(
    {
      requestId,
      ipAddress: req.ip ?? null,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
    },
    next,
  );
}

/** Context of the current HTTP request, or a fresh system context outside one. */
export function currentRequestContext(): RequestContext {
  return storage.getStore() ?? { requestId: randomUUID(), ipAddress: null, userAgent: null };
}
