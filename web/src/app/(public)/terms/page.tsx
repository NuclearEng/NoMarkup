// ASR-5.1.1.i, ASR-1.2.g, ASR-1.2.d, ASR-BYS.1 — Terms of Service (App Store P0 legal).
// NOT the attorney marketplace at /legal.

import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalDocument } from '@/components/compliance/LegalDocument';

export const metadata: Metadata = {
  title: 'Terms of Service | NoMarkup',
  description:
    'Terms of Service for NoMarkup — the reverse-auction services marketplace and local goods marketplace at no-markup.com.',
  openGraph: {
    title: 'Terms of Service | NoMarkup',
    description:
      'Read the Terms of Service that govern your use of NoMarkup’s services and goods marketplaces.',
  },
};

const LAST_UPDATED = 'August 12, 2026';

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      footerNote={
        <>
          This document is a product-compliance baseline for App Store and platform requirements.
          It is not legal advice. For privacy details see our{' '}
          <Link href="/privacy">Privacy Policy</Link>. For user-generated content rules see{' '}
          <Link href="/community-guidelines">Community Guidelines</Link>. Contact{' '}
          <a href="mailto:support@no-markup.com">support@no-markup.com</a>.
        </>
      }
      sections={[
        {
          id: 'agreement',
          title: '1. Agreement to these Terms',
          content: (
            <>
              <p>
                These Terms of Service (&ldquo;Terms&rdquo;) govern access to and use of the
                NoMarkup websites, apps, APIs, and related services operated at{' '}
                <strong>no-markup.com</strong> and affiliated properties (collectively, the
                &ldquo;Service&rdquo;). By creating an account, browsing public listings, posting a
                job, placing a bid, listing goods, or otherwise using the Service, you agree to
                these Terms and our <Link href="/privacy">Privacy Policy</Link>.
              </p>
              <p>
                If you do not agree, do not use the Service. We may update these Terms from time
                to time. Material changes are effective when a new version is published and, for
                registered users, when we require re-acceptance of the then-current version
                before continued use of restricted features.
              </p>
            </>
          ),
        },
        {
          id: 'eligibility',
          title: '2. Eligibility and accounts',
          content: (
            <>
              <p>
                You must be at least <strong>18 years old</strong> (or the age of majority in your
                jurisdiction, if higher) to create an account or use transactional features. The
                Service is not directed to children. We may require age verification and suspend
                accounts that fail eligibility checks.
              </p>
              <p>
                You are responsible for accurate registration information, safeguarding your
                credentials (including multi-factor authentication where enabled), and all activity
                under your account. Notify us promptly at{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a> if you suspect
                unauthorized access.
              </p>
              <p>
                Roles on the platform may include customer (buyer of services or goods), provider
                (seller of services), seller (goods marketplace), and administrator. Additional
                verification, licensing, insurance, or KYC checks may apply before you can bid,
                accept contracts, list goods, or receive payouts.
              </p>
            </>
          ),
        },
        {
          id: 'marketplace-nature',
          title: '3. Marketplace nature of the Service',
          content: (
            <>
              <p>
                NoMarkup operates a <strong>two-sided marketplace</strong>:
              </p>
              <ul>
                <li>
                  <strong>Services</strong> — reverse-auction style jobs where customers post work
                  and providers compete on price.
                </li>
                <li>
                  <strong>Goods</strong> — forward-auction and fixed-price style listings for
                  physical items, generally local pickup within a defined distance (for example,
                  25 miles), unless a feature explicitly states otherwise.
                </li>
              </ul>
              <p>
                NoMarkup is not a party to the underlying service or sales contracts between users
                except where we expressly state otherwise (for example, payment processing,
                escrow facilitation, or platform guarantees described in-product). Users are
                independent contractors or consumers relative to one another; providers and sellers
                are not employees of NoMarkup.
              </p>
            </>
          ),
        },
        {
          id: 'user-content',
          title: '4. User content and community standards',
          content: (
            <>
              <p>
                You retain ownership of content you submit (job descriptions, listing text, photos,
                chat messages, reviews, profiles, and similar material). You grant NoMarkup a
                worldwide, non-exclusive, royalty-free license to host, store, display, reproduce,
                and distribute that content solely to operate, improve, secure, and promote the
                Service.
              </p>
              <p>
                You must comply with our <Link href="/community-guidelines">Community Guidelines</Link>.
                Prohibited content and conduct include hate speech; sale of weapons, tobacco, or
                controlled substances; pornography; scams and fraud; IP infringement; and other
                illegal or harmful activity. We may remove content, limit features, or suspend or
                terminate accounts for violations.
              </p>
              <p>
                You represent that you have the rights to the content you post and that it does not
                violate law or third-party rights.
              </p>
            </>
          ),
        },
        {
          id: 'payments',
          dataTosVersion: 'tos-2026-08-12-bid-auth',
          title: '5. Payments, fees, and escrow',
          content: (
            <>
              <p>
                Payments on the Service are processed by <strong>Stripe</strong> (including Stripe
                Connect for connected accounts and, where available, Apple Pay / payment request
                buttons). NoMarkup does not store full card numbers. Price calculations that affect
                charges, fees, or escrow are performed server-side; client displays are informational.
              </p>
              <ul>
                <li>
                  Platform fees, lead-generation fees, subscription tiers, bid bonds, and other
                  charges are disclosed in product surfaces before you confirm.
                </li>
                <li>
                  Escrow and payout timing depend on contract or order status, dispute state, and
                  applicable policy. Providers and sellers may not self-release escrow in a manner
                  that bypasses platform controls.
                </li>
                <li>
                  Taxes are your responsibility except where the law requires NoMarkup or a payment
                  partner to collect or report.
                </li>
              </ul>
              {/* tos-2026-08-12-bid-auth — bid-authorization for goods off-session charge */}
              <p data-tos-version="tos-2026-08-12-bid-auth">
                Placing a bid or using Buy it now on a goods listing authorizes NoMarkup to charge
                the payment method saved on your account if you win or complete the purchase, for
                the winning amount plus disclosed platform fees and applicable tax. If that charge
                fails, you can complete payment from the order page.
              </p>
              <p>
                Chargebacks, refunds, and guarantee claims are handled under the policies shown at
                the time of the transaction and any applicable written guarantee terms.
              </p>
            </>
          ),
        },
        {
          id: 'location-maps',
          title: '6. Location, maps, and local fulfillment',
          content: (
            <>
              <p>
                Location data may be used for matching, search, map display (including Mapbox),
                local pickup radius checks, and fraud/safety signals. Approximate or coarsened
                locations may be shown publicly for privacy; exact addresses are shared only as
                needed for fulfillment between the parties to a job or order.
              </p>
              <p>
                You must provide accurate service or pickup addresses and comply with local laws
                when arranging in-person meetings.
              </p>
            </>
          ),
        },
        {
          id: 'third-parties',
          title: '7. Third-party services',
          content: (
            <>
              <p>
                The Service integrates third parties such as Stripe (payments), Mapbox (maps),
                Sentry and optional analytics (diagnostics / usage, subject to consent), and OAuth
                identity providers (Google, Apple, Facebook) where enabled. Your use of those
                services may also be governed by their terms and privacy policies. We are not
                responsible for third-party services we do not control.
              </p>
            </>
          ),
        },
        {
          id: 'disclaimers',
          title: '8. Disclaimers and limitation of liability',
          content: (
            <>
              <p>
                THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE
                MAXIMUM EXTENT PERMITTED BY LAW, NOMARKUP DISCLAIMS WARRANTIES OF MERCHANTABILITY,
                FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT that jobs
                or listings will achieve a particular price, that any user is reliable or licensed
                beyond verification signals we surface, or that the Service will be uninterrupted
                or error-free.
              </p>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, NOMARKUP&rsquo;S AGGREGATE LIABILITY ARISING
                OUT OF OR RELATED TO THE SERVICE IS LIMITED TO THE GREATER OF (A) FEES YOU PAID TO
                NOMARKUP IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED U.S. DOLLARS
                (US$100). We are not liable for indirect, incidental, special, consequential, or
                punitive damages, or lost profits, even if advised of the possibility.
              </p>
              <p>
                Some jurisdictions do not allow certain limitations; in those cases our liability
                is limited to the fullest extent permitted.
              </p>
            </>
          ),
        },
        {
          id: 'indemnity',
          title: '9. Indemnification',
          content: (
            <>
              <p>
                You agree to indemnify and hold harmless NoMarkup and its officers, directors,
                employees, and agents from claims, damages, losses, and expenses (including
                reasonable attorneys&rsquo; fees) arising from your content, your use of the Service,
                your transactions with other users, or your violation of these Terms or applicable
                law.
              </p>
            </>
          ),
        },
        {
          id: 'termination',
          title: '10. Suspension, termination, and account deletion',
          content: (
            <>
              <p>
                We may suspend or terminate access for violations of these Terms, Community
                Guidelines, fraud risk, legal process, or operational necessity. You may request
                account deletion in Settings; deletion typically includes a{' '}
                <strong>30-day grace period</strong> during which you can cancel. Some records are
                retained as required for law, tax, dispute, or security purposes, as described in
                the <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </>
          ),
        },
        {
          id: 'disputes',
          title: '11. Governing law and disputes',
          content: (
            <>
              <p>
                These Terms are governed by the laws of the State of Washington, USA, without
                regard to conflict-of-law rules, except where mandatory consumer protections in
                your place of residence apply. Courts in King County, Washington, have exclusive
                jurisdiction for disputes not subject to a mandatory alternative forum, unless
                applicable law requires otherwise.
              </p>
              <p>
                Before filing a formal claim, contact{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a> so we can try to
                resolve the issue informally.
              </p>
            </>
          ),
        },
        {
          id: 'misc',
          title: '12. Miscellaneous',
          content: (
            <>
              <p>
                These Terms, together with the Privacy Policy, Community Guidelines, and any
                in-product policies expressly incorporated by reference, are the entire agreement
                between you and NoMarkup regarding the Service. If a provision is unenforceable,
                the remainder stays in effect. Failure to enforce a provision is not a waiver.
                You may not assign these Terms without our consent; we may assign them in
                connection with a merger, acquisition, or sale of assets.
              </p>
              <p>
                Questions: <a href="mailto:support@no-markup.com">support@no-markup.com</a> ·{' '}
                <Link href="/support">Support center</Link>
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
