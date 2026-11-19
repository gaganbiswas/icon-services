# Notification templates (ADR 0018)

WhatsApp business-initiated messages must use templates **approved by Meta**. The system never sends free-form
WhatsApp text. For each event, register a template (category *Utility*) whose body uses the parameters below in
exactly this order, then enter its approved name and language in **Admin → Notification templates**. Events without
an approved template are recorded as `SKIPPED_NOT_CONFIGURED`.

Wording below is a **suggestion only**; the owner must approve final wording and Meta must approve the template.

| Event | Body parameters | Suggested body |
|-------|-----------------|----------------|
| JOB_RECEIVED | {{1}} job number, {{2}} status | We have received your service request {{1}}. Current status: {{2}}. |
| JOB_STATUS_CHANGED | {{1}} job number, {{2}} status | Your service request {{1}} is now: {{2}}. |
| JOB_UPDATE_POSTED | {{1}} job number, {{2}} message | Update on {{1}}: {{2}} |
| REPAIR_COMPLETED | {{1}} job number | The repair for {{1}} is complete. |
| READY_FOR_DELIVERY | {{1}} job number | Your device for {{1}} is ready for collection/delivery. |
| ESTIMATE_READY | {{1}} job number | An estimate for {{1}} is ready for your approval in the app or portal. |
| ESTIMATE_DECISION_RECORDED | {{1}} job number, {{2}} decision | We have recorded your decision ({{2}}) for {{1}}. |
| PAYMENT_RECEIVED | {{1}} job number, {{2}} receipt number, {{3}} amount, {{4}} currency | Payment received for {{1}}: receipt {{2}}, {{3}} {{4}}. |
| DELIVERY_CONFIRMED | {{1}} job number | Your device for {{1}} has been handed over. Thank you. |

Parameters contain only customer-safe values (never internal notes). Missing values are sent as "-".

## Sign-in codes

Register an **Authentication** template with a copy-code button; set `OTP_PROVIDER=whatsapp`,
`WHATSAPP_OTP_TEMPLATE_NAME` and `WHATSAPP_OTP_TEMPLATE_LANGUAGE`.

## Email

Email uses the subject configured per event and a short plain-text body built from the same customer-safe values.
Clear the subject to stop email for an event. SMTP gives no delivery confirmation, so email stays "accepted".

## Opt-out

Customers can reply **STOP** (or UNSUBSCRIBE / OPT OUT) on WhatsApp; their WhatsApp consents are withdrawn and the
change is audited. Mention this in the opt-in wording (owner question).

## Go-live checklist (owner)

1. Meta Business verification, WhatsApp Business Account and phone number; permanent system-user access token.
2. Templates approved; names entered in the admin panel.
3. Webhook URL `https://<api-host>/api/v1/webhooks/whatsapp`, verify token and app secret configured; subscribe to
   the `messages` field.
4. Sender domain verified with the SMTP provider; SPF, DKIM and DMARC published.
5. Test with Meta's test number and a test mailbox before live sending.
