import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Allowed upload types, sniffed from content on the server (ADR 0012). */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export const FileSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type StoredFileInfo = z.infer<typeof FileSchema>;

export const SignedUrlSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
