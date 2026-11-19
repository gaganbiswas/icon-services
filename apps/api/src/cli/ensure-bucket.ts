/**
 * Creates the private storage bucket if it does not exist (deployment step, Phase 12).
 * Uses the same validated environment as the API. Idempotent.
 */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { loadLocalEnvFile } from '../bootstrap/load-local-env-file.js';
import { parseEnv } from '../config/env.js';

async function main(): Promise<void> {
  loadLocalEnvFile();
  const env = parseEnv(process.env);
  const client = new S3Client({
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    process.stdout.write(`Bucket ${env.S3_BUCKET} exists.\n`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    process.stdout.write(`Bucket ${env.S3_BUCKET} created (private).\n`);
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `ensure-bucket failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
