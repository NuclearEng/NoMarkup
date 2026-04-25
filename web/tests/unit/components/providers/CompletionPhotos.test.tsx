import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionPhotos } from '@/components/providers/CompletionPhotos';

const uploadMutate = vi.fn();
const markCompleteMutate = vi.fn();

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => createElement('img', props),
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useUploadCompletionPhoto: () => ({ mutate: uploadMutate, isPending: false }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useMarkComplete: () => ({ mutate: markCompleteMutate, isPending: false }),
}));

describe('CompletionPhotos', () => {
  beforeEach(() => {
    uploadMutate.mockReset();
    markCompleteMutate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Completion Photos heading', () => {
    render(<CompletionPhotos contractId="c-1" />);
    expect(screen.getByText('Completion Photos')).toBeDefined();
  });

  it('renders Before and After upload slots with accessible labels', () => {
    render(<CompletionPhotos contractId="c-1" />);
    // Both file input and tap-target button have an aria-label about upload
    expect(screen.getAllByLabelText(/Upload before photo/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Upload after photo/).length).toBeGreaterThan(0);
  });

  it('disables Mark Complete when no after photo is present', () => {
    render(<CompletionPhotos contractId="c-1" />);
    const button = screen.getByRole('button', {
      name: /Upload an after photo before marking complete/,
    });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('shows hint text when after photo is missing', () => {
    render(<CompletionPhotos contractId="c-1" />);
    expect(screen.getByText(/After.*photo to mark this job complete/i)).toBeDefined();
  });
});
