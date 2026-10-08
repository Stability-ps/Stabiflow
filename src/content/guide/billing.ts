import { EVERYONE, GUIDE_UPDATED } from "./common";
import type { GuideChapter } from "./types";

export const billing: GuideChapter = {
  slug: "billing",
  number: 17,
  title: "Billing & plans",
  description: "See your current plan, compare plans, pay securely with Paystack and understand what changes after you pay.",
  part: "Account",
  availability: EVERYONE,
  appPath: "/app/billing",
  updated: GUIDE_UPDATED,
  related: ["welcome", "settings", "troubleshooting"],
  keywords: ["plan", "subscription", "upgrade", "downgrade", "cancel", "payment", "paystack", "invoice", "monthly", "annual", "professional profile", "free", "business", "growth", "payment history"],
  sections: [
    {
      id: "current",
      title: "Your current plan",
      blocks: [
        { type: "p", text: "The top of Billing & plans shows Your access: the plan you're on, its price and renewal date for subscriptions, or \"Paid once · permanent\" for a once-off purchase. The sidebar footer on desktop also shows your workspace's plan." },
        { type: "screenshot", shot: { src: "billing.webp", alt: "Billing & plans page with current access and available plans" } },
      ],
    },
    {
      id: "plans",
      title: "Plans and allowances",
      blocks: [
        { type: "p", text: "Each plan card lists what it includes. Toggle between monthly and annual billing to compare prices (annual plans show the saving)." },
        { type: "table", head: ["Plan", "Type", "Highlights"], rows: [
          ["Free", "Free", "My Business and a protected Business Studio preview."],
          ["Professional Profile", "Once-off", "Clean company profile PDF and premium designs. No recurring AI or website-scan allowance."],
          ["Business", "Subscription", "Leads & CRM, Customers, Content, hosted business profile and more AI credits."],
          ["Growth", "Subscription", "Everything in Business plus WhatsApp inbox, Meta advertising, Facebook & Instagram integrations, automation & AI, advanced analytics, higher limits and more team members."],
        ] },
        { type: "callout", tone: "tip", text: "Prices and exact allowances are always shown live on the page - they may change, so this guide doesn't repeat them." },
      ],
    },
    {
      id: "upgrading",
      title: "Upgrading and paying",
      keywords: ["checkout", "paystack", "card", "payment"],
      blocks: [
        { type: "steps", steps: [
          { title: "Choose a plan", detail: "Choose Upgrade to (plan) or Buy profile. Switch to annual / monthly changes the billing interval of your current plan." },
          { title: "Pay with Paystack", detail: "You're taken to Paystack's secure payment page. StabiFlow never sees or stores your card details." },
          { title: "Return to StabiFlow", detail: "After paying you come back to Billing & plans, which confirms the result." },
        ] },
        { type: "table", head: ["Message after paying", "Meaning"], rows: [
          ["Payment confirmed - thank you!", "Your plan is active."],
          ["Your payment is still being confirmed", "Paystack hasn't confirmed yet. The page updates once it clears."],
          ["The payment did not go through", "You have not been charged. Try again."],
          ["We received your payment but need to check it", "Our team will check it and be in touch."],
        ] },
        { type: "callout", tone: "important", text: "Only the workspace owner can buy or change plans. Other members see the plans but the buttons are disabled." },
      ],
    },
    {
      id: "after-upgrade",
      title: "What happens after you upgrade",
      blocks: [
        { type: "list", items: [
          "The modules in your new plan appear in the menu - refresh the page if they don't show straight away.",
          "Allowances (AI credits, automation runs, team seats) increase to the new plan's levels.",
          "Your existing data stays exactly as it was.",
        ] },
      ],
    },
    {
      id: "subscription",
      title: "Renewals, cancelling and failed payments",
      keywords: ["cancel", "past due", "renewal", "downgrade"],
      blocks: [
        { type: "list", items: [
          "Subscriptions renew automatically through Paystack.",
          "If a renewal fails, the page says so and Paystack retries the payment.",
          "Cancel subscription stops future charges. You keep access until the end of the period you've paid for.",
          "When paid access ends, modules outside your plan are hidden from the menu. Your data isn't deleted and comes back if you subscribe again.",
        ] },
      ],
    },
    {
      id: "history",
      title: "Payment history and previous purchases",
      blocks: [{ type: "p", text: "Payment history lists your recent StabiFlow payments with date, amount and status. Previous purchases (once-off products) are listed in a collapsible section." }],
    },
    {
      id: "troubleshooting",
      title: "My payment succeeded but my plan didn't change",
      blocks: [
        { type: "troubleshoot", items: [
          {
            symptom: "Paid, but still on the old plan",
            causes: ["Paystack is still confirming the payment.", "The payment needs a manual check.", "The page needs refreshing."],
            check: ["Look for a confirmation message on Billing & plans.", "Check Payment history for the payment's status."],
            fix: ["Wait a few minutes and refresh the page."],
            contactSupport: "If the payment shows as successful at your bank but StabiFlow still shows the old plan after an hour, contact support with the date, amount and the email you used to pay. Never send card details.",
          },
        ] },
      ],
    },
  ],
};
