import { LegalLayout } from "@/pages/legal/LegalLayout";

export default function DataDeletion() {
  return (
    <LegalLayout title="Data Deletion" effectiveDate="2026-08-28">
      <section>
        <p>
          This page explains how to have data deleted from StabiFlow, both for a workspace owner and for
          someone who is not a workspace owner - for example, a customer who has messaged a business over
          WhatsApp and wants their conversation data removed.
        </p>
      </section>

      <section>
        <h2>If you are a workspace owner</h2>
        <p>
          You can permanently delete your entire workspace, including its WhatsApp messages, leads, campaigns,
          and connected-integration credentials, at any time from <strong>Settings &gt; Delete Workspace</strong>{" "}
          inside the app. You will be asked to confirm before deletion, and you can export your workspace&apos;s
          data first if you want to keep a copy. Deletion is permanent and cannot be undone.
        </p>
      </section>

      <section>
        <h2>If you are not a workspace owner (for example, a WhatsApp customer)</h2>
        <p>
          If a business is using StabiFlow to communicate with you over WhatsApp, your conversation data is
          stored by that business&apos;s workspace, not by you directly. To request that your data be deleted:
        </p>
        <ul>
          <li>Ask the business you have been messaging directly - they can delete the conversation as part of managing their workspace, or delete their workspace entirely.</li>
          <li>
            Alternatively, contact StabiFlow directly with the phone number or WhatsApp Business account you
            messaged and a description of your request, and we will work with the relevant workspace to action
            it. We do not have an automated self-service deletion flow for non-account-holders yet - requests
            are handled manually and we aim to respond promptly.
          </li>
        </ul>
      </section>

      <section>
        <h2>Meta / Facebook data deletion</h2>
        <p>
          StabiFlow connects to Meta&apos;s platforms (Facebook, Instagram, WhatsApp) only at the level of a
          workspace&apos;s own business accounts (its Page, Ad Account, or WhatsApp Business Account) - not as
          a consumer-facing "Login with Facebook" product that processes individual Facebook users&apos;
          personal accounts. Because of this, this instructions page is StabiFlow&apos;s answer to Meta&apos;s
          Data Deletion Request requirement, rather than an automated callback endpoint: deleting a workspace
          (above) already removes that workspace&apos;s Meta connection and any data associated with it, and
          the manual request path above covers a Meta/WhatsApp user who wants their data removed but is not a
          workspace owner. A dedicated signed-request callback endpoint may be added later if Meta&apos;s App
          Review process explicitly requires it for StabiFlow&apos;s app configuration.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>For a data deletion request, contact the business whose WhatsApp number you messaged, or StabiFlow&apos;s support contact.</p>
      </section>
    </LegalLayout>
  );
}
