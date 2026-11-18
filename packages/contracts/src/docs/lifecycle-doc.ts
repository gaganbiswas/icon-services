import { CUSTOMER_STATUS_BY_JOB_STATUS, CUSTOMER_STATUS_LABELS, JOB_STATUSES } from '../jobs.js';
import { TRANSITIONS } from '../lifecycle.js';

const GUARD_TEXT: Record<string, string> = {
  APPROVED_ESTIMATE: 'current estimate approved by the customer',
  REJECTED_ESTIMATE: 'current estimate rejected by the customer (return unrepaired)',
  COMPLETION_RECORD: 'repair summary + passed QC via completion action',
  DELIVERY_WORKFLOW: 'delivery actions only (dispatch / hand-over / failed attempt)',
  RECEIVE_ACTION: '“Receive device” action only',
  RESUME_TARGET: 'only the status held from',
};

/** Renders docs/job-lifecycle.md from the transition matrix (single source of truth). */
export function renderLifecycleDoc(): string {
  const lines = [
    '# Job lifecycle',
    '',
    '<!-- GENERATED from packages/contracts/src/lifecycle.ts — run `bun run docs:lifecycle` in packages/contracts. Do not edit by hand. -->',
    '',
    'All changes go through `POST /api/v1/jobs/:id/status-transitions` (or the receive / completion / delivery actions),',
    'require `jobs.transition`, and — for technicians without `jobs.assign` — an active assignment. See ADR 0013.',
    '',
    '| From | To | Reason | Extra permission | Condition |',
    '|------|----|--------|------------------|-----------|',
  ];
  for (const from of JOB_STATUSES) {
    for (const rule of TRANSITIONS[from]) {
      lines.push(
        `| ${from} | ${rule.to} | ${rule.reasonRequired ? 'required' : '—'} | ${rule.permission ?? '—'} | ${rule.guard ? GUARD_TEXT[rule.guard] : '—'} |`,
      );
    }
  }
  lines.push(
    '',
    '## Customer-facing status',
    '',
    '| Internal status | Customer sees |',
    '|-----------------|---------------|',
  );
  for (const status of JOB_STATUSES) {
    lines.push(`| ${status} | ${CUSTOMER_STATUS_LABELS[CUSTOMER_STATUS_BY_JOB_STATUS[status]]} |`);
  }
  return `${lines.join('\n')}\n`;
}
