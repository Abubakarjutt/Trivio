import Link from "next/link";

export const metadata = { title: "Privacy Policy — Trivio" };

const LAST_UPDATED = "6 June 2026";
const CONTACT_EMAIL = "privacy@trivio-ai.com";
const APP_NAME = "Trivio";
const COMPANY = "Trivio";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Back to {APP_NAME}
        </Link>

        <h1 className="mt-8 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-slate-500 text-sm mt-1">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Who we are">
          <p>
            {COMPANY} operates {APP_NAME} (&quot;the Service&quot;), a double-entry bookkeeping and
            accounting application. This policy explains how we collect, use, and protect your personal
            data in accordance with the General Data Protection Regulation (GDPR) and applicable data
            protection laws.
          </p>
          <p>
            Data controller: {COMPANY}<br />
            Contact: <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>
          </p>
        </Section>

        <Section title="2. Data we collect">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Account data:</strong> name, email address, hashed password</li>
            <li><strong>Business data:</strong> organisation name, business type, currency, fiscal year settings</li>
            <li><strong>Financial records:</strong> invoices, bills, journal entries, chart of accounts, contacts</li>
            <li><strong>AI-extracted data:</strong> data extracted from uploaded receipts/invoices (requires your confirmation before saving)</li>
            <li><strong>Chat history:</strong> conversations with the AI accounting assistant</li>
            <li><strong>Audit logs:</strong> records of significant data operations</li>
          </ul>
          <p>We do <strong>not</strong> sell your data. We do not use your data for advertising.</p>
        </Section>

        <Section title="3. Legal basis for processing">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Contract performance:</strong> processing necessary to provide the Service</li>
            <li><strong>Consent:</strong> AI document extraction (you review and confirm before any data is saved)</li>
            <li><strong>Legitimate interest:</strong> security audit logging, fraud prevention</li>
            <li><strong>Legal obligation:</strong> retaining financial records where required by applicable law</li>
          </ul>
        </Section>

        <Section title="4. Third-party processors">
          <p>We share data with the following processors under Data Processing Agreements (DPAs):</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Anthropic (Claude API)</strong> — AI document extraction and assistant. Data is processed transiently; Anthropic does not train on your data under our API agreement.</li>
            <li><strong>AWS S3</strong> — storage for uploaded documents</li>
            <li><strong>Resend</strong> — transactional email delivery</li>
            <li><strong>Stripe / LemonSqueezy</strong> — payment processing</li>
          </ul>
        </Section>

        <Section title="5. Data retention">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Account data:</strong> retained while your account is active</li>
            <li><strong>Financial records:</strong> retained for 7 years (legal requirement in most jurisdictions)</li>
            <li><strong>AI chat history:</strong> retained for 12 months by default; purge earlier in Settings → Privacy</li>
            <li><strong>Uploaded documents:</strong> retained for 90 days after processing</li>
          </ul>
        </Section>

        <Section title="6. Your rights">
          <p>Under GDPR you have the right to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Access</strong> — request a copy of all data we hold</li>
            <li><strong>Portability</strong> — export your data as JSON (Settings → Privacy → Export my data)</li>
            <li><strong>Rectification</strong> — correct inaccurate personal data</li>
            <li><strong>Erasure</strong> — delete your account (Settings → Privacy → Delete account)</li>
            <li><strong>Restriction / Objection</strong> — contact us to limit or object to processing</li>
          </ul>
          <p>
            Use the self-service tools in Settings or email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
            We respond within 30 days.
          </p>
        </Section>

        <Section title="7. Security">
          <p>
            Data is protected with TLS encryption in transit, encrypted storage at rest, role-based
            access controls, and a full audit log of data operations. In the event of a breach we will
            notify affected users within 72 hours (GDPR Article 33).
          </p>
        </Section>

        <Section title="8. Cookies">
          <p>
            We use only essential cookies: an authentication session cookie and a CSRF token.
            No advertising or analytics cookies are used.
          </p>
        </Section>

        <Section title="9. Contact & complaints">
          <p>
            Email us at <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
            If unsatisfied, you may lodge a complaint with your national data protection authority
            (e.g. ICO in the UK, CNIL in France).
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
      <div className="mt-3 text-slate-600 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
