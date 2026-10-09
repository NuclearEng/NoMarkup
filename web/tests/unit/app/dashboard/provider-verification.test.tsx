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

const backgroundCheckState: {
  data: { status: string; invitation_url?: string | null } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: { status: 'not_started' },
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: vi.fn(),
};

const startMutate = vi.fn();

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlag: () => true,
  useFeatureFlags: () => ({ background_checks: true }),
}));

vi.mock('@/hooks/useBackgroundCheck', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useBackgroundCheck')>(
    '@/hooks/useBackgroundCheck',
  );
  return {
    ...actual,
    useBackgroundCheck: () => backgroundCheckState,
    useStartBackgroundCheck: () => ({
      mutate: startMutate,
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

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
    startMutate.mockReset();
    backgroundCheckState.data = { status: 'not_started' };
    backgroundCheckState.isLoading = false;
    backgroundCheckState.isError = false;
    backgroundCheckState.error = null;
    backgroundCheckState.isFetching = false;
    backgroundCheckState.refetch = vi.fn();
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
    expect(screen.getByRole('heading', { name: /background check/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start background check/i })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /open checkr/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^pass$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/passed/i)).not.toBeInTheDocument();
  });

  it('shows Checkr status and Open Checkr when invitation_url is present', () => {
    backgroundCheckState.data = {
      status: 'pending',
      invitation_url: 'https://apply.checkr.com/invite/abc',
    };

    render(withQueryClient(createElement(ProviderVerificationPage)));

    expect(screen.getByText(/^pending$/i)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /open checkr/i });
    expect(open).toHaveAttribute('href', 'https://apply.checkr.com/invite/abc');
    expect(screen.getByRole('button', { name: /start background check/i })).toBeDisabled();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/^pass$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^passed$/i)).not.toBeInTheDocument();
  });

  it('starts a background check from the start button', async () => {
    const user = userEvent.setup();
    render(withQueryClient(createElement(ProviderVerificationPage)));
    await user.click(screen.getByRole('button', { name: /start background check/i }));
    expect(startMutate).toHaveBeenCalled();
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
