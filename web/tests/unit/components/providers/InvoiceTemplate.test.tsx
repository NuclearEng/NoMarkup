import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InvoiceTemplate } from '@/components/providers/InvoiceTemplate';
import type { Contract, Milestone } from '@/types';

const mockMilestones: Milestone[] = [
  {
    id: 'm-1',
    contract_id: 'c-1',
    description: 'Initial deposit',
    amount_cents: 50000,
    sort_order: 0,
    status: 'approved',
    revision_count: 0,
    revision_notes: '',
  },
  {
    id: 'm-2',
    contract_id: 'c-1',
    description: 'Final payment',
    amount_cents: 50000,
    sort_order: 1,
    status: 'approved',
    revision_count: 0,
    revision_notes: '',
  },
];

const mockContract: Contract = {
  id: 'c-1',
  contract_number: 'INV-2026-0001',
  job_id: 'job-12345678',
  job_title: 'Repair kitchen sink',
  customer_id: 'cust-1',
  provider_id: 'prov-1',
  bid_id: 'bid-1',
  amount_cents: 100000,
  payment_timing: 'milestone',
  status: 'completed',
  customer_accepted: true,
  provider_accepted: true,
  acceptance_deadline: '2026-04-01T00:00:00Z',
  milestones: mockMilestones,
  completed_at: '2026-04-15T12:00:00Z',
  created_at: '2026-04-01T12:00:00Z',
};

describe('InvoiceTemplate', () => {
  it('renders INVOICE heading and contract number', () => {
    render(<InvoiceTemplate contract={mockContract} providerName="Acme Plumbing" />);
    expect(screen.getByText('INVOICE')).toBeDefined();
    expect(screen.getByText('INV-2026-0001')).toBeDefined();
  });

  it('renders provider name and address', () => {
    render(
      <InvoiceTemplate
        contract={mockContract}
        providerName="Acme Plumbing"
        providerAddress="123 Main St"
      />,
    );
    expect(screen.getByText('Acme Plumbing')).toBeDefined();
    expect(screen.getByText('123 Main St')).toBeDefined();
  });

  it('renders milestone descriptions as line items', () => {
    render(<InvoiceTemplate contract={mockContract} providerName="Acme Plumbing" />);
    expect(screen.getByText('Initial deposit')).toBeDefined();
    expect(screen.getByText('Final payment')).toBeDefined();
  });

  it('renders the job title', () => {
    render(<InvoiceTemplate contract={mockContract} providerName="Acme Plumbing" />);
    expect(screen.getByText('Repair kitchen sink')).toBeDefined();
  });

  it('renders the total amount', () => {
    render(<InvoiceTemplate contract={mockContract} providerName="Acme Plumbing" />);
    expect(screen.getByText('Total')).toBeDefined();
    // $100,000.00 -> $1,000.00
    expect(screen.getAllByText(/\$1,000\.00/).length).toBeGreaterThan(0);
  });

  it('shows additional services row when milestones do not cover full amount', () => {
    const partial: Contract = {
      ...mockContract,
      amount_cents: 150000,
    };
    render(<InvoiceTemplate contract={partial} providerName="Acme Plumbing" />);
    expect(screen.getByText('Additional services')).toBeDefined();
  });

  it('falls back to created_at when contract has no completed_at date', () => {
    const inProgress: Contract = {
      ...mockContract,
      completed_at: undefined,
    };
    render(<InvoiceTemplate contract={inProgress} providerName="Acme Plumbing" />);
    // The created_at date is 2026-04-01T12:00:00Z -> "April 1, 2026"
    expect(screen.getByText('April 1, 2026')).toBeDefined();
  });

  it('falls back to a job_id slice when contract has no job_title', () => {
    const noTitle: Contract = {
      ...mockContract,
      job_title: '',
    };
    render(<InvoiceTemplate contract={noTitle} providerName="Acme Plumbing" />);
    // job_id 'job-12345678' sliced to 8 chars
    expect(screen.getByText('job-1234')).toBeDefined();
  });
});
