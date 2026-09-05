// ASR-5.1.1.i, ASR-1.5.a, ASR-1.2.d — Privacy Policy (App Store P0 legal).

import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalDocument } from '@/components/compliance/LegalDocument';

export const metadata: Metadata = {
  title: 'Privacy Policy | NoMarkup',
  description:
    'How NoMarkup collects, uses, shares, and retains personal data for the services and goods marketplaces at no-markup.com.',
  openGraph: {
    title: 'Privacy Policy | NoMarkup',
    description:
      'Learn what data NoMarkup collects, how we use it, and your rights to export or delete your account.',
  },
};

const LAST_UPDATED = 'August 21, 2026';

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      footerNote={
        <>
          This document is a product-compliance baseline for App Store and platform requirements.
          It is not legal advice. See also our <Link href="/terms">Terms of Service</Link> and{' '}
          <Link href="/community-guidelines">Community Guidelines</Link>. Contact{' '}
          <a href="mailto:support@no-markup.com">support@no-markup.com</a>.
        </>
      }
      sections={[
        {
          id: 'intro',
          title: '1. Introduction',
          content: (
            <>
              <p>
                This Privacy Policy explains how NoMarkup (&ldquo;we,&rdquo; &ldquo;us&rdquo;)
                collects, uses, discloses, and protects personal information when you use the
                websites, apps, and related services at <strong>no-markup.com</strong> (the
                &ldquo;Service&rdquo;).
              </p>
              <p>
                By using the Service you acknowledge this Policy. Where consent is required (for
                example, non-essential cookies or analytics), we ask before enabling those
                categories.
              </p>
            </>
          ),
        },
        {
          id: 'data-collected',
          title: '2. Information we collect',
          content: (
            <>
              <p>Depending on how you use NoMarkup, we may collect:</p>
              <ul>
                <li>
                  <strong>Account data</strong> — email, password hash, display name, phone,
                  profile photo, roles (customer, provider, seller), OAuth identifiers if you sign
                  in with Google, Apple, or Facebook, multi-factor authentication secrets, and age
                  verification (date of birth) when required.
                </li>
                <li>
                  <strong>Jobs and services activity</strong> — job posts, categories, budgets,
                  service addresses and locations, bids, contracts, milestones, reviews, and
                  related documents or photos.
                </li>
                <li>
                  <strong>Listings and goods activity</strong> — listing titles, descriptions,
                  conditions, photos, prices/bids/offers, pickup locations, watchlists, and
                  order/fulfillment status.
                </li>
                <li>
                  <strong>Chat and messaging</strong> — messages, offers sent in chat, blocks,
                  and reports you submit about other users or content.
                </li>
                <li>
                  <strong>Location</strong> — approximate or precise location for search, matching,
                  maps, local pickup radius, and safety/fraud signals. Public map views may use
                  coarsened coordinates; exact points needed for fulfillment may be encrypted at
                  rest and shared only as required between transaction parties.
                </li>
                <li>
                  <strong>Photos and media</strong> — images you upload for jobs, listings,
                  completion proof, or profile, processed for display and (where enabled) quality
                  or safety analysis.
                </li>
                <li>
                  <strong>Payments</strong> — payment method metadata, Stripe customer and Connect
                  account identifiers, transaction amounts, escrow/payout status, invoices, tax
                  forms where applicable. Card numbers are handled by Stripe; we do not store full
                  PAN data.
                </li>
                <li>
                  <strong>Device and usage</strong> — IP address (often hashed for logs), device
                  tokens for push, browser type, pages viewed, crash diagnostics, and similar
                  telemetry.
                </li>
                <li>
                  <strong>Cookies and similar technologies</strong> — session and security cookies
                  (necessary), plus analytics/marketing cookies only with your consent where our
                  consent banner applies.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'how-we-use',
          title: '3. How we use information',
          content: (
            <>
              <p>We use personal information to:</p>
              <ul>
                <li>Provide, secure, and improve the marketplace (matching, bidding, messaging, orders).</li>
                <li>Process payments, escrow, refunds, payouts, and prevent fraud/abuse.</li>
                <li>Verify eligibility (including 18+ age gates), licenses, and trust signals.</li>
                <li>Send transactional notices (bids, contracts, security alerts). Marketing is opt-in or subject to applicable law and your preferences.</li>
                <li>Comply with legal obligations, enforce Terms, and handle disputes or reports.</li>
                <li>Measure product performance with privacy-respecting analytics when you opt in.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'third-parties',
          title: '4. Third parties we share with',
          content: (
            <>
              <p>We share data with service providers and partners only as needed to operate the Service:</p>
              <ul>
                <li>
                  <strong>Stripe</strong> — payment processing, Connect onboarding, Apple Pay /
                  wallet payments, payouts, and fraud tools. Payment data is shared with Stripe for
                  fulfillment of payment instructions only (and related compliance).
                </li>
                <li>
                  <strong>Mapbox</strong> — map tiles, geocoding, and location display.
                </li>
                <li>
                  <strong>Sentry</strong> — error and performance monitoring (subject to product
                  configuration and consent where applicable).
                </li>
                <li>
                  <strong>Analytics</strong> — optional, consent-based usage analytics.
                </li>
                <li>
                  <strong>OAuth providers</strong> — Google, Apple, and/or Facebook when you choose
                  social sign-in; we receive limited profile/email identifiers they supply.
                </li>
                <li>
                  <strong>Infrastructure</strong> — cloud hosting, object storage for media, email
                  delivery, search indexing, and similar processors under contract.
                </li>
                <li>
                  <strong>Other users</strong> — information necessary for a transaction (for
                  example, display name, public profile, job/listing details, and fulfillment
                  contact/address after a match or sale).
                </li>
                <li>
                  <strong>Legal and safety</strong> — when required by law, valid legal process, or
                  to protect rights, safety, and security.
                </li>
              </ul>
              <p>
                Third parties that process personal data on our behalf (including payment
                processors, hosting, and error-monitoring providers) are required to provide the
                same or equal protection of that data as described in this Policy and as required
                by applicable law and the Apple App Store Review Guidelines.
              </p>
              <p>
                We do not sell personal information for money. We do not share payment card data
                with other users. Apple Pay / Stripe payment credentials are used only to complete
                payment and related fulfillment/compliance with the payment processor.
              </p>
            </>
          ),
        },
        {
          id: 'retention-deletion',
          title: '5. Retention, export, and deletion',
          content: (
            <>
              <p>
                You can export a copy of much of your personal data from{' '}
                <Link href="/settings/account">Settings → Account</Link> (JSON export covering
                profile, jobs/listings activity, contracts/orders, payments metadata, messages you
                sent, and related records, subject to technical limits).
              </p>
              <p>
                You may request account deletion from the same settings page. Deletion is scheduled
                with a <strong>30-day grace period</strong> during which you can cancel. After the
                deadline, we erase or anonymize personal data as described in-product (profile,
                properties, photos, payment methods, etc.), while retaining limited records where
                required for tax, legal, dispute, fraud prevention, or security (for example, ledger
                entries and tax forms).
              </p>
              <p>
                Backup systems and logs may retain residual copies for a limited period consistent
                with our operational cycles, then expire.
              </p>
            </>
          ),
        },
        {
          id: 'children',
          title: '6. Children',
          content: (
            <>
              <p>
                The Service is for users <strong>18 years of age and older</strong>. We do not
                knowingly collect personal information from children under 18. If you believe a
                minor has created an account, contact{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a> and we will take
                appropriate steps to remove the account.
              </p>
            </>
          ),
        },
        {
          id: 'cookies',
          title: '7. Cookies and similar technologies',
          content: (
            <>
              <p>
                We use cookies and similar storage for authentication, security, preferences, and
                (with consent) analytics and marketing. Necessary cookies cannot be disabled if you
                use the Service. You can manage optional categories via our cookie consent banner
                and browser settings. See also the consent choices presented on first visit.
              </p>
            </>
          ),
        },
        {
          id: 'location',
          title: '8. Location privacy',
          content: (
            <>
              <p>
                Location is core to local services and local goods pickup. We design for least
                privilege: public discovery may show approximate areas; precise addresses and exact
                coordinates are limited to account holders, transaction counterparts, and security
                systems. Device location permissions, where requested by a mobile client, can be
                revoked in system settings (some features may then be unavailable).
              </p>
            </>
          ),
        },
        {
          id: 'security',
          title: '9. Security',
          content: (
            <>
              <p>
                We use industry-standard measures including encryption in transit at the public
                edge, password hashing (argon2id), selective field-level encryption for certain
                sensitive PII at rest, access controls, and monitoring. No method of transmission
                or storage is 100% secure; please use a strong unique password and enable MFA.
              </p>
            </>
          ),
        },
        {
          id: 'rights',
          title: '10. Your rights',
          content: (
            <>
              <p>
                Depending on your location (for example, GDPR, CCPA/CPRA, and similar laws), you
                may have rights to access, correct, delete, export/port, restrict or object to
                certain processing, and opt out of sale/share of personal information where those
                concepts apply. You can exercise many of these rights in-product (export and delete)
                or by emailing <a href="mailto:support@no-markup.com">support@no-markup.com</a>.
              </p>
              <p>
                We may need to verify your identity before fulfilling a request. You may have the
                right to appeal a denial or lodge a complaint with a supervisory authority.
              </p>
            </>
          ),
        },
        {
          id: 'international',
          title: '11. International transfers',
          content: (
            <>
              <p>
                We may process data in the United States and other countries where we or our
                processors operate. Where required, we use appropriate safeguards for cross-border
                transfers.
              </p>
            </>
          ),
        },
        {
          id: 'changes',
          title: '12. Changes to this Policy',
          content: (
            <>
              <p>
                We may update this Privacy Policy periodically. The &ldquo;Last updated&rdquo; date
                at the top will change when we do. Material changes may be highlighted in-product
                or by email where appropriate.
              </p>
            </>
          ),
        },
        {
          id: 'contact',
          title: '13. Contact',
          content: (
            <>
              <p>
                Privacy and data-rights requests:{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a>
              </p>
              <p>
                Support center: <Link href="/support">/support</Link>
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
