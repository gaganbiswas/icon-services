# Job lifecycle

<!-- GENERATED from packages/contracts/src/lifecycle.ts — run `bun run docs:lifecycle` in packages/contracts. Do not edit by hand. -->

All changes go through `POST /api/v1/jobs/:id/status-transitions` (or the receive / completion / delivery actions),
require `jobs.transition`, and — for technicians without `jobs.assign` — an active assignment. See ADR 0013.

| From | To | Reason | Extra permission | Condition |
|------|----|--------|------------------|-----------|
| AWAITING_DEVICE | RECEIVED | — | — | “Receive device” action only |
| AWAITING_DEVICE | CANCELLED | required | — | — |
| RECEIVED | WARRANTY_CHECK | — | — | — |
| RECEIVED | DIAGNOSIS | — | — | — |
| RECEIVED | ON_HOLD | required | — | — |
| RECEIVED | CANCELLED | required | — | — |
| WARRANTY_CHECK | DIAGNOSIS | — | — | — |
| WARRANTY_CHECK | ON_HOLD | required | — | — |
| WARRANTY_CHECK | CANCELLED | required | — | — |
| DIAGNOSIS | ESTIMATE_PREPARATION | — | — | — |
| DIAGNOSIS | ON_HOLD | required | — | — |
| DIAGNOSIS | CANCELLED | required | — | — |
| ESTIMATE_PREPARATION | AWAITING_CUSTOMER_APPROVAL | — | — | — |
| ESTIMATE_PREPARATION | DIAGNOSIS | required | — | — |
| ESTIMATE_PREPARATION | ON_HOLD | required | — | — |
| ESTIMATE_PREPARATION | CANCELLED | required | — | — |
| AWAITING_CUSTOMER_APPROVAL | REPAIR_IN_PROGRESS | — | — | current estimate approved by the customer |
| AWAITING_CUSTOMER_APPROVAL | WAITING_FOR_PARTS | — | — | current estimate approved by the customer |
| AWAITING_CUSTOMER_APPROVAL | ESTIMATE_PREPARATION | required | — | — |
| AWAITING_CUSTOMER_APPROVAL | READY_FOR_DELIVERY | required | — | current estimate rejected by the customer (return unrepaired) |
| AWAITING_CUSTOMER_APPROVAL | ON_HOLD | required | — | — |
| AWAITING_CUSTOMER_APPROVAL | CANCELLED | required | — | — |
| WAITING_FOR_PARTS | REPAIR_IN_PROGRESS | — | — | — |
| WAITING_FOR_PARTS | ON_HOLD | required | — | — |
| WAITING_FOR_PARTS | CANCELLED | required | — | — |
| REPAIR_IN_PROGRESS | WAITING_FOR_PARTS | — | — | — |
| REPAIR_IN_PROGRESS | QUALITY_CHECK | — | — | — |
| REPAIR_IN_PROGRESS | ON_HOLD | required | — | — |
| QUALITY_CHECK | REPAIR_COMPLETED | — | — | repair summary + passed QC via completion action |
| QUALITY_CHECK | REPAIR_IN_PROGRESS | required | — | — |
| REPAIR_COMPLETED | READY_FOR_DELIVERY | — | — | — |
| READY_FOR_DELIVERY | OUT_FOR_DELIVERY | — | — | delivery actions only (dispatch / hand-over / failed attempt) |
| READY_FOR_DELIVERY | DELIVERED | — | — | delivery actions only (dispatch / hand-over / failed attempt) |
| READY_FOR_DELIVERY | ON_HOLD | required | — | — |
| OUT_FOR_DELIVERY | DELIVERED | — | — | delivery actions only (dispatch / hand-over / failed attempt) |
| OUT_FOR_DELIVERY | READY_FOR_DELIVERY | required | — | delivery actions only (dispatch / hand-over / failed attempt) |
| DELIVERED | RECEIVED | required | jobs.reopen | — |
| CANCELLED | RECEIVED | required | jobs.reopen | — |
| ON_HOLD | RECEIVED | — | — | only the status held from |
| ON_HOLD | WARRANTY_CHECK | — | — | only the status held from |
| ON_HOLD | DIAGNOSIS | — | — | only the status held from |
| ON_HOLD | ESTIMATE_PREPARATION | — | — | only the status held from |
| ON_HOLD | AWAITING_CUSTOMER_APPROVAL | — | — | only the status held from |
| ON_HOLD | WAITING_FOR_PARTS | — | — | only the status held from |
| ON_HOLD | REPAIR_IN_PROGRESS | — | — | only the status held from |
| ON_HOLD | READY_FOR_DELIVERY | — | — | only the status held from |
| ON_HOLD | CANCELLED | required | — | — |

## Customer-facing status

| Internal status | Customer sees |
|-----------------|---------------|
| AWAITING_DEVICE | Request received |
| RECEIVED | Device received |
| WARRANTY_CHECK | Being checked |
| DIAGNOSIS | Being checked |
| ESTIMATE_PREPARATION | Being checked |
| AWAITING_CUSTOMER_APPROVAL | Waiting for your approval |
| WAITING_FOR_PARTS | Repair in progress |
| REPAIR_IN_PROGRESS | Repair in progress |
| QUALITY_CHECK | Repair in progress |
| REPAIR_COMPLETED | Ready |
| READY_FOR_DELIVERY | Ready |
| OUT_FOR_DELIVERY | Out for delivery |
| DELIVERED | Delivered |
| CANCELLED | Cancelled |
| ON_HOLD | On hold |
