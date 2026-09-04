import { LegalLayout } from "@/pages/legal/LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" effectiveDate="2026-09-04">
      <section>
        <p>
          This Privacy Policy describes what personal information StabiFlow collects and processes when a
          company ("workspace") uses the product, and how that information is used. StabiFlow is a SaaS
          platform provided and operated by Acapolite Consulting (Pty) Ltd, from South Africa, and this policy
          is written with the Protection of Personal Information Act, 2013 ("POPIA") as its primary
          framework. Where StabiFlow serves workspaces or data subjects outside South Africa, additional local
          requirements may also apply.
        </p>
      </section>

      <section>
        <h2>Who this applies to</h2>
        <p>
          This policy covers workspace owners and members who use StabiFlow, and, indirectly, the customers a
          workspace communicates with via WhatsApp through StabiFlow. A workspace is responsible for having its
          own lawful basis to process its customers&apos; personal information (for example, its WhatsApp
          contacts). In relation to that customer data, StabiFlow acts as an operator (processor) on the
          workspace&apos;s behalf, not as the responsible party (controller) for it.
        </p>
      </section>

      <section>
        <h2>What personal information we collect</h2>
        <ul>
          <li>Account information: name, email address, and authentication credentials (managed by our infrastructure provider, Supabase - StabiFlow never stores raw passwords itself).</li>
          <li>Workspace information: company profile, team members and roles, and everything a workspace creates in the product (content, campaigns, leads, pipelines, opportunities, customers, automations) - which may include personal information such as names, phone numbers, and other details recorded on leads or CRM records.</li>
          <li>WhatsApp conversation data: when a workspace connects a WhatsApp Business number, inbound and outbound message content, sender phone numbers, and display names are stored so the Inbox can function. This data is stored as plain text in our database today.</li>
          <li>Meta integration data: when a workspace connects a Facebook Page, Instagram account, Ad Account, or WhatsApp Business Account, we store the connection and the business data needed to publish content, run campaigns, and sync performance (for example, Page IDs, ad account IDs, campaign and ad performance metrics). Provider access tokens are stored in an encrypted secrets vault and are never exposed to the browser.</li>
          <li>Usage and attribution data: which campaigns and content led to which conversations, leads, and revenue, so a workspace can see what is working.</li>
        </ul>
      </section>

      <section>
        <h2>How AI features use information</h2>
        <p>StabiFlow has several AI-assisted features, and each is given only the information it needs:</p>
        <ul>
          <li>
            <strong>WhatsApp AI (automated replies to customers):</strong> when enabled for a conversation, it
            may send recent conversation content and structured customer context (for example, name, email,
            interest summary, urgency) to OpenAI to generate a reply. The customer&apos;s WhatsApp phone number
            is not included in that request.
          </li>
          <li>
            <strong>Image and PDF understanding:</strong> when a workspace turns this on, a supported image or
            PDF a customer sends may be provided to OpenAI to help understand that customer&apos;s enquiry. Only
            the current attachment on an active conversation is sent, and only for workspaces that have enabled
            the feature.
          </li>
          <li>
            <strong>Voice-note transcription:</strong> when a workspace turns this on, a supported customer
            voice note&apos;s audio may be sent to OpenAI to produce a text transcript, which is then used the
            same way as a written message. The original audio is always kept; transcription is automatic and
            may contain errors.
          </li>
          <li>
            <strong>Customer-language matching:</strong> when a workspace turns this on, limited recent
            customer-language context and the already-generated reply may be sent to OpenAI so the reply&apos;s
            wording can better match the customer&apos;s language and tone. This adapts presentation only - it
            does not change the underlying facts, amounts, or actions in the reply - and language detection is
            not guaranteed to be accurate.
          </li>
          <li>
            <strong>Flow AI (a staff-facing assistant for reporting and recommendations):</strong> uses curated
            workspace and business data through a fixed set of read tools - aggregated campaign performance,
            lead and pipeline summaries, and revenue figures. Flow AI never has access to raw WhatsApp message
            content.
          </li>
          <li>
            <strong>Creative Studio (advertising copy and image generation):</strong> business, product, or
            creative brief information a workspace enters may be sent to OpenAI to generate advertising copy
            and concepts, and AI-generated visual prompts may be used to generate advertising images. Creative
            Studio does not have access to a workspace&apos;s WhatsApp conversations, and generated copy and
            images are not published automatically - a staff member chooses whether and how to use them.
          </li>
        </ul>
        <p>
          In every case, OpenAI acts as a subprocessor (operator) and processes this information solely to
          generate the requested AI output. AI-generated and AI-transcribed content may be inaccurate, and
          staff remain responsible for reviewing important outputs before relying on or acting on them.
        </p>
      </section>

      <section>
        <h2>Subprocessors and cross-border transfers</h2>
        <p>
          The following third parties process information on StabiFlow&apos;s behalf. All of them are based
          outside South Africa, so using StabiFlow involves the cross-border transfer of personal information -
          for example, WhatsApp conversation content or workspace data may be transmitted to and processed by
          servers located in other countries.
        </p>
        <ul>
          <li><strong>Supabase</strong> - database, authentication, file storage, and background functions (infrastructure).</li>
          <li><strong>Vercel</strong> - application hosting (infrastructure).</li>
          <li><strong>OpenAI</strong> - AI features (Flow AI and WhatsApp AI), as described above.</li>
          <li><strong>Meta (Facebook, Instagram, WhatsApp)</strong> - when a workspace connects its own Meta accounts, to publish content, run ads, and send and receive WhatsApp messages.</li>
        </ul>
      </section>

      <section>
        <h2>How long we keep information</h2>
        <p>
          Business data - including WhatsApp messages, leads, and CRM records - remains retained while a
          workspace is active, unless the workspace owner deletes it or another approved retention policy
          applies. When a workspace owner deletes their workspace (Settings &gt; Delete Workspace), the
          workspace&apos;s tenant-owned data is removed as part of that deletion, including WhatsApp messages,
          leads, and stored integration credentials. We are evaluating configurable retention windows for
          sensitive categories (such as WhatsApp messages and AI conversation content) as a future improvement;
          any such change will be reflected in this policy before it takes effect.
        </p>
      </section>

      <section>
        <h2>Exporting and deleting your data</h2>
        <p>
          A workspace owner can request an export of their workspace&apos;s data, and can permanently delete the
          workspace, from Settings. See our <a href="/legal/data-deletion" className="underline">Data Deletion
          page</a> for details, including how someone who is not a workspace owner (for example, a WhatsApp
          customer) can request that their information be deleted.
        </p>
      </section>

      <section>
        <h2>Your rights under POPIA</h2>
        <p>
          Subject to applicable law, you may have the right to access, correct, or request deletion of your
          personal information, and to object to certain processing. Requests can be made using the contact
          details below or, for workspace-level data, through the workspace owner.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about this policy, or requests relating to your personal information, can be directed to the workspace administrator or StabiFlow&apos;s support contact.</p>
      </section>
    </LegalLayout>
  );
}
