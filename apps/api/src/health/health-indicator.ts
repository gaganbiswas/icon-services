/** A dependency whose availability determines API readiness. */
export interface HealthIndicator {
  /** Stable, non-sensitive name exposed in the readiness response. */
  readonly name: string;
  /** Resolves `true` when healthy. May reject; the caller treats that as down. */
  check(): Promise<boolean>;
}

/** DI token for the list of readiness indicators. */
export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');
