import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '@icon/database';

@Injectable()
export class PasswordService {
  /**
   * Hash of a random value, verified when a login targets an unknown or
   * password-less account so response timing does not reveal account existence.
   */
  private readonly dummyHash: Promise<string> = hash(
    `dummy-${Math.random().toString(36)}`,
    ARGON2_OPTIONS,
  );

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (!passwordHash) {
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
