import { describe, expect, it } from 'vitest';

import { JOB_STATUSES, type JobStatus } from './jobs.js';
import { TRANSITIONS, availableTransitions, checkTransition } from './lifecycle.js';

const staff = new Set(['jobs.transition']);
const manager = new Set(['jobs.transition', 'jobs.reopen']);

describe('transition matrix', () => {
  it('defines rules for every status and only valid targets', () => {
    for (const status of JOB_STATUSES) {
      expect(TRANSITIONS[status]).toBeDefined();
      for (const rule of TRANSITIONS[status]) {
        expect(JOB_STATUSES).toContain(rule.to);
        expect(rule.to).not.toBe(status);
      }
    }
  });

  it('never allows DELIVERED or completion without their workflows', () => {
    for (const status of JOB_STATUSES) {
      for (const rule of TRANSITIONS[status]) {
        if (rule.to === 'DELIVERED') expect(rule.guard).toBe('DELIVERY_WORKFLOW');
        if (rule.to === 'REPAIR_COMPLETED') expect(rule.guard).toBe('COMPLETION_RECORD');
      }
    }
  });

  it.each<[JobStatus, JobStatus]>([
    ['RECEIVED', 'DIAGNOSIS'],
    ['DIAGNOSIS', 'ESTIMATE_PREPARATION'],
    ['ESTIMATE_PREPARATION', 'AWAITING_CUSTOMER_APPROVAL'],
    ['WAITING_FOR_PARTS', 'REPAIR_IN_PROGRESS'],
    ['REPAIR_IN_PROGRESS', 'QUALITY_CHECK'],
    ['REPAIR_COMPLETED', 'READY_FOR_DELIVERY'],
  ])('allows %s → %s', (from, to) => {
    expect(checkTransition(from, to, { permissions: staff })).toBeNull();
  });

  it.each<[JobStatus, JobStatus]>([
    ['RECEIVED', 'REPAIR_IN_PROGRESS'],
    ['DIAGNOSIS', 'REPAIR_IN_PROGRESS'],
    ['RECEIVED', 'READY_FOR_DELIVERY'],
    ['REPAIR_IN_PROGRESS', 'CANCELLED'],
    ['DELIVERED', 'REPAIR_IN_PROGRESS'],
  ])('rejects %s → %s', (from, to) => {
    expect(checkTransition(from, to, { permissions: manager, reason: 'r' })).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('requires approval before repair', () => {
    expect(
      checkTransition('AWAITING_CUSTOMER_APPROVAL', 'REPAIR_IN_PROGRESS', { permissions: staff }),
    ).toBe('ESTIMATE_APPROVAL_REQUIRED');
    expect(
      checkTransition('AWAITING_CUSTOMER_APPROVAL', 'REPAIR_IN_PROGRESS', {
        permissions: staff,
        hasApprovedEstimate: true,
      }),
    ).toBeNull();
  });

  it('requires reasons for hold, cancel and send-backs', () => {
    expect(checkTransition('DIAGNOSIS', 'ON_HOLD', { permissions: staff })).toBe('REASON_REQUIRED');
    expect(checkTransition('DIAGNOSIS', 'CANCELLED', { permissions: staff, reason: '  ' })).toBe(
      'REASON_REQUIRED',
    );
    expect(checkTransition('QUALITY_CHECK', 'REPAIR_IN_PROGRESS', { permissions: staff })).toBe(
      'REASON_REQUIRED',
    );
    expect(
      checkTransition('DIAGNOSIS', 'ON_HOLD', {
        permissions: staff,
        reason: 'Customer travelling',
      }),
    ).toBeNull();
  });

  it('resumes from hold only to the previous status', () => {
    expect(
      checkTransition('ON_HOLD', 'DIAGNOSIS', { permissions: staff, heldFrom: 'DIAGNOSIS' }),
    ).toBeNull();
    expect(
      checkTransition('ON_HOLD', 'REPAIR_IN_PROGRESS', {
        permissions: staff,
        heldFrom: 'DIAGNOSIS',
      }),
    ).toBe('INVALID_TRANSITION');
  });

  it('requires the reopen permission and a reason to reopen', () => {
    expect(
      checkTransition('DELIVERED', 'RECEIVED', { permissions: staff, reason: 'Fault returned' }),
    ).toBe('FORBIDDEN');
    expect(checkTransition('DELIVERED', 'RECEIVED', { permissions: manager })).toBe(
      'REASON_REQUIRED',
    );
    expect(
      checkTransition('CANCELLED', 'RECEIVED', {
        permissions: manager,
        reason: 'Customer changed mind',
      }),
    ).toBeNull();
  });

  it('routes special transitions to their workflows', () => {
    expect(checkTransition('AWAITING_DEVICE', 'RECEIVED', { permissions: staff })).toBe(
      'USE_RECEIVE_ACTION',
    );
    expect(checkTransition('READY_FOR_DELIVERY', 'DELIVERED', { permissions: staff })).toBe(
      'USE_DELIVERY_WORKFLOW',
    );
    expect(checkTransition('QUALITY_CHECK', 'REPAIR_COMPLETED', { permissions: staff })).toBe(
      'COMPLETION_REQUIRED',
    );
  });

  it('denies everything without jobs.transition', () => {
    expect(checkTransition('RECEIVED', 'DIAGNOSIS', { permissions: new Set() })).toBe('FORBIDDEN');
  });

  it('offers only actionable targets in the UI', () => {
    expect(availableTransitions('RECEIVED', { permissions: staff }).map((t) => t.to)).toEqual([
      'WARRANTY_CHECK',
      'DIAGNOSIS',
      'ON_HOLD',
      'CANCELLED',
    ]);
    expect(
      availableTransitions('AWAITING_CUSTOMER_APPROVAL', { permissions: staff }).map((t) => t.to),
    ).not.toContain('REPAIR_IN_PROGRESS');
    expect(
      availableTransitions('READY_FOR_DELIVERY', { permissions: staff }).map((t) => t.to),
    ).not.toContain('DELIVERED');
    expect(
      availableTransitions('ON_HOLD', { permissions: staff, heldFrom: 'DIAGNOSIS' }).map(
        (t) => t.to,
      ),
    ).toEqual(['DIAGNOSIS', 'CANCELLED']);
  });
});
