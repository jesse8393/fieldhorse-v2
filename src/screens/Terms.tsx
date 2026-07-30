// src/screens/Terms.tsx — public terms of service.
// Reachable logged-out at /terms. Linked from the mobile app's Settings.
import LegalLayout, { H2, P, UL } from './LegalLayout.tsx'

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="May 21, 2026">
      <P>
        These terms govern your use of FieldHorse (the "Service"). By creating
        an account or using the app, you agree to them. Questions:
        <a href="mailto:support@fieldhorse.io" style={{ color: '#C9963A' }}> support@fieldhorse.io</a>.
      </P>

      <H2>Your account</H2>
      <UL items={[
        'You must provide accurate information and keep your login credentials secure.',
        'You are responsible for all activity under your account.',
        'You must be at least 18 years old and use the Service for legitimate business purposes.'
      ]} />

      <H2>Your content</H2>
      <P>
        You retain ownership of the data you put into the Service — your jobs,
        clients, documents, and photos. You grant us the limited right to store
        and process that data solely to operate the Service for you. You are
        responsible for having the right to store any customer information you
        enter.
      </P>

      <H2>Acceptable use</H2>
      <UL items={[
        'Do not use the Service for unlawful purposes or to violate others’ rights.',
        'Do not attempt to disrupt, reverse engineer, or gain unauthorized access to the Service.',
        'Do not upload content that is illegal, infringing, or that you lack permission to share.'
      ]} />

      <H2>AI features</H2>
      <P>
        AI‑generated estimates, messages, and document scans are provided to
        assist you and may be inaccurate or incomplete. You are responsible for
        reviewing and verifying any AI output before relying on it or sending it
        to a customer. AI output does not constitute professional, legal, or
        financial advice.
      </P>

      <H2>Disclaimers &amp; liability</H2>
      <P>
        The Service is provided "as is" without warranties of any kind. To the
        fullest extent permitted by law, FieldHorse is not liable for any
        indirect, incidental, or consequential damages, or for lost profits or
        data, arising from your use of the Service. Our total liability is
        limited to the amount you paid us in the prior 12 months.
      </P>

      <H2>Termination</H2>
      <P>
        You may stop using the Service and delete your account at any time from
        Settings. We may suspend or terminate accounts that violate these terms.
      </P>

      <H2>Changes</H2>
      <P>
        We may update these terms; continued use after changes constitutes
        acceptance. Material changes will be reflected by the "Last updated"
        date above.
      </P>
    </LegalLayout>
  )
}
