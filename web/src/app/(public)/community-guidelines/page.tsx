// ASR-1.2.g, ASR-BYS.1 — Community Guidelines / UGC standards (App Store P0 legal).

import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalDocument } from '@/components/compliance/LegalDocument';

export const metadata: Metadata = {
  title: 'Community Guidelines | NoMarkup',
  description:
    'Standards for user-generated content on NoMarkup: prohibited items and behavior, reporting, and enforcement.',
  openGraph: {
    title: 'Community Guidelines | NoMarkup',
    description:
      'Rules for jobs, listings, chat, and reviews on NoMarkup — what is allowed, how to report abuse, and how we enforce.',
  },
};

const LAST_UPDATED = 'July 26, 2026';

export default function CommunityGuidelinesPage() {
  return (
    <LegalDocument
      title="Community Guidelines"
      lastUpdated={LAST_UPDATED}
      footerNote={
        <>
          This document is a product-compliance baseline for App Store and platform requirements.
          It is not legal advice. Related: <Link href="/terms">Terms of Service</Link>,{' '}
          <Link href="/privacy">Privacy Policy</Link>, <Link href="/support">Support</Link>.
        </>
      }
      sections={[
        {
          id: 'purpose',
          title: '1. Purpose',
          content: (
            <>
              <p>
                NoMarkup is a marketplace for legitimate home services and local goods. These
                Community Guidelines set standards for user-generated content (UGC) — job posts,
                listings, photos, profiles, chat, offers, and reviews — so everyone can trade
                safely and fairly.
              </p>
              <p>
                Violating these Guidelines may also violate our <Link href="/terms">Terms of Service</Link>.
                We may remove content, limit features, or suspend or terminate accounts.
              </p>
            </>
          ),
        },
        {
          id: 'be-respectful',
          title: '2. Be respectful and honest',
          content: (
            <>
              <ul>
                <li>Communicate professionally in jobs, bids, chat, and reviews.</li>
                <li>Describe work and goods accurately; do not misrepresent condition, ownership, credentials, or licensing.</li>
                <li>Honor commitments you make on contracts and orders, or cancel through the platform process.</li>
                <li>Do not harass, threaten, dox, or impersonate others.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'prohibited',
          title: '3. Prohibited content and conduct',
          content: (
            <>
              <p>Do not post, list, offer, request, or facilitate:</p>
              <ul>
                <li>
                  <strong>Hate and discrimination</strong> — content that attacks people based on
                  race, ethnicity, national origin, religion, sex, gender, sexual orientation,
                  disability, or other protected characteristics.
                </li>
                <li>
                  <strong>Weapons sales</strong> — firearms, ammunition, explosives, or other
                  weapons and related prohibited accessories, including listings that evade these
                  rules.
                </li>
                <li>
                  <strong>Tobacco and controlled substances</strong> — tobacco products, nicotine
                  vapes where prohibited, recreational or illegal drugs, drug paraphernalia, and
                  controlled substances without lawful authorization.
                </li>
                <li>
                  <strong>Pornography and sexual content</strong> — explicit sexual material,
                  sexual services, or non-consensual intimate imagery.
                </li>
                <li>
                  <strong>Scams and fraud</strong> — phishing, fake jobs or listings, payment
                  diversion off-platform to avoid escrow, stolen goods, identity theft, and other
                  deceptive schemes.
                </li>
                <li>
                  <strong>Illegal activity</strong> — anything that violates applicable law,
                  including IP theft, counterfeit goods, and unauthorized professional practice.
                </li>
                <li>
                  <strong>Spam and manipulation</strong> — bulk irrelevant posts, fake reviews,
                  bid or rating manipulation, and malware or harmful links.
                </li>
                <li>
                  <strong>Violence and exploitation</strong> — graphic violence, terrorism, child
                  sexual exploitation (zero tolerance — report immediately), and human trafficking.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'marketplace-specific',
          title: '4. Services and goods expectations',
          content: (
            <>
              <ul>
                <li>
                  <strong>Services</strong> — providers must hold required licenses and insurance
                  for the work they bid; customers must describe scope truthfully.
                </li>
                <li>
                  <strong>Goods</strong> — list only items you own or are authorized to sell;
                  follow local pickup and safety norms; no prohibited categories above.
                </li>
                <li>
                  Prefer in-platform payments and messaging for records and dispute support.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'report-block',
          title: '5. Report and block',
          content: (
            <>
              <p>
                If you see content or behavior that violates these Guidelines:
              </p>
              <ul>
                <li>
                  Use in-app <strong>Report</strong> controls on listings, users, reviews, or chat
                  where available.
                </li>
                <li>
                  Use <strong>Block</strong> to stop further contact from a user in messaging
                  contexts that support it.
                </li>
                <li>
                  Email <a href="mailto:support@no-markup.com">support@no-markup.com</a> with links,
                  screenshots, and context — especially for safety-critical issues.
                </li>
              </ul>
              <p>
                More guidance: <Link href="/support">Support</Link>.
              </p>
            </>
          ),
        },
        {
          id: 'enforcement',
          title: '6. Enforcement',
          content: (
            <>
              <p>We may take one or more of the following actions, with or without prior notice:</p>
              <ul>
                <li>Remove or hide content (including trusted auto-hide for certain reports).</li>
                <li>Warn, restrict bidding/listing, require re-verification, or place holds on payouts.</li>
                <li>Suspend or permanently ban accounts.</li>
                <li>Preserve and share information with law enforcement when legally required or for imminent harm.</li>
              </ul>
              <p>
                Enforcement decisions consider severity, intent, history, and risk to the
                community. Appealing a moderation action: contact{' '}
                <a href="mailto:support@no-markup.com">support@no-markup.com</a> with your account
                email and details.
              </p>
            </>
          ),
        },
        {
          id: 'updates',
          title: '7. Updates',
          content: (
            <>
              <p>
                We may update these Guidelines as products and laws evolve. Continued use of the
                Service after updates constitutes acceptance of the revised Guidelines where
                permitted by law.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
