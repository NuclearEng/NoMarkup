import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegalDocument } from '@/components/compliance/LegalDocument';

describe('LegalDocument', () => {
  it('renders title, last updated, sections with ids, and TOC links (mobile + desktop)', () => {
    render(
      <LegalDocument
        title="Sample Policy"
        lastUpdated="July 26, 2026"
        sections={[
          {
            id: 'overview',
            title: 'Overview',
            content: <p>Overview body copy for compliance smoke test.</p>,
          },
          {
            id: 'contact',
            title: 'Contact',
            content: <p>Contact body at support@no-markup.com.</p>,
          },
        ]}
        footerNote={<p>Not legal advice; for product compliance baseline.</p>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Sample Policy' })).toBeDefined();
    expect(screen.getByText(/Last updated:/i)).toBeDefined();
    expect(screen.getByText('July 26, 2026')).toBeDefined();

    const overview = document.getElementById('overview');
    const contact = document.getElementById('contact');
    expect(overview).not.toBeNull();
    expect(contact).not.toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Contact' })).toBeDefined();
    expect(screen.getByText(/Overview body copy/i)).toBeDefined();
    expect(screen.getByText(/Not legal advice/i)).toBeDefined();

    // Mobile collapsible + desktop sticky both expose "On this page" navs.
    const tocs = screen.getAllByRole('navigation', { name: 'On this page' });
    expect(tocs.length).toBeGreaterThanOrEqual(1);
    const overviewLinks = screen.getAllByRole('link', { name: 'Overview' });
    expect(overviewLinks.some((el) => el.getAttribute('href') === '#overview')).toBe(true);

    // Mobile TOC uses a details/summary for thumb reachability.
    const summary = document.querySelector('summary');
    expect(summary?.textContent).toMatch(/On this page/i);
  });

  it('hides TOC when showToc is false', () => {
    render(
      <LegalDocument
        title="Support"
        lastUpdated="July 26, 2026"
        showToc={false}
        sections={[
          {
            id: 'help',
            title: 'Help',
            content: <p>Help content</p>,
          },
        ]}
      />,
    );

    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull();
    expect(document.getElementById('help')).not.toBeNull();
  });

  it('stamps data-tos-version on a section when provided', () => {
    render(
      <LegalDocument
        title="Terms"
        lastUpdated="August 12, 2026"
        showToc={false}
        sections={[
          {
            id: 'payments',
            title: 'Payments',
            dataTosVersion: 'tos-2026-08-12-bid-auth',
            content: <p>Bid authorization body.</p>,
          },
        ]}
      />,
    );

    const section = document.getElementById('payments');
    expect(section?.getAttribute('data-tos-version')).toBe('tos-2026-08-12-bid-auth');
  });
});
