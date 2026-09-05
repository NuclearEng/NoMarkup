import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/report-web-vitals', () => ({
  reportWebVitals: vi.fn(() => () => undefined),
}));

import { WebVitalsReporter } from '@/components/providers/WebVitalsReporter';
import { reportWebVitals } from '@/lib/report-web-vitals';

describe('WebVitalsReporter', () => {
  it('mounts once and starts the vitals reporter', () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
    expect(reportWebVitals).toHaveBeenCalledOnce();
  });
});
