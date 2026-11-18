# Decision Log — ICON INFOSYS SERVICE MANAGEMENT

Architecture/Product Decision Records (ADRs). Each decision has a status:

- **Approved** — confirmed by the project owner; may be implemented.
- **Proposed** — recommended by Claude Code; awaiting owner approval. Do not implement.
- **Open** — information required from the owner/accountant; nothing may be assumed.
- **Superseded** — replaced by a later record (never delete records).

| ID   | Title                                              | Status    | Date       |
|------|----------------------------------------------------|-----------|------------|
| 0001 | Package manager and script runner: Bun             | Approved  | 2026-11-18 |
| 0002 | Database: PostgreSQL                               | Approved  | 2026-11-18 |
| 0003 | Separate folders for web and mobile applications   | Approved  | 2026-11-18 |
| 0004 | Application stack and modular monolith             | Approved  | 2026-11-18 |
| 0005 | Money storage strategy                             | Approved  | 2026-11-18 |
| 0006 | JavaScript runtime for API in production           | Approved  | 2026-11-18 |
| 0007 | Business, tax, provider and hosting decisions      | Open      | 2026-11-18 |
| 0008 | Admin panel React+TanStack Router; Next.js portal  | Approved  | 2026-11-18 |
| 0009 | Local S3 storage: SeaweedFS (replaces MinIO)       | Approved  | 2026-11-18 |
| 0010 | Staff authentication, sessions and RBAC            | Approved  | 2026-11-18 |
| 0011 | MFA plan (TOTP for privileged roles)               | Approved (plan) | 2026-11-18 |
| 0012 | Phase 3 intake, numbering, documents, customer sign-in | Approved (with placeholders) | 2026-11-18 |

New decisions: copy `template.md`, use the next number, add a row above.
