import { Injectable, Logger } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id password hasher with sane OWASP 2026 parameters.
 * Verified parameters live here (never in service consumers) so we can
 * upgrade globally via a needsRehash() check on login.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19 * 1024, // 19 MiB — OWASP minimum for argon2id
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, this.options);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch (err) {
      this.logger.warn({
        message: 'argon2.verify threw',
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * True when the stored hash uses weaker parameters than current policy —
   * caller should rehash and update the row inside the login transaction.
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
