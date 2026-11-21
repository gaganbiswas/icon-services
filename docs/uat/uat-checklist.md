# UAT checklist — release one

> Record **Pass / Fail / N/A**, the tester's initials and a defect reference for every failure. "Blocked" items
> depend on decisions or providers that are not available yet. Phase 11 exit requires this checklist signed by the
> owner (bottom).

## A. Reception (`reception@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| A1 | Search a customer by name, mobile number and customer code | The right customer is found by each | | | |
| A2 | Register a new individual customer with WhatsApp + email consent | Customer code issued; consents shown | | | |
| A3 | New job: new device with serial number, complaint, accessories, photo | Review screen lists everything; job number issued | | | |
| A4 | Click **Register job** twice quickly / retry after a network error | Only one job is created | | | |
| A5 | Print the job receipt (A4 and 80 mm) | PDF shows business placeholder, job number, customer, device, complaint, accessories, terms | | | |
| A6 | Try to change a job's status | Not offered / refused (reception has no permission) | | | |
| A7 | Open a North-branch job by its link while signed in as Central reception | "Not found" | | | |

## B. Technician (`tech1@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| B1 | **My jobs** shows only assigned jobs | Jobs 3, 4, 6 and 8 (assigned to Tarun) appear; others do not | | | |
| B2 | Record a diagnosis with an internal note | Saved; internal note marked staff-only | | | |
| B3 | Prepare an estimate with a part and labour line | Totals shown; "taxes to be confirmed" note | | | |
| B4 | Try to start repair before the customer approves | Refused: approval required | | | |
| B5 | Add a work log visible to the customer | Appears in the customer timeline (portal/app) | | | |
| B6 | Reserve and use a part on job 4 | Stock goes down; movement recorded | | | |
| B7 | Complete repair without ticking all QC items | Refused | | | |
| B8 | Complete repair with summary + all QC items | Status Repair completed | | | |

## C. Manager (`manager@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| C1 | Assign / reassign a technician | History shows both | | | |
| C2 | Send an estimate; copy the approval link | Link shown once; customer can approve or reject in the portal | | | |
| C3 | Put a job on hold without a reason | Refused; with a reason it works | | | |
| C4 | Deliver job 6 (balance due) | Requires a reason; recorded as "delivered with balance due" | | | |
| C5 | Dashboard numbers | Match the sample data (12 new jobs, 2,200 outstanding …) | | | |

## D. Accounts (`accounts@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| D1 | Record a partial UPI payment on job 6 without a reference | Refused (UPI needs a transaction reference) | | | |
| D2 | Record the remaining balance | Balance becomes 0; receipt prints | | | |
| D3 | Refund part of a payment with a reason | Refund receipt; collections net of refund | | | |
| D4 | Collections report for today, export CSV, Excel and PDF | Files download; totals match the screen | | | |
| D5 | Outstanding report | Only finished jobs with dues; aging bucket correct | | | |

## E. Delivery (`delivery@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| E1 | Hand over job 7 to the customer, without ticking the charger | Refused: every item must be returned | | | |
| E2 | Hand over to a family member without an authorization note | Refused | | | |
| E3 | Complete hand-over correctly; print the challan | Job Delivered; challan says "not an invoice" | | | |
| E4 | Try to hand over job 6 (balance due) | Refused for delivery staff | | | |
| E5 | Home delivery: dispatch, record failed attempt, dispatch again, hand over | New challan number each dispatch; history correct | | | |

## F. Super Admin / security (`superadmin@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| F1 | With `MFA_ENFORCEMENT=required`: sign in | Sent to two-step set-up; nothing else available | | | |
| F2 | Set up two-step sign-in with an authenticator app; save recovery codes | Codes shown once; next sign-in asks for a code | | | |
| F3 | Use a recovery code; try it again | Works once only | | | |
| F4 | Five wrong codes | Account locked for the lockout period | | | |
| F5 | Reset another user's two-step sign-in with a reason | User signed out; must set up again; audit entry | | | |
| F6 | Notification templates page: enter a template name | Saved with reason; audit entry | | | |
| F7 | Audit log shows the actions of this UAT session | Entries with actor, time, reason | | | |

## G. Auditor (`auditor@`)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| G1 | Open jobs, payments, reports | Read-only; no create/change buttons | | | |
| G2 | Try to record a payment through the API | 403 Forbidden | | | |

## H. Customer (portal / Android app)

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| H1 | Sign in with the phone number of a sample customer | **Blocked** until the WhatsApp authentication template is approved (development mock only) | | | |
| H2 | View own jobs; internal notes never visible | Only customer-safe text | | | |
| H3 | Approve / reject an estimate from the link | Decision recorded with time | | | |
| H4 | Download receipt / challan | Own documents only | | | |

## I. Cross-cutting

| # | Step | Expected result | Result | Tester | Defect |
|---|------|-----------------|--------|--------|--------|
| I1 | Keyboard only: sign in, open a job, change status | All controls reachable and visible focus | | | |
| I2 | Mobile browser width (360 px): job list and job detail | No horizontal scrolling; readable | | | |
| I3 | Statuses are understandable without colour | Text labels everywhere | | | |
| I4 | Colour contrast of text and buttons (browser tool) | WCAG AA (4.5:1 text) | | | |
| I5 | Accounts: prepare, issue, print a GST invoice; record payment; partial credit note; GST summary | Correct CGST/SGST (West Bengal) or IGST (other states); numbers MT/2627/1, MT/2627/2 …; a Bill of Supply (reason required) is numbered BS/2627/… with no GST; a warranty-only job gets a ₹0 invoice; issued invoice cannot be edited; balances and reports update | | | |
| I6 | Real WhatsApp / email delivery | **Blocked** — needs Meta approval and sender domain (Phase 10 go-live) | | | |

## Sign-off

| Role | Name | Decision (accept / accept with listed defects / reject) | Date | Signature |
|------|------|-----------------------------------------------------------|------|-----------|
| Owner | | | | |
| Reception lead | | | | |
| Technician lead | | | | |
| Accounts | | | | |
