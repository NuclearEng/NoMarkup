// JobDetailsWidget — purely static demo content. Smoke-test header + body.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { JobDetailsWidget } from '@/components/terminal/widgets/job-details-widget';
import { makeWidgetProps } from './_fixtures';

describe('JobDetailsWidget', () => {
  it('renders Job Details header', () => {
    render(createElement(JobDetailsWidget, makeWidgetProps()));
    expect(screen.getByText('Job Details')).toBeDefined();
  });

  it('renders the demo description body', () => {
    render(createElement(JobDetailsWidget, makeWidgetProps()));
    expect(screen.getByText(/Complete kitchen renovation/)).toBeDefined();
  });

  it('renders all category badges', () => {
    render(createElement(JobDetailsWidget, makeWidgetProps()));
    for (const tag of ['Kitchen', 'Renovation', 'Plumbing', 'Electrical', 'Tiling']) {
      expect(screen.getByText(tag)).toBeDefined();
    }
  });
});
