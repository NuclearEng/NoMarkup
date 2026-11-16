// useAdmin — the moderation / rollout half of the admin hook module that
// useAdmin.test.ts does not reach: goods listings, the three report queues,
// market rollout, goods disputes, feature flags, insurers and the read-only
// fee config. Each case pins the URL (including which params are dropped from
// the query string), the query key, the request body and the exact set of
// cache invalidations, plus the failure path.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSURANCE_PRODUCT_TYPE,
  INSURER_STATUS,
  useAdminFlags,
  useAdminGoodsDisputes,
  useAdminInsurers,
  useAdminJobReports,
  useAdminListings,
  useAdminMarkets,
  useAdminReports,
  useAdminUserReports,
  useCancelListing,
  useFeeConfig,
  useOnboardInsurer,
  useReactivateListing,
  useResolveGoodsDispute,
  useResolveJobReport,
  useResolveReport,
  useResolveUserReport,
  useSetMarketsActive,
  useSuspendListing,
  useToggleFlag,
  useUpdateInsurer,
} from '@/hooks/useAdmin';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { api } = await import('@/lib/api');

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

interface QueryState {
  isSuccess: boolean;
  isError: boolean;
  data: unknown;
  error: unknown;
}

interface QueryCase {
  name: string;
  use: () => QueryState;
  url: string;
  key: readonly unknown[];
}

const listingParams = {
  q: 'drill',
  status: 'active',
  seller_id: 'seller-1',
  hidden: 'true',
  page: 2,
  page_size: 50,
} as const;

const QUERY_CASES: QueryCase[] = [
  {
    name: 'useFeeConfig (platform default)',
    use: () => useFeeConfig(),
    url: '/api/v1/admin/payments/fee-config',
    key: ['admin', 'fee-config', undefined],
  },
  {
    name: 'useFeeConfig (category override)',
    use: () => useFeeConfig('cat-9'),
    url: '/api/v1/admin/payments/fee-config?category_id=cat-9',
    key: ['admin', 'fee-config', 'cat-9'],
  },
  {
    name: 'useAdminListings (no params)',
    use: () => useAdminListings(),
    url: '/api/v1/admin/listings',
    key: ['admin', 'listings', undefined],
  },
  {
    name: 'useAdminListings (all params)',
    use: () => useAdminListings(listingParams),
    url: '/api/v1/admin/listings?q=drill&status=active&seller_id=seller-1&hidden=true&page=2&page_size=50',
    key: ['admin', 'listings', listingParams],
  },
  {
    name: 'useAdminListings (empty strings are dropped from the query)',
    use: () => useAdminListings({ q: '', status: '', page: 1 }),
    url: '/api/v1/admin/listings?page=1',
    key: ['admin', 'listings', { q: '', status: '', page: 1 }],
  },
  {
    name: 'useAdminReports (no params)',
    use: () => useAdminReports(),
    url: '/api/v1/admin/goods-reports',
    key: ['admin', 'goods-reports', undefined],
  },
  {
    name: 'useAdminReports (filtered)',
    use: () => useAdminReports({ status: 'pending', listing_id: 'l-1', page: 3, page_size: 10 }),
    url: '/api/v1/admin/goods-reports?status=pending&listing_id=l-1&page=3&page_size=10',
    key: ['admin', 'goods-reports', { status: 'pending', listing_id: 'l-1', page: 3, page_size: 10 }],
  },
  {
    name: 'useAdminJobReports (no params)',
    use: () => useAdminJobReports(),
    url: '/api/v1/admin/job-reports',
    key: ['admin', 'job-reports', undefined],
  },
  {
    name: 'useAdminJobReports (filtered)',
    use: () => useAdminJobReports({ status: 'reviewed', job_id: 'j-1', page: 1, page_size: 25 }),
    url: '/api/v1/admin/job-reports?status=reviewed&job_id=j-1&page=1&page_size=25',
    key: ['admin', 'job-reports', { status: 'reviewed', job_id: 'j-1', page: 1, page_size: 25 }],
  },
  {
    name: 'useAdminUserReports (no params)',
    use: () => useAdminUserReports(),
    url: '/api/v1/admin/user-reports',
    key: ['admin', 'user-reports', undefined],
  },
  {
    name: 'useAdminUserReports (filtered)',
    use: () => useAdminUserReports({ status: 'pending', reported_user_id: 'u-7', page: 2 }),
    url: '/api/v1/admin/user-reports?status=pending&reported_user_id=u-7&page=2',
    key: ['admin', 'user-reports', { status: 'pending', reported_user_id: 'u-7', page: 2 }],
  },
  {
    name: 'useAdminMarkets',
    use: () => useAdminMarkets(),
    url: '/api/v1/admin/markets',
    key: ['admin', 'markets'],
  },
  {
    name: 'useAdminGoodsDisputes (no params)',
    use: () => useAdminGoodsDisputes(),
    url: '/api/v1/admin/disputes/goods',
    key: ['admin', 'goods-disputes', undefined],
  },
  {
    name: 'useAdminGoodsDisputes (filtered)',
    use: () => useAdminGoodsDisputes({ status: 'open', page: 4, page_size: 5 }),
    url: '/api/v1/admin/disputes/goods?status=open&page=4&page_size=5',
    key: ['admin', 'goods-disputes', { status: 'open', page: 4, page_size: 5 }],
  },
  {
    name: 'useAdminFlags',
    use: () => useAdminFlags(),
    url: '/api/v1/admin/flags',
    key: ['admin', 'flags'],
  },
  {
    name: 'useAdminInsurers',
    use: () => useAdminInsurers(),
    url: '/api/v1/admin/insurers',
    key: ['admin', 'insurers'],
  },
];

describe('useAdmin moderation queries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it.each(QUERY_CASES)('$name GETs the right URL under the right key', async ({ use, url, key }) => {
    const payload = { marker: url };
    vi.mocked(api.get).mockResolvedValueOnce(payload);

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(url);
    expect(result.current.data).toEqual(payload);
    // The data is cached under exactly the documented key — mutations below
    // rely on prefix-matching these keys to refresh the right lists.
    expect(queryClient.getQueryData(key)).toEqual(payload);
  });

  it.each(QUERY_CASES)('$name surfaces a failed request as an error', async ({ use, key }) => {
    const failure = new Error('gateway 500');
    vi.mocked(api.get).mockRejectedValueOnce(failure);

    const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});

interface MutationHandle {
  isSuccess: boolean;
  isError: boolean;
  fire: () => void;
}

interface MutationCase {
  name: string;
  use: () => MutationHandle;
  method: 'post' | 'put';
  args: readonly unknown[];
  invalidates: readonly (readonly unknown[])[];
}

const rateCard = [
  {
    product_type: INSURANCE_PRODUCT_TYPE.WORKMANSHIP,
    base_rate_bps: 250,
    min_premium_cents: 1500,
  },
];

const MUTATION_CASES: MutationCase[] = [
  {
    name: 'useSuspendListing',
    use: () => {
      const m = useSuspendListing();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ listingId: 'l-1', reason: 'counterfeit' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/listings/l-1/suspend', { reason: 'counterfeit' }],
    invalidates: [['admin', 'listings']],
  },
  {
    name: 'useReactivateListing',
    use: () => {
      const m = useReactivateListing();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ listingId: 'l-2' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/listings/l-2/reactivate', {}],
    invalidates: [['admin', 'listings']],
  },
  {
    name: 'useCancelListing',
    use: () => {
      const m = useCancelListing();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ listingId: 'l-3', reason: 'seller request' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/listings/l-3/cancel', { reason: 'seller request' }],
    invalidates: [['admin', 'listings']],
  },
  {
    name: 'useResolveReport',
    use: () => {
      const m = useResolveReport();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ reportId: 'r-1', action: 'actioned', notes: 'removed' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/goods-reports/r-1/resolve', { action: 'actioned', notes: 'removed' }],
    invalidates: [
      ['admin', 'goods-reports'],
      ['admin', 'listings'],
    ],
  },
  {
    name: 'useResolveJobReport',
    use: () => {
      const m = useResolveJobReport();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ reportId: 'r-2', action: 'dismiss', notes: 'not abuse' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/job-reports/r-2/resolve', { action: 'dismiss', notes: 'not abuse' }],
    invalidates: [
      ['admin', 'job-reports'],
      ['admin', 'jobs'],
    ],
  },
  {
    name: 'useResolveUserReport',
    use: () => {
      const m = useResolveUserReport();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ reportId: 'r-3', action: 'review', notes: 'escalated' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/user-reports/r-3/resolve', { action: 'review', notes: 'escalated' }],
    invalidates: [['admin', 'user-reports']],
  },
  {
    name: 'useSetMarketsActive',
    use: () => {
      const m = useSetMarketsActive();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ region_code: 'WA', country: 'US', active: true });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/markets/activate', { region_code: 'WA', country: 'US', active: true }],
    // Both the admin catalog AND the public selector cache must refresh.
    invalidates: [['admin', 'markets'], ['markets']],
  },
  {
    name: 'useResolveGoodsDispute (explicit split)',
    use: () => {
      const m = useResolveGoodsDispute();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({
            disputeId: 'd-1',
            resolution: 'refund_partial',
            refund_to_buyer_cents: 4000,
            transfer_to_seller_cents: 6000,
            notes: 'split',
          });
        },
      };
    },
    method: 'post',
    args: [
      '/api/v1/admin/disputes/goods/d-1/resolve',
      {
        resolution: 'refund_partial',
        refund_to_buyer_cents: 4000,
        transfer_to_seller_cents: 6000,
        notes: 'split',
      },
    ],
    invalidates: [
      ['admin', 'goods-disputes'],
      ['admin', 'listings'],
    ],
  },
  {
    name: 'useResolveGoodsDispute (omitted amounts default to 0 cents)',
    use: () => {
      const m = useResolveGoodsDispute();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ disputeId: 'd-2', resolution: 'no_action', notes: 'unfounded' });
        },
      };
    },
    method: 'post',
    args: [
      '/api/v1/admin/disputes/goods/d-2/resolve',
      {
        resolution: 'no_action',
        refund_to_buyer_cents: 0,
        transfer_to_seller_cents: 0,
        notes: 'unfounded',
      },
    ],
    invalidates: [
      ['admin', 'goods-disputes'],
      ['admin', 'listings'],
    ],
  },
  {
    name: 'useToggleFlag (enabled only — rollout_percent left out of the body)',
    use: () => {
      const m = useToggleFlag();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ key: 'instant_match', enabled: false });
        },
      };
    },
    method: 'put',
    args: ['/api/v1/admin/flags/instant_match', { enabled: false }],
    invalidates: [['admin', 'flags'], ['feature-flags']],
  },
  {
    name: 'useToggleFlag (rollout_percent 0 is sent, not treated as absent)',
    use: () => {
      const m = useToggleFlag();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ key: 'smart_matching', enabled: true, rollout_percent: 0 });
        },
      };
    },
    method: 'put',
    args: ['/api/v1/admin/flags/smart_matching', { enabled: true, rollout_percent: 0 }],
    invalidates: [['admin', 'flags'], ['feature-flags']],
  },
  {
    name: 'useOnboardInsurer (products travel as rate_card)',
    use: () => {
      const m = useOnboardInsurer();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ name: 'Acme Mutual', slug: 'acme-mutual', products: rateCard });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/admin/insurers', { name: 'Acme Mutual', slug: 'acme-mutual', rate_card: rateCard }],
    invalidates: [['admin', 'insurers']],
  },
  {
    name: 'useUpdateInsurer (status only — no rate_card key)',
    use: () => {
      const m = useUpdateInsurer();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ id: 'ins-1', status: INSURER_STATUS.APPROVED });
        },
      };
    },
    method: 'put',
    args: ['/api/v1/admin/insurers/ins-1', { status: 'approved' }],
    invalidates: [['admin', 'insurers']],
  },
  {
    name: 'useUpdateInsurer (products travel as rate_card)',
    use: () => {
      const m = useUpdateInsurer();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ id: 'ins-2', status: INSURER_STATUS.SUSPENDED, products: rateCard });
        },
      };
    },
    method: 'put',
    args: ['/api/v1/admin/insurers/ins-2', { status: 'suspended', rate_card: rateCard }],
    invalidates: [['admin', 'insurers']],
  },
];

describe('useAdmin moderation mutations', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it.each(MUTATION_CASES)(
    '$name sends the request and invalidates exactly its caches',
    async ({ use, method, args, invalidates }) => {
      vi.mocked(api[method]).mockResolvedValueOnce({});
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
      result.current.fire();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(api[method])).toHaveBeenCalledTimes(1);
      const call = vi.mocked(api[method]).mock.calls[0];
      // toStrictEqual: an `undefined`-valued key (e.g. rate_card) must be
      // absent from the body, not merely undefined.
      expect(call).toStrictEqual([...args]);
      expect(invalidateSpy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
        invalidates.map((key) => [...key]),
      );
    },
  );

  it.each(MUTATION_CASES)(
    '$name leaves every cache alone when the request fails',
    async ({ use, method }) => {
      vi.mocked(api[method]).mockRejectedValueOnce(new Error('403'));
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper: createWrapper(queryClient) });
      result.current.fire();

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    },
  );
});
