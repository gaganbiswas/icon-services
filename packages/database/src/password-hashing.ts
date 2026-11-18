import type { Algorithm, Options } from '@node-rs/argon2';

/**
 * `Algorithm` is an ambient const enum, which cannot be imported as a value
 * under `verbatimModuleSyntax`; the literal is type-checked against it.
 */
const ARGON2ID: Algorithm.Argon2id = 2;

/**
 * Argon2id parameters (ADR 0010; OWASP minimum: m=19 MiB, t=2, p=1).
 * Shared by the API and the development seed so hashes are consistent.
 */
export const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
