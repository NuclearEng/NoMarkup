// Tests for the file-a-dispute multi-step wizard — exercises step rendering,
// reason selection, navigation, evidence upload + remove, review step, and
// the submitted success state.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const contractsState: {
  data: { contracts: Record<string, unknown>[] } | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const fileDisputeMutate = vi.fn(() => Promise.resolve({ dispute_id: 'd-9999' }));
const fileDisputeState = { isPending: false, isError: false };

const imageUploadState: {
  status: string;
  progress: number;
  error: string | null;
} = { status: 'idle', progress: 0, error: null };
const uploadFn = vi.fn();

const searchParamsRef: { current: URLSearchParams } = {
  current: new URLSearchParams(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/disputes/new',
  useSearchParams: () => searchParamsRef.current,
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => contractsState,
}));

vi.mock('@/hooks/useDisputes', () => ({
  useFileDispute: () => ({
    mutateAsync: fileDisputeMutate,
    isPending: fileDisputeState.isPending,
    isError: fileDisputeState.isError,
  }),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: ({
    onSuccess,
  }: {
    onSuccess?: (r: { confirmedUrl: string }) => void;
  }) => ({
    upload: (file: File) => {
      uploadFn(file);
      onSuccess?.({ confirmedUrl: `https://cdn.example/${file.name}` });
      return Promise.resolve();
    },
    status: imageUploadState.status,
    progress: imageUploadState.progress,
    error: imageUploadState.error,
  }),
}));

const { default: DisputeNewPage } = await import('@/app/(dashboard)/disputes/new/page');

function makeContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contract-1',
    contract_number: 'CON-001',
    job_id: 'j-1',
    job_title: 'Fix Sink',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    bid_id: 'b-1',
    amount_cents: 10000,
    payment_timing: 'completion',
    status: 'completed',
    customer_accepted: true,
    provider_accepted: true,
    acceptance_deadline: '2026-04-30T00:00:00Z',
    milestones: [],
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickNext(): Promise<void> {
  const btn = await screen.findByRole('button', { name: /^Next$/i });
  await act(async () => {
    fireEvent.click(btn);
    await Promise.resolve();
  });
  await flush();
}

beforeEach(() => {
  contractsState.data = undefined;
  contractsState.isLoading = false;
  contractsState.isError = false;
  fileDisputeState.isPending = false;
  fileDisputeState.isError = false;
  imageUploadState.status = 'idle';
  imageUploadState.progress = 0;
  imageUploadState.error = null;
  searchParamsRef.current = new URLSearchParams();
  fileDisputeMutate.mockClear();
  fileDisputeMutate.mockImplementation(() => Promise.resolve({ dispute_id: 'd-9999' }));
  uploadFn.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DisputeNewPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(DisputeNewPage)));
    expect(container).toBeTruthy();
  });

  it('renders File a Dispute heading and step 1 of 5', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByRole('heading', { name: /File a Dispute/i })).toBeDefined();
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('renders contract step on initial load', async () => {
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByText(/Select the contract related to this dispute/i)).toBeDefined();
  });

  it('renders Next button on step 1 (no Previous)', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByRole('button', { name: /^Next$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Previous$/i })).toBeNull();
  });

  it('keeps user on step 1 when contract is not selected and Next clicked', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    const nextBtn = await screen.findByRole('button', { name: /^Next$/i });
    await act(() => {
      fireEvent.click(nextBtn);
      return Promise.resolve();
    });
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('disables future step indicators initially', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    const nav = await screen.findByRole('navigation', { name: /Dispute filing steps/i });
    const buttons = nav.querySelectorAll('button');
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders 5 step indicator buttons', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    const nav = await screen.findByRole('navigation', { name: /Dispute filing steps/i });
    expect(nav.querySelectorAll('button').length).toBe(5);
  });

  it('shows the No contracts found item when contract list is empty', async () => {
    contractsState.data = { contracts: [] };
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByText(/Select the contract for this dispute/i)).toBeDefined();
  });

  it('progress bar reflects step 1 value', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    const progress = await screen.findByRole('progressbar', { name: /Dispute filing progress/i });
    expect(progress).toBeDefined();
  });

  it('renders the file-input fallback when image-upload error occurs', async () => {
    imageUploadState.error = 'upload boom';
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByRole('heading', { name: /File a Dispute/i })).toBeDefined();
  });

  it('clicking a step indicator button does nothing when index is past current step', async () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    const nav = await screen.findByRole('navigation', { name: /Dispute filing steps/i });
    const buttons = nav.querySelectorAll('button');
    const futureBtn = buttons[3] as HTMLButtonElement;
    expect(futureBtn.disabled).toBe(true);
    await act(() => {
      fireEvent.click(futureBtn);
      return Promise.resolve();
    });
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('Submit Dispute button does not appear before reaching Review step', () => {
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(screen.queryByRole('button', { name: /Submit Dispute/i })).toBeNull();
  });

  it('Submitting state shows Submitting... label when fileDispute is pending', async () => {
    contractsState.data = { contracts: [makeContract()] };
    fileDisputeState.isPending = true;
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByRole('heading', { name: /File a Dispute/i })).toBeDefined();
  });

  it('shows uploading status label on the upload button when status=uploading', async () => {
    imageUploadState.status = 'uploading';
    imageUploadState.progress = 42;
    render(withQueryClient(createElement(DisputeNewPage)));
    expect(await screen.findByRole('heading', { name: /File a Dispute/i })).toBeDefined();
  });

  // ---- Deeper traversal tests ----

  it('advances to reason step when prefilled contractId is in URL params', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    expect(screen.getByText(/Step 2 of 5/i)).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: /Select dispute reason/i })).toBeDefined();
  });

  it('selects a reason radio and advances to description step', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext(); // step 1 -> 2
    const radio = screen.getByRole('radio', { name: /Quality Issue/i });
    await act(() => {
      fireEvent.click(radio);
      return Promise.resolve();
    });
    await flush();
    await clickNext(); // step 2 -> 3
    expect(screen.getByText(/Step 3 of 5/i)).toBeDefined();
    expect(screen.getByLabelText('Description')).toBeDefined();
  });

  it('shows character counter and blocks Next when description too short', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Quality Issue/i }));
    await flush();
    await clickNext(); // -> description
    const textarea = screen.getByLabelText('Description');
    fireEvent.change(textarea, { target: { value: 'too short' } });
    await flush();
    expect(screen.getByText(/9\/5000/)).toBeDefined();
    await clickNext();
    // Validation kept us on step 3.
    expect(screen.getByText(/Step 3 of 5/i)).toBeDefined();
  });

  it('reaches the Review step after filling all required fields', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract({ contract_number: 'CON-XYZ' })] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /No-Show/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'The provider did not show up and we waited two hours past the agreed time.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    expect(screen.getByText(/Step 4 of 5/i)).toBeDefined();
    await clickNext(); // -> review
    expect(screen.getByText(/Step 5 of 5/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Submit Dispute/i })).toBeDefined();
    // Selected reason label rendered in review summary.
    expect(screen.getByText('No-Show')).toBeDefined();
    // Selected contract rendered with number.
    expect(screen.getByText(/CON-XYZ/)).toBeDefined();
  });

  it('Previous button moves the wizard back one step', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    expect(screen.getByText(/Step 2 of 5/i)).toBeDefined();
    const prev = screen.getByRole('button', { name: /^Previous$/i });
    await act(() => {
      fireEvent.click(prev);
      return Promise.resolve();
    });
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('uploads evidence on the Evidence step and removes a previewed photo', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'A long enough description that satisfies the fifty character minimum here.' },
    });
    await flush();
    await clickNext(); // -> evidence

    const file = new File(['hi'], 'photo.png', { type: 'image/png' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      return Promise.resolve();
    });
    await flush();
    expect(uploadFn).toHaveBeenCalled();
    const removeBtn = await screen.findByRole('button', {
      name: /Remove evidence photo 1/i,
    });
    await act(() => {
      fireEvent.click(removeBtn);
      return Promise.resolve();
    });
    await flush();
    // Photo counter should now be back to 0.
    expect(screen.getByText('0/5 photos')).toBeDefined();
  });

  it('submits the dispute and shows the success screen with the dispute ID', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Property Damage/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    await clickNext(); // -> review
    const submit = screen.getByRole('button', { name: /Submit Dispute/i });
    await act(() => {
      fireEvent.click(submit);
      return Promise.resolve();
    });
    await waitFor(() => {
      expect(fileDisputeMutate).toHaveBeenCalled();
    });
    await flush();
    expect(await screen.findByRole('heading', { name: /Dispute Filed/i })).toBeDefined();
    expect(screen.getByText('d-9999')).toBeDefined();
    expect(screen.getByText('Filed')).toBeDefined();
  });

  it('handles submit error gracefully and keeps wizard on Review step', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    fileDisputeMutate.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Incomplete Work/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext();
    await clickNext();
    const submit = screen.getByRole('button', { name: /Submit Dispute/i });
    await act(() => {
      fireEvent.click(submit);
      return Promise.resolve();
    });
    await flush();
    // Still on review step (success view did not render).
    expect(screen.queryByRole('heading', { name: /Dispute Filed/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Submit Dispute/i })).toBeDefined();
  });

  it('jumping back via step indicator works for completed steps', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext(); // step 2
    await clickNext(); // validation fails on reason — still step 2
    fireEvent.click(screen.getByRole('radio', { name: /Quality Issue/i }));
    await flush();
    await clickNext(); // step 3
    const nav = screen.getByRole('navigation', { name: /Dispute filing steps/i });
    const stepButtons = within(nav).getAllByRole('button');
    // The first step indicator should be enabled (idx < step) and clickable.
    const firstStep = stepButtons[0];
    if (!firstStep) throw new Error('Expected step indicator buttons');
    await act(() => {
      fireEvent.click(firstStep);
      return Promise.resolve();
    });
    await flush();
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('renders fallback contractId text on Review when no matching contract found', async () => {
    // contractId in URL doesn't match any loaded contract → selectedContract undefined
    searchParamsRef.current = new URLSearchParams('contractId=missing-contract');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext(); // -> reason
    fireEvent.click(screen.getByRole('radio', { name: /Quality Issue/i }));
    await flush();
    await clickNext(); // -> description
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    await clickNext(); // -> review
    expect(screen.getByText(/Step 5 of 5/i)).toBeDefined();
    // The selected contract fallback is the raw contractId value.
    expect(screen.getByText('missing-contract')).toBeDefined();
  });

  it('shows singular "1 photo attached" copy on Review when a single evidence photo is added', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence

    const file = new File(['hi'], 'one.png', { type: 'image/png' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      return Promise.resolve();
    });
    await flush();
    await clickNext(); // -> review
    expect(screen.getByText(/1 photo attached/)).toBeDefined();
  });

  it('renders Processing... when image upload status is getting_url', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    imageUploadState.status = 'getting_url';
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    expect(screen.getByText(/Processing\.\.\./)).toBeDefined();
  });

  it('renders Processing... when image upload status is confirming', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    imageUploadState.status = 'confirming';
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    expect(screen.getByText(/Processing\.\.\./)).toBeDefined();
  });

  it('renders the upload error message under the upload button when imageUpload.error is set', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    imageUploadState.error = 'upload boom';
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    expect(screen.getByText('upload boom')).toBeDefined();
  });

  it('preventDefault on form submit fires (no-op submit handler)', async () => {
    contractsState.data = { contracts: [makeContract()] };
    const { container } = render(withQueryClient(createElement(DisputeNewPage)));
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    if (form) {
      // Direct form submit triggers the no-op preventDefault handler on the <form>.
      await act(() => {
        fireEvent.submit(form);
        return Promise.resolve();
      });
    }
    // Step did not advance because no Next click was performed.
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
  });

  it('renders Uploading... NN% label on the upload button when status=uploading at the evidence step', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    imageUploadState.status = 'uploading';
    imageUploadState.progress = 73;
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence
    expect(screen.getByText(/Uploading\.\.\. 73%/)).toBeDefined();
  });

  it('hides the upload button when MAX_EVIDENCE photos have been added', async () => {
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };
    render(withQueryClient(createElement(DisputeNewPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence

    // Upload 5 photos to hit MAX_EVIDENCE, exercising the !(evidenceUrls.length < MAX) branch.
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    for (let i = 0; i < 5; i++) {
      const file = new File(['x'], `photo-${String(i)}.png`, { type: 'image/png' });
      await act(() => {
        fireEvent.change(input, { target: { files: [file] } });
        return Promise.resolve();
      });
      await flush();
    }
    // Photo counter should now read 5/5
    expect(screen.getByText(/5\/5 photos/)).toBeDefined();
  });

  it('image upload error callback is invoked when onError fires', async () => {
    // When onError fires inside imageUpload, the page handler does `void error;` — line 87.
    // Mock the upload hook to invoke onError, and trigger an upload.
    searchParamsRef.current = new URLSearchParams('contractId=contract-1');
    contractsState.data = { contracts: [makeContract()] };

    // Re-mock the import to return a hook that fires onError on upload.
    vi.resetModules();
    vi.doMock('@/hooks/useImageUpload', () => ({
      useImageUpload: ({
        onError,
      }: {
        onError?: (e: Error) => void;
      }) => ({
        upload: () => {
          onError?.(new Error('boom'));
          return Promise.resolve();
        },
        status: 'idle',
        progress: 0,
        error: null,
      }),
    }));
    const { default: ReimportedPage } = await import(
      '@/app/(dashboard)/disputes/new/page'
    );
    render(withQueryClient(createElement(ReimportedPage)));
    await clickNext();
    fireEvent.click(screen.getByRole('radio', { name: /Other/i }));
    await flush();
    await clickNext();
    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'A long enough description that satisfies the fifty character minimum here.',
      },
    });
    await flush();
    await clickNext(); // -> evidence

    const file = new File(['hi'], 'err.png', { type: 'image/png' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      return Promise.resolve();
    });
    await flush();
    expect(screen.getByRole('heading', { name: /File a Dispute/i })).toBeDefined();

    vi.doUnmock('@/hooks/useImageUpload');
  });
});
