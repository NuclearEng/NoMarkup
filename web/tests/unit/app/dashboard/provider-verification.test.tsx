import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const documentsState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: vi.fn(),
};

const uploadMutate = vi.fn();
const uploadImageMock = vi.fn();

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useProviderProfile', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useProviderProfile')>(
    '@/hooks/useProviderProfile',
  );
  return {
    ...actual,
    useProviderVerificationDocuments: () => documentsState,
    useUploadVerificationDocument: () => ({
      mutateAsync: uploadMutate,
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    upload: uploadImageMock,
    status: 'idle',
    progress: 0,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ProviderVerificationPage from '@/app/(dashboard)/provider/verification/page';

describe('ProviderVerificationPage', () => {
  beforeEach(() => {
    documentsState.data = [];
    documentsState.isLoading = false;
    documentsState.isError = false;
    documentsState.error = null;
    documentsState.isFetching = false;
    documentsState.refetch = vi.fn();
    uploadMutate.mockReset();
    uploadImageMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders durable verification center with upload types', () => {
    render(withQueryClient(createElement(ProviderVerificationPage)));

    expect(screen.getByRole('heading', { name: /verification documents/i })).toBeInTheDocument();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/driver.?s license/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/proof of insurance/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /provider onboarding/i })).toHaveAttribute(
      'href',
      '/provider/onboarding',
    );
  });

  it('surfaces resubmission lockout for a document type', () => {
    documentsState.data = [
      {
        id: 'd1',
        document_type: 'drivers_license',
        status: 'rejected',
        resubmission_count: 3,
        rejection_reason: 'Blurry scan',
      },
    ];

    render(withQueryClient(createElement(ProviderVerificationPage)));

    expect(screen.getAllByText(/blurry scan/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/locked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no re-uploads left/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/resubmissions:\s*3 of 3/i).length).toBeGreaterThan(0);
  });

  it('uploads a selected PDF through imaging + register', async () => {
    const user = userEvent.setup();
    uploadImageMock.mockResolvedValueOnce({
      ok: true,
      result: { objectKey: 'documents/u1/x.pdf', confirmedUrl: 'https://cdn.example/x.pdf' },
    });
    uploadMutate.mockResolvedValueOnce({ document_id: 'new', status: 'pending' });

    render(withQueryClient(createElement(ProviderVerificationPage)));

    const file = new File(['%PDF-1.4'], 'license.pdf', { type: 'application/pdf' });
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBeGreaterThan(0);
    const input = inputs[0] as HTMLInputElement;
    await user.upload(input, file);

    await screen.findByText('license.pdf');

    await user.click(screen.getByRole('button', { name: /submit for review/i }));

    await waitFor(() => {
      expect(uploadImageMock).toHaveBeenCalled();
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          document_type: 'drivers_license',
          file_name: 'license.pdf',
          mime_type: 'application/pdf',
        }),
      );
    });
  });
});
