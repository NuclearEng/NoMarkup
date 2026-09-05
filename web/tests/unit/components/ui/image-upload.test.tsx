import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; className?: string }) => (
    <img src={props.src} alt={props.alt} className={props.className} />
  ),
}));

const uploadMock = vi.fn();
vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ upload: uploadMock }),
}));

const { ImageUpload } = await import('@/components/ui/ImageUpload');

function makeFile(
  name = 'pic.png',
  type = 'image/png',
  sizeBytes = 1024,
): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('ImageUpload', () => {
  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({ ok: false, error: 'Upload failed' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the drop zone with default placeholder', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Drop an image/ })).toBeDefined();
  });

  it('renders a custom placeholder when provided', () => {
    render(
      <ImageUpload context="job_photo" onUploadComplete={vi.fn()} placeholder="Upload a logo" />,
    );
    expect(screen.getByText('Upload a logo')).toBeDefined();
  });

  it('renders existing image thumbnails', () => {
    render(
      <ImageUpload
        context="job_photo"
        onUploadComplete={vi.fn()}
        existingImages={['https://example.com/a.jpg']}
      />,
    );
    expect(screen.getByAltText('Uploaded image')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <ImageUpload context="job_photo" onUploadComplete={vi.fn()} className="my-upload" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-upload');
  });

  it('shows multiple-images placeholder when multiple is true', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} multiple />);
    expect(screen.getByText(/Drop images here/)).toBeDefined();
  });

  it('opens file picker when drop zone is clicked', async () => {
    const user = userEvent.setup();
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    // file input is hidden; clicking the role=button triggers .click() on the input.
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const clickSpy = vi.fn();
    const input = dropZone.querySelector('input[type=file]');
    if (input) {
      input.addEventListener('click', clickSpy);
    }
    await user.click(dropZone);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('opens file picker when Enter is pressed', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    const clickSpy = vi.fn();
    if (input) {
      input.addEventListener('click', clickSpy);
    }
    fireEvent.keyDown(dropZone, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('opens file picker when Space is pressed', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    const clickSpy = vi.fn();
    if (input) {
      input.addEventListener('click', clickSpy);
    }
    fireEvent.keyDown(dropZone, { key: ' ' });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    const clickSpy = vi.fn();
    if (input) {
      input.addEventListener('click', clickSpy);
    }
    fireEvent.keyDown(dropZone, { key: 'Tab' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('shows drag visual state on dragenter', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    fireEvent.dragEnter(dropZone);
    expect(screen.getByText('Drop to upload')).toBeDefined();
  });

  it('clears drag state on dragleave', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    fireEvent.dragEnter(dropZone);
    expect(screen.getByText('Drop to upload')).toBeDefined();
    fireEvent.dragLeave(dropZone);
    expect(screen.queryByText('Drop to upload')).toBeNull();
  });

  it('handles dragOver without changing state', () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    fireEvent.dragOver(dropZone);
    // dragOver alone should not toggle the drop-to-upload visual
    expect(screen.queryByText('Drop to upload')).toBeNull();
  });

  it('rejects files of disallowed type with a descriptive error', async () => {
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    const badFile = makeFile('thing.gif', 'image/gif', 100);
    fireEvent.change(input, { target: { files: [badFile] } });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/not an accepted type/i);
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects files larger than maxSizeBytes', async () => {
    render(
      <ImageUpload
        context="job_photo"
        onUploadComplete={vi.fn()}
        maxSizeBytes={500}
      />,
    );
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    const big = makeFile('big.png', 'image/png', 1000);
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/exceeds/i);
    });
  });

  it('blocks new uploads when maxFiles already reached via existing images', async () => {
    render(
      <ImageUpload
        context="job_photo"
        onUploadComplete={vi.fn()}
        maxFiles={1}
        existingImages={['https://example.com/x.jpg']}
        multiple
      />,
    );
    const dropZone = screen.getByRole('button', { name: /Drop images/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    fireEvent.change(input, { target: { files: [makeFile('a.png')] } });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Maximum of 1/);
    });
  });

  it('starts an upload and notifies parent on success', async () => {
    const onComplete = vi.fn();
    const result = { confirmedUrl: 'https://cdn/1.png', objectKey: 'p1' };
    uploadMock.mockResolvedValue({ ok: true, result });
    render(<ImageUpload context="job_photo" onUploadComplete={onComplete} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(result);
    });
  });

  it('shows the actual failure reason (not a bare "Upload failed") and a dismiss button', async () => {
    uploadMock.mockResolvedValue({ ok: false, error: 'Use JPEG, PNG, or WEBP.' });
    render(<ImageUpload context="job_photo" onUploadComplete={vi.fn()} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    fireEvent.change(input, { target: { files: [makeFile('boom.png')] } });
    const dismissBtn = await screen.findByLabelText(/Dismiss error for boom\.png/);
    expect(dismissBtn).toBeDefined();
    // The specific reason surfaces, not a generic placeholder.
    expect(screen.getByText('Use JPEG, PNG, or WEBP.')).toBeDefined();
    fireEvent.click(dismissBtn);
    await waitFor(() => {
      expect(screen.queryByLabelText(/Dismiss error for boom\.png/)).toBeNull();
    });
  });

  it('handles file drop via drag and drop', async () => {
    const onComplete = vi.fn();
    uploadMock.mockResolvedValue({
      ok: true,
      result: { confirmedUrl: 'https://cdn/d.png', objectKey: 'd' },
    });
    render(<ImageUpload context="job_photo" onUploadComplete={onComplete} />);
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const file = makeFile('drop.png');
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalled();
    });
  });

  it('removes a completed upload thumbnail when remove is clicked', async () => {
    const onRemove = vi.fn();
    uploadMock.mockResolvedValue({
      ok: true,
      result: { confirmedUrl: 'https://cdn/c.png', objectKey: 'c' },
    });
    render(
      <ImageUpload
        context="job_photo"
        onUploadComplete={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const dropZone = screen.getByRole('button', { name: /Drop an image/ });
    const input = dropZone.querySelector('input[type=file]');
    if (!input) throw new Error('input not found');
    fireEvent.change(input, { target: { files: [makeFile('c.png')] } });
    const removeBtn = await screen.findByLabelText(/Remove c\.png/);
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('https://cdn/c.png');
  });

  it('removes an existing image when remove is clicked', () => {
    const onRemove = vi.fn();
    render(
      <ImageUpload
        context="job_photo"
        onUploadComplete={vi.fn()}
        existingImages={['https://example.com/old.jpg']}
        onRemove={onRemove}
      />,
    );
    const removeBtn = screen.getByLabelText('Remove image');
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('https://example.com/old.jpg');
  });
});
