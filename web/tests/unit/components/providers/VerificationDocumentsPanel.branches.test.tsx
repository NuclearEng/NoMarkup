import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadOutcome } from '@/hooks/useImageUpload';
import type { ProviderVerificationDocument } from '@/types';

interface DocsQueryState {
  data: ProviderVerificationDocument[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
}

const docsState: DocsQueryState = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
};
const refetch = vi.fn();
const upload = vi.fn<(file: File) => Promise<UploadOutcome>>();
const mutateAsync = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();

vi.mock('@/hooks/useProviderProfile', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useProviderProfile')>('@/hooks/useProviderProfile');
  return {
    ...actual,
    useProviderVerificationDocuments: () => ({ ...docsState, refetch }),
    useUploadVerificationDocument: () => ({ mutateAsync }),
  };
});

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ upload, status: 'idle', progress: 0, error: null, reset: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

import { VerificationDocumentsPanel } from '@/components/providers/VerificationDocumentsPanel';
import { ApiError } from '@/lib/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCKOUT_COPY =
  'This document type has no re-uploads left (maximum 3). Contact support to continue verification.';

function isoFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function makeFile(name: string, type: string, sizeBytes = 2048): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

function selectFile(label: string, file: File): void {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

function okOutcome(url: string): UploadOutcome {
  return { ok: true, result: { objectKey: 'key', confirmedUrl: url } };
}

function clickSubmit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  docsState.data = [];
  docsState.isLoading = false;
  docsState.isError = false;
  docsState.error = null;
  docsState.isFetching = false;
  upload.mockResolvedValue(okOutcome('https://cdn.test/doc'));
  mutateAsync.mockResolvedValue({});
});

describe('VerificationDocumentsPanel query states', () => {
  it('shows a labelled loading skeleton while the documents load', () => {
    docsState.isLoading = true;
    render(<VerificationDocumentsPanel />);
    expect(screen.getByRole('status', { name: 'Loading verification documents' })).toBeInTheDocument();
    expect(screen.queryByText('Upload or re-submit')).not.toBeInTheDocument();
  });

  it('shows the server error and retries on "Try again"', () => {
    docsState.isError = true;
    docsState.error = new Error('gateway down');
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText('Couldn’t load documents')).toBeInTheDocument();
    expect(screen.getByText('gateway down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic error copy and disables retry while refetching', () => {
    docsState.isError = true;
    docsState.error = 'not an error object';
    docsState.isFetching = true;
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText('Something went wrong loading verification documents.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  });

  it('treats a missing data payload as an empty list', () => {
    docsState.data = undefined;
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.queryByText('On file')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select files to upload' })).toBeDisabled();
  });

  it('refreshes on demand and disables refresh while a fetch is in flight', () => {
    const { rerender } = render(<VerificationDocumentsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    docsState.isFetching = true;
    rerender(<VerificationDocumentsPanel />);
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();
  });
});

describe('VerificationDocumentsPanel expiry and lockout banners', () => {
  it('uses singular copy for one expired and one expiring document', () => {
    docsState.data = [
      { id: 'a', document_type: 'custom_cert', status: 'verified', expires_at: isoFromNow(-2) },
      { id: 'b', document_type: 'other_cert', status: 'verified', expires_at: isoFromNow(10) },
    ];
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText(
        '1 document has expired. Upload a renewed copy to restore verified status for new bids.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 document expires within 30 days. Renew it before it lapses.'),
    ).toBeInTheDocument();
  });

  it('uses plural copy for several expired and expiring documents', () => {
    docsState.data = [
      { id: 'a', document_type: 'cert_a', status: 'verified', expires_at: isoFromNow(-2) },
      { id: 'b', document_type: 'cert_b', status: 'verified', expires_at: isoFromNow(-3) },
      { id: 'c', document_type: 'cert_c', status: 'verified', expires_at: isoFromNow(5) },
      { id: 'd', document_type: 'cert_d', status: 'verified', expires_at: isoFromNow(6) },
    ];
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText(
        '2 documents have expired. Upload renewed copies to restore verified status for new bids.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('2 documents expire within 30 days. Renew them before they lapse.'),
    ).toBeInTheDocument();
  });

  it('shows only the expiring line when nothing has expired, and no banner for far-off dates', () => {
    docsState.data = [
      { id: 'c', document_type: 'cert_c', status: 'verified', expires_at: isoFromNow(5) },
    ];
    const { rerender } = render(<VerificationDocumentsPanel />);
    expect(screen.getByText(/expires within 30 days/)).toBeInTheDocument();
    expect(screen.queryByText(/has expired/)).not.toBeInTheDocument();

    docsState.data = [
      { id: 'c', document_type: 'cert_c', status: 'verified', expires_at: isoFromNow(200) },
    ];
    rerender(<VerificationDocumentsPanel />);
    expect(screen.queryByText(/expires within 30 days/)).not.toBeInTheDocument();
  });

  it('names the single locked document type and blocks its upload control', () => {
    docsState.data = [
      { id: 'a', document_type: 'insurance', status: 'rejected', resubmission_count: 3 },
    ];
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText(
        'Proof of Insurance has no re-uploads left. Contact support to continue verification for that type.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Proof of Insurance' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Re-upload disabled for this document type after 3 rejections/),
    ).toBeInTheDocument();
    // On-file row and upload field both flag the lock.
    expect(screen.getAllByText('Locked')).toHaveLength(2);
    expect(screen.getAllByText(/Resubmissions: 3 of 3 — contact support to continue/)).toHaveLength(2);
    // Other types stay uploadable.
    expect(screen.getByRole('button', { name: 'Upload Business License' })).toBeInTheDocument();
  });

  it('counts locked types when more than one is locked', () => {
    docsState.data = [
      { id: 'a', document_type: 'insurance', status: 'rejected', resubmission_count: 3 },
      { id: 'b', document_type: 'ein', status: 'rejected', resubmission_count: 4 },
    ];
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText(
        '2 document types have no re-uploads left. Contact support to continue verification for those types.',
      ),
    ).toBeInTheDocument();
  });
});

describe('VerificationDocumentsPanel on-file rows', () => {
  it('pluralises the on-file count', () => {
    docsState.data = [{ id: 'a', document_type: 'cert_a', status: 'pending' }];
    const { rerender } = render(<VerificationDocumentsPanel />);
    expect(screen.getByText(/^1 document\s*submitted$/)).toBeInTheDocument();

    docsState.data = [
      { id: 'a', document_type: 'cert_a', status: 'pending' },
      { document_type: 'cert_b', status: 'pending' },
    ];
    rerender(<VerificationDocumentsPanel />);
    expect(screen.getByText(/^2 documents\s*submitted$/)).toBeInTheDocument();
  });

  it('shows remaining re-uploads, the rejection reason and a destructive status for a rejected doc', () => {
    docsState.data = [
      {
        id: 'a',
        document_type: 'custom_cert',
        status: 'Rejected',
        resubmission_count: 1,
        rejection_reason: 'Photo is blurry',
      },
    ];
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText('Custom Cert')).toBeInTheDocument();
    expect(screen.getByText('Resubmissions: 1 of 3 · 2 re-uploads left')).toBeInTheDocument();
    expect(screen.getByText('Photo is blurry')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument();
  });

  it('uses singular "re-upload" when exactly one attempt is left', () => {
    docsState.data = [
      { id: 'a', document_type: 'custom_cert', status: 'pending_review', resubmission_count: 2 },
    ];
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText('Resubmissions: 2 of 3 · 1 re-upload left')).toBeInTheDocument();
    expect(screen.getByText('pending review')).toBeInTheDocument();
  });

  it('shows the resubmission line for a first rejection with no count', () => {
    docsState.data = [{ id: 'a', document_type: 'custom_cert', status: 'rejected' }];
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText('Resubmissions: 0 of 3 · 3 re-uploads left')).toBeInTheDocument();
  });

  it('marks verified documents and hides resubmission info and the status badge when absent', () => {
    docsState.data = [
      { id: 'a', document_type: 'custom_cert', status: 'verified' },
      { id: 'b', document_type: 'blank_status', status: '' },
    ];
    render(<VerificationDocumentsPanel />);
    expect(screen.getByLabelText('Verified')).toBeInTheDocument();
    expect(screen.queryByText(/Resubmissions:/)).not.toBeInTheDocument();
    expect(screen.getAllByText('verified')).toHaveLength(1);
  });

  it('describes expired, expiring-soon and far-off expiry dates differently', () => {
    const expired = isoFromNow(-2);
    const soon = isoFromNow(10);
    const tomorrow = isoFromNow(0.5);
    const far = isoFromNow(200);
    docsState.data = [
      { id: 'a', document_type: 'cert_a', status: 'verified', expires_at: expired },
      { id: 'b', document_type: 'cert_b', status: 'verified', expires_at: soon },
      { id: 'c', document_type: 'cert_c', status: 'verified', expires_at: tomorrow },
      { id: 'd', document_type: 'cert_d', status: 'verified', expires_at: far },
    ];
    render(<VerificationDocumentsPanel />);
    expect(
      screen.getByText(`Expired ${new Date(expired).toLocaleDateString()}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Expires ${new Date(soon).toLocaleDateString()} · 10 days left`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Expires ${new Date(tomorrow).toLocaleDateString()} · 1 day left`),
    ).toBeInTheDocument();
    expect(screen.getByText(`Expires ${new Date(far).toLocaleDateString()}`)).toBeInTheDocument();
  });

  it('shows an unparseable expiry date without a days-left suffix', () => {
    docsState.data = [
      { id: 'a', document_type: 'cert_a', status: 'verified', expires_at: 'not-a-date' },
    ];
    render(<VerificationDocumentsPanel />);
    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
  });
});

describe('VerificationDocumentsPanel upload fields', () => {
  it('mirrors existing status, resubmissions and rejection reason on the matching upload field', () => {
    docsState.data = [
      {
        id: 'a',
        document_type: 'business_license',
        status: 'rejected',
        resubmission_count: 2,
        rejection_reason: 'Expired licence',
      },
      { id: 'b', document_type: 'ein', status: 'verified' },
    ];
    render(<VerificationDocumentsPanel />);
    // Row + field each render these lines.
    expect(screen.getAllByText('Resubmissions: 2 of 3 · 1 re-upload left')).toHaveLength(2);
    expect(screen.getAllByText('Expired licence')).toHaveLength(2);
    // Verified existing doc shows the uploaded tick on its field.
    expect(screen.getAllByLabelText('Uploaded')).toHaveLength(1);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getAllByText('Optional')).toHaveLength(4);
  });

  it('rejects an unsupported file type', () => {
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('notes.txt', 'text/plain'));
    expect(screen.getByRole('alert')).toHaveTextContent('Please upload a JPG, PNG, WebP, or PDF file.');
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select files to upload' })).toBeDisabled();
  });

  it('rejects a file over the 10 MB limit', () => {
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('huge.png', 'image/png', 10 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds the 10.0 MB limit.');
  });

  it('ignores a change event that carries no file', () => {
    render(<VerificationDocumentsPanel />);
    fireEvent.change(screen.getByLabelText('Business License'), { target: { files: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select files to upload' })).toBeDisabled();
  });

  it('stages a valid image, clears the earlier error, and removes it again', () => {
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('notes.txt', 'text/plain'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    selectFile('Business License', makeFile('licence.png', 'image/png', 2048));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('licence.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB - PNG')).toBeInTheDocument();
    expect(screen.getByLabelText('Uploaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Business License' }));
    expect(screen.queryByText('licence.png')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Business License' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select files to upload' })).toBeDisabled();
  });

  it('labels a staged PDF as PDF', () => {
    render(<VerificationDocumentsPanel />);
    selectFile('Proof of Insurance', makeFile('policy.pdf', 'application/pdf', 512));
    expect(screen.getByText('512 B - PDF')).toBeInTheDocument();
  });

  it('accepts a dropped file and reflects drag state in the prompt', () => {
    render(<VerificationDocumentsPanel />);
    const zone = screen.getByRole('button', { name: 'Upload EIN / Tax ID Document' });
    fireEvent.dragEnter(zone);
    expect(within(zone).getByText('Drop file here')).toBeInTheDocument();
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    expect(within(zone).getByText('Click or drag file to upload')).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { files: [makeFile('ein.webp', 'image/webp', 1024)] } });
    expect(screen.getByText('ein.webp')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB - WEBP')).toBeInTheDocument();
  });

  it('opens the file picker on click, Enter and Space but not on other keys', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {
      // no native picker in jsdom
    });
    render(<VerificationDocumentsPanel />);
    const zone = screen.getByRole('button', { name: 'Upload Business License' });
    fireEvent.keyDown(zone, { key: 'a' });
    expect(clickSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(zone, { key: 'Enter' });
    fireEvent.keyDown(zone, { key: ' ' });
    fireEvent.click(zone);
    expect(clickSpy).toHaveBeenCalledTimes(3);
    clickSpy.mockRestore();
  });
});

describe('VerificationDocumentsPanel submit', () => {
  it('uploads one document, registers it with exact metadata, toasts and refetches', async () => {
    const file = makeFile('licence.png', 'image/png', 2048);
    upload.mockResolvedValueOnce(okOutcome('https://cdn.test/licence.png'));
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', file);
    clickSubmit();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Document submitted for review');
    });
    expect(upload).toHaveBeenCalledWith(file);
    expect(mutateAsync).toHaveBeenCalledWith({
      document_type: 'business_license',
      file_url: 'https://cdn.test/licence.png',
      file_name: 'licence.png',
      mime_type: 'image/png',
      size_bytes: 2048,
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('licence.png')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select files to upload' })).toBeDisabled();
  });

  it('reports the count when several documents are submitted', async () => {
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    selectFile('Proof of Insurance', makeFile('b.pdf', 'application/pdf'));
    clickSubmit();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('2 documents submitted for review');
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('shows "Uploading…" and locks both buttons while the upload is in flight', async () => {
    let resolveUpload: (outcome: UploadOutcome) => void = () => {
      // replaced below
    };
    upload.mockReturnValueOnce(
      new Promise<UploadOutcome>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();

    expect(await screen.findByRole('button', { name: 'Uploading…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();

    await act(async () => {
      resolveUpload(okOutcome('https://cdn.test/a.png'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it('surfaces the storage failure reason on the field and keeps the file staged', async () => {
    upload.mockResolvedValueOnce({ ok: false, error: 'Max 10 MB' });
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();

    expect(await screen.findByText('Could not upload a.png: Max 10 MB')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('maps a 422 resubmission lockout to the support copy on both field and form', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiError(422, JSON.stringify({ error: 'maximum resubmission count reached' })),
    );
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();

    await waitFor(() => {
      expect(screen.getAllByText(LOCKOUT_COPY)).toHaveLength(2);
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('shows the server message for a 422 that is not a lockout', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiError(422, JSON.stringify({ error: 'file is corrupt' })),
    );
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();
    await waitFor(() => {
      expect(screen.getAllByText('file is corrupt')).toHaveLength(2);
    });
  });

  it('shows the error message for a non-422 registration failure', async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ error: 'db offline' })));
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();
    await waitFor(() => {
      expect(screen.getAllByText('db offline')).toHaveLength(2);
    });
  });

  it('uses per-file and form fallbacks when the registration failure has no message', async () => {
    mutateAsync.mockRejectedValueOnce('nope');
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();
    expect(await screen.findByText('Could not register a.png.')).toBeInTheDocument();
    expect(screen.getByText('Failed to upload documents. Please try again.')).toBeInTheDocument();
  });

  it('stops at the first failing document and does not upload the rest', async () => {
    upload.mockResolvedValueOnce({ ok: false, error: 'network' });
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    selectFile('Proof of Insurance', makeFile('b.pdf', 'application/pdf'));
    clickSubmit();
    expect(await screen.findByText('Could not upload a.png: network')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('maps a thrown 422 from the storage upload to the lockout copy', async () => {
    upload.mockRejectedValueOnce(new ApiError(422, JSON.stringify({ error: 'contact support' })));
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();
    expect(await screen.findByText(LOCKOUT_COPY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('shows a thrown non-422 storage error message', async () => {
    upload.mockRejectedValueOnce(new Error('socket hang up'));
    render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));
    clickSubmit();
    expect(await screen.findByText('socket hang up')).toBeInTheDocument();
  });

  it('refuses to submit a staged file whose type became locked after selection', async () => {
    const { rerender } = render(<VerificationDocumentsPanel />);
    selectFile('Business License', makeFile('a.png', 'image/png'));

    docsState.data = [
      { id: 'a', document_type: 'business_license', status: 'rejected', resubmission_count: 3 },
    ];
    rerender(<VerificationDocumentsPanel />);
    clickSubmit();

    expect(await screen.findByText(LOCKOUT_COPY)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
