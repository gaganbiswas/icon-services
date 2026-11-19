# Authorization matrix

> Generated from the API controllers by `apps/api/test/authorization-matrix.int.test.ts`
> (`UPDATE_DOCS=1` to regenerate). Do not edit by hand.

Every route is authenticated unless public. Staff routes enforce all listed permissions on every request and
scope records to the organization and permitted branches (out-of-scope records → 404). Customer routes take
identity from the customer token only. Public routes are rate-limited and protected by their own token/signature.

Routes: 117 (public 15, customer 14, staff 88).

| Method | Path                                         | Access   | Permissions                      |
| ------ | -------------------------------------------- | -------- | -------------------------------- |
| GET    | `/api/v1/asset-categories`                   | staff    | `assets.read`                    |
| POST   | `/api/v1/assets`                             | staff    | `assets.write`                   |
| GET    | `/api/v1/assets/:id`                         | staff    | `assets.read`                    |
| GET    | `/api/v1/audit-logs`                         | staff    | `audit.read`                     |
| POST   | `/api/v1/auth/login`                         | public   | —                                |
| POST   | `/api/v1/auth/logout`                        | public   | —                                |
| GET    | `/api/v1/auth/mfa`                           | staff    | signed-in staff                  |
| POST   | `/api/v1/auth/mfa/enrollment`                | staff    | signed-in staff                  |
| POST   | `/api/v1/auth/mfa/enrollment/confirm`        | staff    | signed-in staff                  |
| POST   | `/api/v1/auth/mfa/verify`                    | public   | —                                |
| POST   | `/api/v1/auth/password-setup/complete`       | public   | —                                |
| POST   | `/api/v1/auth/password/change`               | staff    | signed-in staff                  |
| POST   | `/api/v1/auth/refresh`                       | public   | —                                |
| GET    | `/api/v1/branches`                           | staff    | `branches.read`                  |
| GET    | `/api/v1/branches/:id`                       | staff    | `branches.read`                  |
| GET    | `/api/v1/customer/asset-categories`          | customer | —                                |
| GET    | `/api/v1/customer/assets`                    | customer | —                                |
| POST   | `/api/v1/customer/auth/logout`               | public   | —                                |
| POST   | `/api/v1/customer/auth/otp/request`          | public   | —                                |
| POST   | `/api/v1/customer/auth/otp/verify`           | public   | —                                |
| POST   | `/api/v1/customer/auth/refresh`              | public   | —                                |
| GET    | `/api/v1/customer/branches`                  | customer | —                                |
| PUT    | `/api/v1/customer/consents`                  | customer | —                                |
| POST   | `/api/v1/customer/estimates/:id/decision`    | customer | —                                |
| POST   | `/api/v1/customer/files`                     | customer | —                                |
| GET    | `/api/v1/customer/jobs`                      | customer | —                                |
| POST   | `/api/v1/customer/jobs`                      | customer | —                                |
| GET    | `/api/v1/customer/jobs/:id`                  | customer | —                                |
| GET    | `/api/v1/customer/jobs/:id/estimates`        | customer | —                                |
| POST   | `/api/v1/customer/jobs/:id/receipt`          | customer | —                                |
| GET    | `/api/v1/customer/me`                        | customer | —                                |
| GET    | `/api/v1/customer/payments`                  | customer | —                                |
| POST   | `/api/v1/customer/payments/:id/receipt`      | customer | —                                |
| GET    | `/api/v1/customers`                          | staff    | `customers.read`                 |
| POST   | `/api/v1/customers`                          | staff    | `customers.write`                |
| GET    | `/api/v1/customers/:customerId/assets`       | staff    | `assets.read`                    |
| GET    | `/api/v1/customers/:id`                      | staff    | `customers.read`                 |
| PATCH  | `/api/v1/customers/:id`                      | staff    | `customers.write`                |
| GET    | `/api/v1/customers/:id/account`              | staff    | `payments.read`                  |
| PUT    | `/api/v1/customers/:id/consents`             | staff    | `customers.write`                |
| GET    | `/api/v1/deliveries`                         | staff    | `deliveries.read`                |
| POST   | `/api/v1/deliveries/:id/challan`             | staff    | `deliveries.read`                |
| POST   | `/api/v1/deliveries/:id/failed-attempt`      | staff    | `deliveries.write`               |
| GET    | `/api/v1/estimates/:id`                      | staff    | `estimates.read`                 |
| PUT    | `/api/v1/estimates/:id`                      | staff    | `estimates.write`                |
| POST   | `/api/v1/estimates/:id/approval-link`        | staff    | `estimates.send`                 |
| POST   | `/api/v1/estimates/:id/send`                 | staff    | `estimates.send`                 |
| GET    | `/api/v1/estimates/config`                   | staff    | `estimates.read`                 |
| POST   | `/api/v1/files`                              | staff    | `jobs.create`                    |
| GET    | `/api/v1/health/live`                        | public   | —                                |
| GET    | `/api/v1/health/ready`                       | public   | —                                |
| POST   | `/api/v1/inventory/adjustments`              | staff    | `inventory.adjust`               |
| GET    | `/api/v1/inventory/movements`                | staff    | `inventory.read`                 |
| POST   | `/api/v1/inventory/receipts`                 | staff    | `inventory.write`                |
| GET    | `/api/v1/inventory/reconciliation`           | staff    | `inventory.adjust`               |
| GET    | `/api/v1/inventory/stock`                    | staff    | `inventory.read`                 |
| POST   | `/api/v1/inventory/transfers`                | staff    | `inventory.adjust`               |
| GET    | `/api/v1/jobs`                               | staff    | `jobs.read`                      |
| POST   | `/api/v1/jobs`                               | staff    | `jobs.create`                    |
| GET    | `/api/v1/jobs/:id`                           | staff    | `jobs.read`                      |
| GET    | `/api/v1/jobs/:id/assignable-technicians`    | staff    | `jobs.assign`                    |
| POST   | `/api/v1/jobs/:id/assignments`               | staff    | `jobs.assign`                    |
| DELETE | `/api/v1/jobs/:id/assignments/:assignmentId` | staff    | `jobs.assign`                    |
| POST   | `/api/v1/jobs/:id/attachments`               | staff    | `worklogs.write`                 |
| GET    | `/api/v1/jobs/:id/attachments/:fileId/url`   | staff    | `jobs.read`                      |
| POST   | `/api/v1/jobs/:id/completion`                | staff    | `jobs.transition`                |
| GET    | `/api/v1/jobs/:id/deliveries`                | staff    | `deliveries.read`                |
| POST   | `/api/v1/jobs/:id/deliveries/dispatch`       | staff    | `deliveries.write`               |
| POST   | `/api/v1/jobs/:id/deliveries/handover`       | staff    | `deliveries.complete`            |
| POST   | `/api/v1/jobs/:id/diagnoses`                 | staff    | `diagnosis.write`                |
| GET    | `/api/v1/jobs/:id/parts`                     | staff    | `jobs.read`                      |
| POST   | `/api/v1/jobs/:id/parts`                     | staff    | `worklogs.write`                 |
| PUT    | `/api/v1/jobs/:id/parts/removed`             | staff    | `worklogs.write`                 |
| POST   | `/api/v1/jobs/:id/receipt`                   | staff    | `jobs.read`                      |
| POST   | `/api/v1/jobs/:id/receive`                   | staff    | `jobs.update`                    |
| POST   | `/api/v1/jobs/:id/status-transitions`        | staff    | `jobs.transition`                |
| POST   | `/api/v1/jobs/:id/work-logs`                 | staff    | `worklogs.write`                 |
| GET    | `/api/v1/jobs/:id/workspace`                 | staff    | `jobs.read`                      |
| GET    | `/api/v1/jobs/:jobId/estimates`              | staff    | `estimates.read`                 |
| POST   | `/api/v1/jobs/:jobId/estimates`              | staff    | `estimates.write`                |
| GET    | `/api/v1/me`                                 | staff    | signed-in staff                  |
| GET    | `/api/v1/notifications`                      | staff    | `notifications.read`             |
| POST   | `/api/v1/notifications/:id/retry`            | staff    | `notifications.retry`            |
| GET    | `/api/v1/parts`                              | staff    | `inventory.read`                 |
| POST   | `/api/v1/parts`                              | staff    | `inventory.write`                |
| PATCH  | `/api/v1/parts/:id`                          | staff    | `inventory.write`                |
| GET    | `/api/v1/payments`                           | staff    | `payments.read`                  |
| POST   | `/api/v1/payments`                           | staff    | `payments.record`                |
| GET    | `/api/v1/payments/:id`                       | staff    | `payments.read`                  |
| POST   | `/api/v1/payments/:id/receipt`               | staff    | `payments.read`                  |
| POST   | `/api/v1/payments/:id/refunds`               | staff    | `payments.refund`                |
| POST   | `/api/v1/payments/:id/reversal`              | staff    | `payments.refund`                |
| GET    | `/api/v1/permissions`                        | staff    | `roles.read`                     |
| POST   | `/api/v1/public/estimate-links/decision`     | public   | —                                |
| POST   | `/api/v1/public/estimate-links/view`         | public   | —                                |
| GET    | `/api/v1/reports/:report/export`             | staff    | `reports.export`, `reports.read` |
| GET    | `/api/v1/reports/collections`                | staff    | `payments.read`, `reports.read`  |
| GET    | `/api/v1/reports/dashboard`                  | staff    | `reports.read`                   |
| GET    | `/api/v1/reports/jobs`                       | staff    | `jobs.read`, `reports.read`      |
| GET    | `/api/v1/reports/outstanding`                | staff    | `payments.read`, `reports.read`  |
| GET    | `/api/v1/reports/parts`                      | staff    | `inventory.read`, `reports.read` |
| GET    | `/api/v1/reports/technicians`                | staff    | `jobs.read`, `reports.read`      |
| GET    | `/api/v1/roles`                              | staff    | `roles.read`                     |
| POST   | `/api/v1/roles`                              | staff    | `roles.manage`                   |
| PATCH  | `/api/v1/roles/:id`                          | staff    | `roles.manage`                   |
| GET    | `/api/v1/settings`                           | staff    | `settings.read`                  |
| PUT    | `/api/v1/settings/:key`                      | staff    | `settings.manage`                |
| GET    | `/api/v1/suppliers`                          | staff    | `inventory.read`                 |
| POST   | `/api/v1/suppliers`                          | staff    | `inventory.write`                |
| GET    | `/api/v1/users`                              | staff    | `users.read`                     |
| POST   | `/api/v1/users`                              | staff    | `users.manage`                   |
| GET    | `/api/v1/users/:id`                          | staff    | `users.read`                     |
| PATCH  | `/api/v1/users/:id`                          | staff    | `users.manage`                   |
| POST   | `/api/v1/users/:id/mfa/reset`                | staff    | `users.manage`                   |
| POST   | `/api/v1/users/:id/password-setup`           | staff    | `users.manage`                   |
| GET    | `/api/v1/webhooks/whatsapp`                  | public   | —                                |
| POST   | `/api/v1/webhooks/whatsapp`                  | public   | —                                |
