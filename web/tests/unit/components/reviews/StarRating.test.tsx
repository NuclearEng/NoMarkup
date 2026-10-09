import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StarRatingDisplay, StarRatingInput } from '@/components/reviews/StarRating';

describe('StarRatingDisplay', () => {
  it('renders 5 stars with correct aria-label', () => {
    render(createElement(StarRatingDisplay, { rating: 4 }));
    expect(screen.getByLabelText('Rating: 4 out of 5 stars')).toBeDefined();
  });

  it('shows the numeric value when showValue is true', () => {
    render(createElement(StarRatingDisplay, { rating: 4.7, showValue: true }));
    expect(screen.getByText('4.7')).toBeDefined();
  });

  it('hides the numeric value by default', () => {
    render(createElement(StarRatingDisplay, { rating: 3 }));
    expect(screen.queryByText('3.0')).toBeNull();
  });

  it('supports sm/md/lg sizes without crashing', () => {
    const { rerender } = render(createElement(StarRatingDisplay, { rating: 3, size: 'sm' }));
    expect(screen.getByLabelText('Rating: 3 out of 5 stars')).toBeDefined();
    rerender(createElement(StarRatingDisplay, { rating: 3, size: 'lg' }));
    expect(screen.getByLabelText('Rating: 3 out of 5 stars')).toBeDefined();
  });
});

describe('StarRatingInput', () => {
  it('renders 5 radio buttons', () => {
    render(
      createElement(StarRatingInput, {
        value: 0,
        onChange: vi.fn(),
        label: 'Quality rating',
      }),
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
  });

  it('exposes radiogroup with provided label', () => {
    render(
      createElement(StarRatingInput, {
        value: 0,
        onChange: vi.fn(),
        label: 'Communication',
      }),
    );
    expect(screen.getByRole('radiogroup', { name: 'Communication' })).toBeDefined();
  });

  it('falls back to default label when none supplied', () => {
    render(createElement(StarRatingInput, { value: 0, onChange: vi.fn() }));
    expect(screen.getByRole('radiogroup', { name: 'Star rating' })).toBeDefined();
  });

  it('calls onChange with star index when a star is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(createElement(StarRatingInput, { value: 0, onChange }));

    const fourthStar = screen.getByRole('radio', { name: '4 stars' });
    await user.click(fourthStar);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('marks the active value with aria-checked', () => {
    render(createElement(StarRatingInput, { value: 3, onChange: vi.fn() }));
    const activeStar = screen.getByRole('radio', { name: '3 stars' });
    expect(activeStar.getAttribute('aria-checked')).toBe('true');
  });

  it('clicks first star and gets 1', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(createElement(StarRatingInput, { value: 0, onChange }));
    await user.click(screen.getByRole('radio', { name: '1 star' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
