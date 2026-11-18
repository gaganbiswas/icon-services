import { HttpStatus } from '@nestjs/common';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '@icon/contracts';
import { fileTypeFromBuffer } from 'file-type';

import { AppException } from '../common/app-exception.js';

export interface ValidatedUpload {
  readonly mimeType: (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];
  readonly extension: string;
}

/**
 * Determines the real type from file content (magic bytes) — the client's
 * declared type and file name are never trusted (CLAUDE.md §8).
 */
export async function validateUpload(buffer: Buffer): Promise<ValidatedUpload> {
  if (buffer.length === 0) {
    throw new AppException(HttpStatus.BAD_REQUEST, 'UNSUPPORTED_FILE', 'The file is empty');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'FILE_TOO_LARGE',
      'Files must be 10 MB or smaller',
    );
  }
  const detected = await fileTypeFromBuffer(buffer);
  const allowed = ALLOWED_UPLOAD_MIME_TYPES as readonly string[];
  if (!detected || !allowed.includes(detected.mime)) {
    throw new AppException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'UNSUPPORTED_FILE',
      'Only JPEG, PNG, WebP, HEIC images and PDF documents are accepted',
    );
  }
  return { mimeType: detected.mime as ValidatedUpload['mimeType'], extension: detected.ext };
}

/** Keeps a display-safe original name (no paths, control characters or markup). */
export function sanitizeFileName(name: string | undefined): string {
  const base = (name ?? 'file').split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim();
  return (cleaned || 'file').slice(0, 200);
}
