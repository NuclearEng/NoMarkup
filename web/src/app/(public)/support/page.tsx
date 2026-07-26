// ASR-1.5.a, ASR-5.1.1.i — Support / contact (App Store P0 legal).

import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalDocument } from '@/components/compliance/LegalDocument';
import { SupportContactForm } from '@/components/compliance/SupportContactForm';

export const metadata: Metadata = {
  title: 'Support | NoMarkup',
  description:
    'Contact NoMarkup support, report abuse, and find links to Privacy, Terms, and Community Guidelines.',
  openGraph: {
    title: 'Support | NoMarkup',
    description: 'Get help with your NoMarkup account, report abuse, or ask a question.',
  },
};

const LAST_UPDATED = 'July 26, 2026';

export default function SupportPage() {
  return (
    <LegalDocument
      title="Support"
      lastUpdated={LAST_UPDATED}
      showToc={false}
      footerNote={
        <>
          This page is a product-compliance baseline for App Store support and contact
          requirements. It is not legal advice. For legal marketplace services (hire an attorney
          via reverse auction), see <Link href="/legal">Legal Services</Link> — that is a product
          surface, not these policies.
        </>
      }
      sections={[
        {
          id: 'contact',
          title: 'Contact us',
          content: (
            <>
              <p>
                Email us anytime at{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a>. We aim to
                respond as quickly as we can during business hours (Pacific Time).
              </p>
              <div className="not-prose pt-2">
                <SupportContactForm />
              </div>
            </>
          ),
        },
        {
          id: 'policies',
          title: 'Policies',
          content: (
            <>
              <ul>
                <li>
                  <Link href="/privacy">Privacy Policy</Link> — data we collect, third parties,
                  export/delete rights.
                </li>
                <li>
                  <Link href="/terms">Terms of Service</Link> — marketplace rules and account
                  terms.
                </li>
                <li>
                  <Link href="/community-guidelines">Community Guidelines</Link> — UGC standards,
                  prohibited content, and enforcement.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'report-abuse',
          title: 'Report abuse',
          content: (
            <>
              <p>
                To report prohibited content, scams, harassment, or unsafe listings:
              </p>
              <ul>
                <li>Use the in-app Report control on the listing, message, or profile when available.</li>
                <li>
                  Or email{' '}
                  <a href="mailto:support@no-markup.com?subject=Report%20abuse">
                    support@no-markup.com
                  </a>{' '}
                  with the subject &ldquo;Report abuse,&rdquo; including URLs, user display names,
                  screenshots, and a short description.
                </li>
                <li>
                  For emergencies or imminent harm, contact local emergency services first, then
                  notify us.
                </li>
              </ul>
              <p>
                Full standards: <Link href="/community-guidelines">Community Guidelines</Link>.
              </p>
            </>
          ),
        },
        {
          id: 'account-privacy',
          title: 'Account and privacy requests',
          content: (
            <>
              <p>
                Signed-in users can export data or schedule account deletion (30-day grace period)
                under <Link href="/settings/account">Settings → Account</Link>. You can also email{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a> for privacy
                requests described in our <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
