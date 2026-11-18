import { describe, expect, it } from 'vitest';

import { sanitizeFileName, validateUpload } from './file-validation.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('validateUpload', () => {
  it('accepts a real PNG regardless of claimed name', async () => {
    await expect(validateUpload(PNG)).resolves.toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('accepts a PDF', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    await expect(validateUpload(pdf)).resolves.toMatchObject({ mimeType: 'application/pdf' });
  });

  it('rejects HTML, SVG and scripts even if named .png', async () => {
    await expect(
      validateUpload(Buffer.from('<html><script>alert(1)</script></html>')),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
    await expect(
      validateUpload(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });

  it('rejects empty and oversized files', async () => {
    await expect(validateUpload(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(validateUpload(big)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});

describe('sanitizeFileName', () => {
  it('strips paths, markup and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\photo<script>.png')).toBe('photoscript.png');
    expect(sanitizeFileName('a\u0000b.jpg')).toBe('ab.jpg');
    expect(sanitizeFileName(undefined)).toBe('file');
  });
});
