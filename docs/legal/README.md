# Legal pages — internal notes (not shown in the product)

Three public pages exist in the app: `/legal/privacy`, `/legal/terms`, `/legal/data-deletion`
(`src/pages/legal/Privacy.tsx`, `Terms.tsx`, `DataDeletion.tsx`). They are linked from Signup
(required consent checkbox), the auth-page footer, and Settings > Account.

**These pages are written to be accurate about what StabiFlow's code actually does, and are
presentable to real users today — they do not carry a visible "draft" disclaimer in the product,
per instruction.** That does not mean they are legally final. Before broad public launch (paid
customers beyond Acapolite and the first invited pilots), the content should be reviewed by a
lawyer familiar with South African POPIA compliance, and by counsel in any other jurisdiction
StabiFlow later serves customers in.

## What was decided vs. what's still open

- **Jurisdiction**: South Africa / POPIA is the primary framework, per your instruction. The pages
  reference POPIA by name and note cross-border transfer to foreign subprocessors (OpenAI, Meta,
  Supabase, Vercel).
- **Data flows described**: grounded directly in the code as of Phase L-1/L-2 —
  - WhatsApp AI sends recent conversation content + extracted customer context (name, email,
    interest summary, urgency) to OpenAI. The customer's WhatsApp phone number is **not** sent.
  - Flow AI sends only aggregated business data (campaign/lead/pipeline/revenue) through its fixed
    read-tool set — never raw WhatsApp message content.
  - If either of those data flows changes in a future phase, these pages must be updated to match —
    they describe current behavior, not a promise independent of the code.
- **Retention**: the Privacy Policy deliberately does NOT state a specific retention period (e.g.
  "30 days" or "12 months") — none has been decided. It says business data is retained while a
  workspace is active, and is removed via the workspace-deletion flow. If you later approve a
  specific retention window for WhatsApp messages or AI conversation content, both this doc and
  the Privacy Policy need updating.
- **Data Deletion page**: documents an instructions-based path (workspace owner deletes via
  Settings, or a manual contact-based request for a non-owner like a WhatsApp customer) rather than
  an automated Meta signed_request callback. This matches the earlier Phase L-2 investigation
  finding: StabiFlow's Meta connection is workspace-level, not consumer Facebook Login, so a
  callback endpoint would have no Meta user id to look up. Revisit only if Meta's App Review
  process explicitly requires the callback form for this app's configuration.

## What needs your/legal review before broad public launch

1. Confirm POPIA is the correct sole framework, or whether other jurisdictions' laws (where
   customers/pilots are based) need explicit additional sections.
2. Confirm the "operator vs. responsible party" framing for WhatsApp customer data is correct for
   how StabiFlow's contracts with workspaces are actually structured (this assumes a standard
   processor relationship — no Data Processing Agreement template exists yet).
3. Confirm the Terms of Service's suspension/availability and limitation-of-liability language is
   acceptable — it's deliberately generic and short for V1.
4. Decide whether a real contact email/address should replace the current generic "workspace
   administrator or StabiFlow's support contact" phrasing.
5. Decide on retention periods (see above) — once decided, update `src/pages/legal/Privacy.tsx`.

## Where the actual consent capture lives

The Signup page (`src/pages/Signup.tsx`) has a required checkbox ("I agree to the Terms of Service
and Privacy Policy") that gates the submit button — signup cannot complete without it. This is
recorded implicitly by permitting signup to proceed; there is no separate consent-log table. If
that becomes a compliance requirement, it is a small follow-up (e.g. logging the acceptance
timestamp), not implemented in this phase.
