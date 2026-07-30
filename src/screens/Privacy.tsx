// src/screens/Privacy.tsx, public privacy policy.
// Reachable logged-out at /privacy. Linked from the mobile app's Settings
// and used as the App Store / Play Store privacy policy URL.
import LegalLayout, { H2, P, UL } from './LegalLayout.tsx'

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="May 21, 2026">
      <P>
        FieldHorse ("we", "us") provides a job and customer management tool for
        contractors. This policy explains what we collect, how we use it, and
        the choices you have. Questions: <a href="mailto:support@fieldhorse.io" style={{ color: '#C9963A' }}>support@fieldhorse.io</a>.
      </P>

      <H2>Information we collect</H2>
      <UL items={[
        'Account information, your name, email address, and password (passwords are stored hashed by our authentication provider).',
        'Business profile, company name, phone, email, website, address, license, insurance and warranty text, logo, trades, and brand color you enter.',
        'Customer & job data, the clients, jobs, leads, estimates, invoices, payments, schedule events, subcontractors, notes, and photos you create in the app.',
        'Photos, images you capture or upload to attach to a job, or to scan a lead/estimate with our AI feature.',
        'Location, if you grant permission, your device location is used once to pin your service area for the weather work window. We do not track your location in the background.',
        'Usage data, basic logs needed to operate and secure the service.'
      ]} />

      <H2>How we use it</H2>
      <UL items={[
        'To provide the app: store and display your jobs, clients, and documents across your devices.',
        'To power features you trigger, AI estimates, AI message drafting, and lead/estimate photo scanning send the relevant text or image to our AI provider to generate a result.',
        'To show local weather conditions for your pinned service area.',
        'To send transactional email you initiate (e.g. partner invites) and to secure your account.'
      ]} />

      <H2>Service providers</H2>
      <P>We share data only with vendors that help us run the app, under their own security and privacy terms:</P>
      <UL items={[
        'Supabase, database, authentication, and file storage hosting.',
        'Anthropic (Claude), processes the text/images you submit to AI features to return a result; not used to train their models on your data.',
        'Open‑Meteo, receives only coordinates to return a weather forecast.',
        'Resend, sends transactional emails you initiate.'
      ]} />
      <P>We do not sell your personal information or your customers' information.</P>

      <H2>Data retention &amp; deletion</H2>
      <P>
        We keep your data while your account is active. You can permanently
        delete your account and all associated data at any time from
        <strong> Settings → Delete account</strong> in the mobile app. This
        removes your account and erases your jobs, clients, payments, notes,
        and other records from our systems. You may also email
        <a href="mailto:support@fieldhorse.io" style={{ color: '#C9963A' }}> support@fieldhorse.io</a> to request deletion.
      </P>

      <H2>Security</H2>
      <P>
        Data is encrypted in transit. Access to your records is restricted to
        your account via row‑level security. No method of transmission or
        storage is 100% secure, but we work to protect your information.
      </P>

      <H2>Children</H2>
      <P>FieldHorse is a business tool and is not directed to children under 13.</P>

      <H2>Changes</H2>
      <P>
        We may update this policy; material changes will be reflected by the
        "Last updated" date above.
      </P>
    </LegalLayout>
  )
}
