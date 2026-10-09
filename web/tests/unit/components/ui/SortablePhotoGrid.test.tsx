import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SortablePhotoGrid, type PhotoSlot } from '@/components/ui/SortablePhotoGrid';

// jsdom doesn't implement PointerEvent properly; stub it for dnd-kit's sensors.
class FakePointerEvent extends MouseEvent {
  pointerId = 1;
  pointerType = 'mouse';
  isPrimary = true;
}
Object.defineProperty(globalThis, 'PointerEvent', {
  value: FakePointerEvent,
  writable: true,
});

const SAMPLE: PhotoSlot[] = [
  { id: 'a', url: 'blob:a' },
  { id: 'b', url: 'blob:b', quality: { score: 78, hints: [] } },
  { id: 'c', url: 'blob:c', quality: { score: 25, hints: ['Looks blurry'] } },
];

describe('SortablePhotoGrid', () => {
  it('renders one tile per photo plus an Add tile when below the cap', () => {
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        maxPhotos={10}
      />,
    );
    expect(screen.getByTestId('photo-slot-0')).toBeInTheDocument();
    expect(screen.getByTestId('photo-slot-1')).toBeInTheDocument();
    expect(screen.getByTestId('photo-slot-2')).toBeInTheDocument();
    expect(screen.getByTestId('add-photo-tile')).toBeInTheDocument();
  });

  it('hides the Add tile when at maxPhotos', () => {
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        maxPhotos={3}
      />,
    );
    expect(screen.queryByTestId('add-photo-tile')).toBeNull();
  });

  it('marks the first slot as Cover only', () => {
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        maxPhotos={10}
      />,
    );
    expect(screen.getAllByText('Cover')).toHaveLength(1);
  });

  it('renders a quality pill only on slots that have been scored', () => {
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        maxPhotos={10}
      />,
    );
    const pills = screen.getAllByTestId('quality-pill');
    expect(pills).toHaveLength(2);
    expect(pills.map((p) => p.textContent)).toEqual(['78', '25']);
  });

  it('fires onCropEdit with the slot index when the edit button is clicked', async () => {
    const user = userEvent.setup();
    const onCropEdit = vi.fn();
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={onCropEdit}
        onRemove={() => {}}
        maxPhotos={10}
      />,
    );
    await user.click(screen.getByLabelText('Crop photo 2'));
    expect(onCropEdit).toHaveBeenCalledWith(1);
  });

  it('fires onRemove with the slot index when the remove button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={onRemove}
        maxPhotos={10}
      />,
    );
    await user.click(screen.getByLabelText('Remove photo 3'));
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('fires onAdd when the Add tile is clicked', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        onAdd={onAdd}
        maxPhotos={10}
      />,
    );
    await user.click(screen.getByTestId('add-photo-tile'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('exposes accessible drag handles with descriptive labels', () => {
    render(
      <SortablePhotoGrid
        photos={SAMPLE}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        maxPhotos={10}
      />,
    );
    expect(screen.getByLabelText('Drag to reorder photo 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag to reorder photo 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag to reorder photo 3')).toBeInTheDocument();
  });

  it('renders with no photos and only the Add tile when given an empty list', () => {
    render(
      <SortablePhotoGrid
        photos={[]}
        onReorder={() => {}}
        onCropEdit={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        maxPhotos={10}
      />,
    );
    expect(screen.queryByTestId('photo-slot-0')).toBeNull();
    expect(screen.getByTestId('add-photo-tile')).toBeInTheDocument();
  });
});
