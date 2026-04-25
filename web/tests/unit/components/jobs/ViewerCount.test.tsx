import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewerCount } from '@/components/jobs/ViewerCount';

vi.mock('@/hooks/useViewerCount', () => ({
  useViewerCount: vi.fn(() => ({ count: 0 })),
}));

const { useViewerCount } = await import('@/hooks/useViewerCount');

describe('ViewerCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when count is 0', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 0 });
    const { container } = render(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is 1', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 1 });
    const { container } = render(<ViewerCount jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders text when count is 2 or more', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 5 });
    render(<ViewerCount jobId="job-1" />);
    expect(screen.getByText(/5 providers viewing now/)).toBeDefined();
  });

  it('exposes accessible aria-label', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 3 });
    render(<ViewerCount jobId="job-1" />);
    expect(screen.getByLabelText('3 providers viewing now')).toBeDefined();
  });

  it('forwards className', () => {
    vi.mocked(useViewerCount).mockReturnValue({ count: 4 });
    render(<ViewerCount jobId="job-1" className="my-extra" />);
    const el = screen.getByLabelText(/4 providers viewing now/);
    expect(el.className).toContain('my-extra');
  });
});
