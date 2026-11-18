import { execFileSync } from 'node:child_process';

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { TEST_BUCKET, paths, testDatabaseUrl } from './test-database.js';

/** Applies all migrations to the test database and ensures the test bucket exists. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  execFileSync(process.execPath, [paths.prismaCli, 'migrate', 'deploy'], {
    cwd: paths.databasePackage,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });

  const s3 = new S3Client({
    region: process.env['S3_REGION'] ?? 'us-east-1',
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
    },
    ...(process.env['S3_ENDPOINT'] ? { endpoint: process.env['S3_ENDPOINT'] } : {}),
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  }
  s3.destroy();
}
