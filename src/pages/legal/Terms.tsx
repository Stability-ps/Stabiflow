import { LegalLayout } from "@/pages/legal/LegalLayout";
import { TERMS_OF_SERVICE_VERSION } from "@/lib/legalDocuments";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" effectiveDate={TERMS_OF_SERVICE_VERSION}>
      <section>
        <p>
          These Terms of Service govern access to and use of StabiFlow. StabiFlow is a SaaS platform provided
          and operated by Acapolite Consulting (Pty) Ltd, from South Africa, and these terms are governed by
          the laws of South Africa. By creating a StabiFlow account, you agree to these terms on behalf of
          yourself and, where applicable, the workspace you represent.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          StabiFlow is a multi-tenant platform that helps a business manage content, advertising campaigns,
          WhatsApp conversations, leads, and related reporting in one place. Each company operates in its own
          isolated workspace; workspace data is not accessible to other workspaces.
        </p>
      </section>

      <section>
        <h2>Your account and workspace</h2>
        <ul>
          <li>You are responsible for the accuracy of the information you provide and for keeping your login credentials secure.</li>
          <li>A workspace owner is responsible for the workspace&apos;s use of StabiFlow, including who they invite as members and what permissions those members are given.</li>
          <li>A workspace is responsible for having a lawful basis to communicate with its own customers via WhatsApp and other connected channels, and for complying with the terms of any third-party platform it connects (Meta, WhatsApp) through StabiFlow.</li>
        </ul>
      </section>

      <section>
        <h2>Connected third-party platforms</h2>
        <p>
          StabiFlow integrates with Meta (Facebook, Instagram, WhatsApp) and OpenAI. Use of these integrations
          is also subject to each provider&apos;s own terms. StabiFlow is not responsible for outages, policy
          changes, or account actions taken by these third-party providers.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You agree not to use StabiFlow to:</p>
        <ul>
          <li>Send unsolicited or non-consented WhatsApp messages, or otherwise violate WhatsApp&apos;s or Meta&apos;s policies.</li>
          <li>Access or attempt to access another workspace&apos;s data.</li>
          <li>Interfere with the security or normal operation of the service.</li>
          <li>Use the service for any unlawful purpose.</li>
        </ul>
      </section>

      <section>
        <h2>Data export and deletion</h2>
        <p>
          A workspace owner may export their workspace&apos;s data and permanently delete their workspace at any
          time from Settings. Deletion is permanent and cannot be undone. See our{" "}
          <a href="/legal/privacy" className="underline">Privacy Policy</a> and{" "}
          <a href="/legal/data-deletion" className="underline">Data Deletion page</a> for details.
        </p>
      </section>

      <section>
        <h2>Suspension and availability</h2>
        <p>
          We may suspend or limit a workspace&apos;s access to certain features (for example, during a trial
          period that has ended, or where required for billing or platform-integrity reasons), with a clear
          in-product notice of the reason. We aim to give reasonable notice before suspending an active,
          paying workspace outside of these situations.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <p>
          StabiFlow, including its AI-generated recommendations and replies, is provided on an "as is" basis.
          AI-generated content may be inaccurate and should be reviewed before relying on it for business
          decisions. To the maximum extent permitted by law, StabiFlow is not liable for indirect, incidental,
          or consequential damages arising from use of the service.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>We may update these terms from time to time. Material changes will be reflected by updating the effective date above.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about these terms can be directed to StabiFlow&apos;s support contact.</p>
      </section>
    </LegalLayout>
  );
}
