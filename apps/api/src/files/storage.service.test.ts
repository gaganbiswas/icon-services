import { describe, expect, it } from 'vitest';

import { testEnv } from '../../test/test-env.js';
import { StorageService } from './storage.service.js';

describe('StorageService signed URLs', () => {
  it('signs browser links with the public endpoint when one is configured', async () => {
    const storage = new StorageService(
      testEnv({
        S3_ENDPOINT: 'http://s3:8333',
        S3_PUBLIC_ENDPOINT: 'https://files.example.test',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    );
    const { url } = await storage.signedDownloadUrl('org/1/file.pdf', 'Receipt 1.pdf');
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://files.example.test');
    expect(parsed.pathname).toBe('/icon-test/org/1/file.pdf');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="Receipt_1.pdf"',
    );
    storage.onModuleDestroy();
  });

  it('uses the storage endpoint itself otherwise', async () => {
    const storage = new StorageService(
      testEnv({ S3_ENDPOINT: 'http://localhost:8333', S3_FORCE_PATH_STYLE: 'true' }),
    );
    expect(new URL((await storage.signedDownloadUrl('k', 'f')).url).origin).toBe(
      'http://localhost:8333',
    );
    storage.onModuleDestroy();
  });
});
