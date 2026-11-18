import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/** Thin S3 adapter so the storage provider stays replaceable (ADR 0009). */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Never rendered inline by browsers from storage.
        ContentDisposition: 'attachment',
      }),
    );
  }

  /** Short-lived download URL; the caller must authorize first. */
  async signedDownloadUrl(
    key: string,
    downloadName: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = this.env.SIGNED_URL_TTL_SECONDS;
    const safeName = downloadName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'file';
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async isReachable(): Promise<boolean> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
