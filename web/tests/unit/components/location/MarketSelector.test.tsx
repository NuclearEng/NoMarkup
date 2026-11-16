import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Market } from '@/types';

const marketsState: { data: Market[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const recentsState: { recents: Market[] } = { recents: [] };
const pushRecent = vi.fn<(m: Market) => void>();
const marketsOptions: unknown[] = [];

vi.mock('@/hooks/useMarkets', () => ({
  useMarkets: (options: unknown) => {
    marketsOptions.push(options);
    return marketsState;
  },
}));

vi.mock('@/hooks/useSelectedMarket', () => ({
  useRecentMarkets: () => [recentsState.recents, pushRecent],
}));

import { MarketSelector } from '@/components/location/MarketSelector';

function market(overrides: Partial<Market> & { slug: string }): Market {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    region: 'Washington',
    region_code: 'WA',
    country: 'US',
    is_active: true,
    lat: null,
    lng: null,
    ...overrides,
  };
}

const seattle = market({ slug: 'seattle', name: 'seattle-tacoma', lat: 47.6, lng: -122.3 });
const olympia = market({ slug: 'olympia', name: 'olympic peninsula', lat: 47.0, lng: -122.9 });
const portland = market({
  slug: 'portland',
  name: 'portland',
  region: 'Oregon',
  region_code: 'OR',
  lat: 45.5,
  lng: -122.7,
});
const tijuana = market({
  slug: 'tijuana',
  name: 'tijuana',
  region: null,
  region_code: null,
  country: 'MX',
  lat: 32.5,
  lng: -117.0,
});
const guam = market({ slug: 'guam', name: 'guam-micronesia', region: null, region_code: null });
const dormant = market({ slug: 'boise', name: 'boise', region: 'Idaho', region_code: 'ID', is_active: false });

const onSelect = vi.fn<(m: Market | null) => void>();

function openPicker(): void {
  fireEvent.click(screen.getByLabelText('Select a city or market'));
}

function optionNames(): (string | null)[] {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

function stubGeolocation(
  impl: (success: PositionCallback, error?: PositionErrorCallback | null) => void,
): ReturnType<typeof vi.fn> {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

function position(latitude: number, longitude: number): GeolocationPosition {
  return { coords: { latitude, longitude } } as GeolocationPosition;
}

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {
        // no-op
      }
      unobserve(): void {
        // no-op
      }
      disconnect(): void {
        // no-op
      }
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  Element.prototype.scrollIntoView = (): void => {
    // no-op
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  marketsOptions.length = 0;
  marketsState.data = [seattle, olympia, portland, tijuana, guam, dormant];
  marketsState.isLoading = false;
  recentsState.recents = [];
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('MarketSelector trigger', () => {
  it('shows the default placeholder and passes the country filter to the catalog query', () => {
    render(<MarketSelector onSelect={onSelect} country="MX" />);
    expect(screen.getByLabelText('Select a city or market')).toHaveTextContent('Choose a city');
    expect(marketsOptions[0]).toEqual({ country: 'MX' });
  });

  it('shows a custom placeholder when the value does not match a launched market', () => {
    render(<MarketSelector onSelect={onSelect} value="boise" placeholder="Where are you?" compact id="mkt" />);
    const trigger = screen.getByLabelText('Select a city or market');
    expect(trigger).toHaveTextContent('Where are you?');
    expect(trigger).toHaveAttribute('id', 'mkt');
    expect(trigger).toHaveClass('h-9', 'text-muted-foreground');
  });

  it('title-cases the selected market and appends its region code', () => {
    render(<MarketSelector onSelect={onSelect} value="seattle" />);
    const trigger = screen.getByLabelText('Select a city or market');
    expect(trigger).toHaveTextContent('Seattle-Tacoma, WA');
    expect(trigger).not.toHaveClass('text-muted-foreground');
  });

  it('omits the region code for markets without one', () => {
    render(<MarketSelector onSelect={onSelect} value="tijuana" />);
    expect(screen.getByLabelText('Select a city or market')).toHaveTextContent(/^Tijuana$/);
  });
});

describe('MarketSelector browse list', () => {
  it('shows a loading row while the catalog loads', () => {
    marketsState.data = undefined;
    marketsState.isLoading = true;
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    expect(screen.getByText('Loading cities…')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('explains when no markets are live (inactive ones never leak in)', () => {
    marketsState.data = [dormant];
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    expect(screen.getByText('No markets are live yet.')).toBeInTheDocument();
    expect(screen.queryByText('Boise')).not.toBeInTheDocument();
  });

  it('groups launched markets by region, with Mexico and Other buckets', () => {
    render(<MarketSelector onSelect={onSelect} value="portland" />);
    openPicker();
    const listbox = screen.getByRole('listbox', { name: 'Cities' });
    for (const region of ['Washington', 'Oregon', 'Mexico', 'Other']) {
      expect(within(listbox).getByText(region)).toBeInTheDocument();
    }
    expect(optionNames()).toEqual([
      'Seattle-Tacoma',
      'Olympic Peninsula',
      'Portland',
      'Tijuana',
      'Guam-Micronesia',
    ]);
    expect(screen.getByRole('option', { name: 'Portland' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Tijuana' })).toHaveAttribute('aria-selected', 'false');
  });

  it('filters by city name, region name and exact region code', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const search = screen.getByLabelText('Search cities');

    fireEvent.change(search, { target: { value: 'olymp' } });
    expect(optionNames()).toEqual(['Olympic Peninsula']);

    fireEvent.change(search, { target: { value: 'mexico' } });
    expect(optionNames()).toEqual(['Tijuana']);

    fireEvent.change(search, { target: { value: ' OR ' } });
    expect(optionNames()).toEqual(['Portland']);
  });

  it('tells the user when nothing matches the search', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.change(screen.getByLabelText('Search cities'), { target: { value: 'zzz' } });
    expect(screen.getByText('No cities match “zzz”.')).toBeInTheDocument();
    expect(screen.getByLabelText('Search cities')).not.toHaveAttribute('aria-activedescendant');
  });

  it('selects a clicked city, records it as recent and closes the picker', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Portland' }));
    expect(onSelect).toHaveBeenCalledWith(portland);
    expect(pushRecent).toHaveBeenCalledWith(portland);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('MarketSelector keyboard navigation', () => {
  it('moves the active option with arrows (clamped) and picks it with Enter', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const search = screen.getByLabelText('Search cities');
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-0');

    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-0');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-2');
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-4');

    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'a' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(tijuana);
  });

  it('resets the active option when the search changes and ignores Enter with no results', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const search = screen.getByLabelText('Search cities');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.change(search, { target: { value: 'port' } });
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-0');

    fireEvent.change(search, { target: { value: 'zzz' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('follows the pointer and closes on Escape without selecting', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const search = screen.getByLabelText('Search cities');
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Portland' }));
    expect(search).toHaveAttribute('aria-activedescendant', 'market-opt-2');

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('MarketSelector shortcuts', () => {
  it('shows no shortcut section without recents or a located selection', () => {
    render(<MarketSelector onSelect={onSelect} value="guam" />);
    openPicker();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Near /)).not.toBeInTheDocument();
  });

  it('lists only still-launched recents (max four) and hides them while searching', () => {
    recentsState.recents = [dormant, portland, tijuana, seattle, olympia, guam];
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const recent = screen.getByText('Recent').parentElement;
    expect(recent).not.toBeNull();
    if (!recent) return;
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Portland',
      'Tijuana',
      'Seattle-Tacoma',
      'Olympic Peninsula',
    ]);

    fireEvent.change(screen.getByLabelText('Search cities'), { target: { value: 'p' } });
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('picks a recent market from its chip', () => {
    recentsState.recents = [tijuana];
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    const recent = screen.getByText('Recent').parentElement;
    if (!recent) throw new Error('recent section missing');
    fireEvent.click(within(recent).getByRole('button', { name: 'Tijuana' }));
    expect(onSelect).toHaveBeenCalledWith(tijuana);
    expect(pushRecent).toHaveBeenCalledWith(tijuana);
  });

  it('lists other located markets nearest-first, excluding the selection and markets without coordinates', () => {
    render(<MarketSelector onSelect={onSelect} value="seattle" />);
    openPicker();
    const near = screen.getByText('Near Seattle-Tacoma').parentElement;
    if (!near) throw new Error('nearby section missing');
    expect(within(near).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Olympic Peninsula',
      'Portland',
      'Tijuana',
    ]);
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });
});

describe('MarketSelector clear', () => {
  it('clears the selection and closes', () => {
    render(<MarketSelector onSelect={onSelect} value="seattle" />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(pushRecent).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('offers no clear action when not clearable or nothing is selected', () => {
    const { unmount } = render(<MarketSelector onSelect={onSelect} value="seattle" clearable={false} />);
    openPicker();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
    unmount();

    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
  });
});

describe('MarketSelector "Use my location"', () => {
  it('reports when the browser has no geolocation support', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Location is not available in this browser.');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('picks the nearest launched market for the detected position', () => {
    const getCurrentPosition = stubGeolocation((success) => {
      success(position(45.6, -122.6));
    });
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300000,
    });
    expect(onSelect).toHaveBeenCalledWith(portland);
    expect(pushRecent).toHaveBeenCalledWith(portland);
  });

  it('says so when no launched market has coordinates', () => {
    marketsState.data = [guam];
    stubGeolocation((success) => {
      success(position(13.4, 144.8));
    });
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No launched markets near you yet.');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a busy state while locating, then a recoverable error when permission is denied', () => {
    let fail: PositionErrorCallback | null | undefined;
    stubGeolocation((_success, error) => {
      fail = error;
    });
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('button', { name: 'Locating…' })).toBeDisabled();

    act(() => {
      fail?.({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't get your location. Pick a city below.");
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  });

  it('clears a previous location error once a city is picked', () => {
    render(<MarketSelector onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Portland' }));
    openPicker();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
