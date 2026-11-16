// Small data hooks that had no tests: category questions / job answers, chat
// relay aliases, chat templates, NPS, quote templates, referrals, seller
// analytics, user reports and the wishlist. Each case pins the endpoint, the
// request body (including defaulted / omitted fields), the cache key, the
// `enabled` guard, the invalidation, and the toast on success / failure.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCategoryQuestions,
  useJobAnswers,
  useSubmitJobAnswers,
} from '@/hooks/useCategoryQuestions';
import { useChatAliases, useCreateChatAlias } from '@/hooks/useChatRelay';
import {
  useChatTemplates,
  useCreateChatTemplate,
  useDeleteChatTemplate,
  useUpdateChatTemplate,
  useUseChatTemplate,
} from '@/hooks/useChatTemplates';
import { usePendingNPS, useSubmitNPS } from '@/hooks/useNPS';
import {
  useCreateQuoteTemplate,
  useDeleteQuoteTemplate,
  useIncrementQuoteTemplateUse,
  useQuoteTemplates,
  useUpdateQuoteTemplate,
} from '@/hooks/useQuoteTemplates';
import { useMyReferrals, useRedeemReferral, useReferralCode } from '@/hooks/useReferrals';
import { useSellerAnalytics } from '@/hooks/useSellerAnalytics';
import { REPORT_REASONS, useReportUser } from '@/hooks/useUserReports';
import {
  useCreateWishlistItem,
  useDeleteWishlistItem,
  useWishlist,
} from '@/hooks/useWishlist';
import type {
  CreateChatAliasInput,
  CreateQuoteTemplateInput,
  SubmitAnswersInput,
  UpdateQuoteTemplateInput,
} from '@/types';

// Keep the real ApiError / getApiErrorMessage so the error-unwrapping branches
// are exercised for real; only the transport is stubbed.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { api, ApiError } = await import('@/lib/api');
const { toast } = await import('sonner');

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: {
      // retryDelay 0 keeps the tests that opt into retries fast.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

afterEach(() => {
  queryClient.clear();
});

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey);
}

// ─── Queries ──────────────────────────────────────────

interface QueryState {
  isSuccess: boolean;
  isError: boolean;
  data: unknown;
}

interface QueryCase {
  name: string;
  use: () => QueryState;
  url: string;
  key: readonly unknown[];
  response: unknown;
  /** What the hook exposes as `data` (some hooks unwrap the envelope). */
  data: unknown;
}

const QUERY_CASES: QueryCase[] = [
  {
    name: 'useCategoryQuestions unwraps `questions`',
    use: () => useCategoryQuestions('cat-1'),
    url: '/api/v1/categories/cat-1/questions',
    key: ['categoryQuestions', 'cat-1'],
    response: { questions: [{ id: 'q-1' }] },
    data: [{ id: 'q-1' }],
  },
  {
    name: 'useJobAnswers unwraps `answers`',
    use: () => useJobAnswers('job-1'),
    url: '/api/v1/jobs/job-1/answers',
    key: ['jobAnswers', 'job-1'],
    response: { answers: [{ question_id: 'q-1' }] },
    data: [{ question_id: 'q-1' }],
  },
  {
    name: 'useChatAliases',
    use: () => useChatAliases(),
    url: '/api/v1/me/chat/aliases',
    key: ['chat-aliases'],
    response: { aliases: [] },
    data: { aliases: [] },
  },
  {
    name: 'useChatTemplates',
    use: () => useChatTemplates(),
    url: '/api/v1/me/chat/templates',
    key: ['chat-templates'],
    response: { templates: [], defaults: ['On my way'] },
    data: { templates: [], defaults: ['On my way'] },
  },
  {
    name: 'usePendingNPS',
    use: () => usePendingNPS(),
    url: '/api/v1/me/nps/pending',
    key: ['nps', 'pending'],
    response: { pending: [] },
    data: { pending: [] },
  },
  {
    name: 'useQuoteTemplates unwraps `templates`',
    use: () => useQuoteTemplates(),
    url: '/api/v1/providers/me/quote-templates',
    key: ['quoteTemplates'],
    response: { templates: [{ id: 't-1' }] },
    data: [{ id: 't-1' }],
  },
  {
    name: 'useReferralCode',
    use: () => useReferralCode(),
    url: '/api/v1/me/referrals/code',
    key: ['referrals', 'code'],
    response: { code: 'ABC123' },
    data: { code: 'ABC123' },
  },
  {
    name: 'useMyReferrals',
    use: () => useMyReferrals(),
    url: '/api/v1/me/referrals',
    key: ['referrals', 'list'],
    response: { code: 'ABC123', referrals: [], credit_balance_cents: 0 },
    data: { code: 'ABC123', referrals: [], credit_balance_cents: 0 },
  },
  {
    name: 'useSellerAnalytics defaults to a 30d range',
    use: () => useSellerAnalytics(),
    url: '/api/v1/me/seller-analytics?range=30d',
    key: ['seller-analytics', '30d'],
    response: { daily: [] },
    data: { daily: [] },
  },
  {
    name: 'useSellerAnalytics with an explicit range',
    use: () => useSellerAnalytics('90d'),
    url: '/api/v1/me/seller-analytics?range=90d',
    key: ['seller-analytics', '90d'],
    response: { daily: [] },
    data: { daily: [] },
  },
  {
    name: 'useWishlist',
    use: () => useWishlist(),
    url: '/api/v1/me/wishlist',
    key: ['wishlist'],
    response: { wishlist_items: [] },
    data: { wishlist_items: [] },
  },
];

describe('account / chat query hooks', () => {
  it.each(QUERY_CASES)('$name', async ({ use, url, key, response, data }) => {
    vi.mocked(api.get).mockResolvedValueOnce(response);

    const { result } = renderHook(use, { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(url);
    expect(result.current.data).toEqual(data);
    expect(queryClient.getQueryData(key)).toEqual(data);
  });

  it.each(QUERY_CASES)('$name → error state on a failed request', async ({ use }) => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('500'));

    const { result } = renderHook(use, { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('enabled guards', () => {
  interface GuardCase {
    name: string;
    use: () => { fetchStatus: string; isPending: boolean };
  }

  const cases: GuardCase[] = [
    { name: 'useCategoryQuestions(undefined)', use: () => useCategoryQuestions(undefined) },
    { name: "useCategoryQuestions('')", use: () => useCategoryQuestions('') },
    { name: 'useJobAnswers(undefined)', use: () => useJobAnswers(undefined) },
    { name: 'useChatAliases(false)', use: () => useChatAliases(false) },
    { name: 'useQuoteTemplates({ enabled: false })', use: () => useQuoteTemplates({ enabled: false }) },
    { name: 'useWishlist({ enabled: false })', use: () => useWishlist({ enabled: false }) },
  ];

  it.each(cases)('$name never hits the network', ({ use }) => {
    const { result } = renderHook(use, { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('the disabled id-less queries resolve to an empty list if fetched anyway', async () => {
    // Keyed under '' — a forced fetch (e.g. refetch()) short-circuits to []
    // instead of requesting `/categories/undefined/questions`.
    const questions = renderHook(() => useCategoryQuestions(undefined), { wrapper });
    const answers = renderHook(() => useJobAnswers(undefined), { wrapper });

    const [q, a] = await Promise.all([
      questions.result.current.refetch(),
      answers.result.current.refetch(),
    ]);

    expect(q.data).toEqual([]);
    expect(a.data).toEqual([]);
    expect(queryClient.getQueryData(['categoryQuestions', ''])).toEqual([]);
    expect(queryClient.getQueryData(['jobAnswers', ''])).toEqual([]);
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('useCategoryQuestions keeps the previous category’s questions while the next loads', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ questions: [{ id: 'old' }] });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCategoryQuestions(id),
      { wrapper, initialProps: { id: 'cat-1' } },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => undefined));
    rerender({ id: 'cat-2' });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual([{ id: 'old' }]);
    expect(vi.mocked(api.get)).toHaveBeenLastCalledWith('/api/v1/categories/cat-2/questions');
  });

  it('useQuoteTemplates honours a caller-supplied retry count', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ templates: [{ id: 't-9' }] });
    queryClient.setDefaultOptions({ queries: { retryDelay: 0, gcTime: 0 } });

    const { result } = renderHook(() => useQuoteTemplates({ retry: 1 }), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([{ id: 't-9' }]);
  });

  // More retry-policy cases: useQuoteTemplates.retry.test.tsx.
  it('useQuoteTemplates without a retry option inherits the client-level retry policy', async () => {
    // The QueryClient default here is `retry: false`: one request, no retries.
    vi.mocked(api.get).mockRejectedValue(new Error('503'));

    const { result } = renderHook(() => useQuoteTemplates(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });

  it('useChatAliases does not retry a failure', async () => {
    queryClient.setDefaultOptions({ queries: { retry: 3, retryDelay: 0, gcTime: 0 } });
    vi.mocked(api.get).mockRejectedValue(new Error('404'));

    const { result } = renderHook(() => useChatAliases(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});

// ─── Mutations ────────────────────────────────────────

interface MutationHandle {
  isSuccess: boolean;
  isError: boolean;
  fire: () => void;
}

interface MutationCase {
  name: string;
  use: () => MutationHandle;
  method: 'post' | 'patch' | 'delete';
  args: readonly unknown[];
  response?: unknown;
  invalidates: readonly (readonly unknown[])[];
  successToast?: string;
  /** Toast shown when the request fails with a plain Error('boom'). */
  errorToast?: string;
}

const answersInput = { answers: [] } as unknown as SubmitAnswersInput;
const aliasInput = { channel_id: 'ch-1' } as unknown as CreateChatAliasInput;
const createTemplateInput = { name: 'Standard' } as unknown as CreateQuoteTemplateInput;
const updateTemplateInput = { name: 'Renamed' } as unknown as UpdateQuoteTemplateInput;

const MUTATION_CASES: MutationCase[] = [
  {
    name: 'useSubmitJobAnswers',
    use: () => {
      const m = useSubmitJobAnswers('job-1');
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate(answersInput);
        },
      };
    },
    method: 'post',
    args: ['/api/v1/jobs/job-1/answers', answersInput],
    invalidates: [['jobAnswers', 'job-1']],
  },
  {
    name: 'useCreateChatAlias',
    use: () => {
      const m = useCreateChatAlias();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate(aliasInput);
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/chat/aliases', aliasInput],
    invalidates: [['chat-aliases']],
  },
  {
    name: 'useCreateChatTemplate',
    use: () => {
      const m = useCreateChatTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ body: 'On my way' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/chat/templates', { body: 'On my way' }],
    invalidates: [['chat-templates']],
  },
  {
    name: 'useUpdateChatTemplate (id goes in the path, not the body)',
    use: () => {
      const m = useUpdateChatTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ id: 'tpl-1', body: 'Running late' });
        },
      };
    },
    method: 'patch',
    args: ['/api/v1/me/chat/templates/tpl-1', { body: 'Running late' }],
    invalidates: [['chat-templates']],
  },
  {
    name: 'useDeleteChatTemplate',
    use: () => {
      const m = useDeleteChatTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('tpl-2');
        },
      };
    },
    method: 'delete',
    args: ['/api/v1/me/chat/templates/tpl-2'],
    invalidates: [['chat-templates']],
  },
  {
    name: 'useUseChatTemplate',
    use: () => {
      const m = useUseChatTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('tpl-3');
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/chat/templates/tpl-3/use'],
    invalidates: [['chat-templates']],
  },
  {
    name: 'useSubmitNPS (comment defaults to an empty string)',
    use: () => {
      const m = useSubmitNPS();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ id: 'nps-1', score: 9 });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/nps/nps-1', { score: 9, comment: '' }],
    invalidates: [['nps', 'pending']],
    successToast: 'Thanks for your feedback',
    errorToast: 'boom',
  },
  {
    name: 'useSubmitNPS (with a comment)',
    use: () => {
      const m = useSubmitNPS();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ id: 'nps-2', score: 3, comment: 'slow payout' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/nps/nps-2', { score: 3, comment: 'slow payout' }],
    invalidates: [['nps', 'pending']],
    successToast: 'Thanks for your feedback',
    errorToast: 'boom',
  },
  {
    name: 'useCreateQuoteTemplate',
    use: () => {
      const m = useCreateQuoteTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate(createTemplateInput);
        },
      };
    },
    method: 'post',
    args: ['/api/v1/providers/me/quote-templates', createTemplateInput],
    invalidates: [['quoteTemplates']],
  },
  {
    name: 'useUpdateQuoteTemplate',
    use: () => {
      const m = useUpdateQuoteTemplate('qt-1');
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate(updateTemplateInput);
        },
      };
    },
    method: 'patch',
    args: ['/api/v1/providers/me/quote-templates/qt-1', updateTemplateInput],
    invalidates: [['quoteTemplates']],
  },
  {
    name: 'useDeleteQuoteTemplate',
    use: () => {
      const m = useDeleteQuoteTemplate();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('qt-2');
        },
      };
    },
    method: 'delete',
    args: ['/api/v1/providers/me/quote-templates/qt-2'],
    invalidates: [['quoteTemplates']],
  },
  {
    name: 'useIncrementQuoteTemplateUse',
    use: () => {
      const m = useIncrementQuoteTemplateUse();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('qt-3');
        },
      };
    },
    method: 'post',
    args: ['/api/v1/providers/me/quote-templates/qt-3/use'],
    invalidates: [['quoteTemplates']],
  },
  {
    name: 'useRedeemReferral (toasts the server message)',
    use: () => {
      const m = useRedeemReferral();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('FRIEND10');
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/referrals/redeem', { code: 'FRIEND10' }],
    response: { redeemed: true, credit_cents: 1000, message: 'Credit applied' },
    invalidates: [['referrals']],
    successToast: 'Credit applied',
    errorToast: 'boom',
  },
  {
    name: 'useReportUser (optional context defaults to empty strings)',
    use: () => {
      const m = useReportUser();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ userId: 'u-1', reason: 'spam' });
        },
      };
    },
    method: 'post',
    args: [
      '/api/v1/users/u-1/report',
      { reason: 'spam', description: '', channel_id: '', message_id: '' },
    ],
    invalidates: [],
  },
  {
    name: 'useReportUser (with chat context)',
    use: () => {
      const m = useReportUser();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({
            userId: 'u-2',
            reason: 'harassment',
            description: 'threats',
            channelId: 'ch-9',
            messageId: 'msg-4',
          });
        },
      };
    },
    method: 'post',
    args: [
      '/api/v1/users/u-2/report',
      { reason: 'harassment', description: 'threats', channel_id: 'ch-9', message_id: 'msg-4' },
    ],
    invalidates: [],
  },
  {
    name: 'useCreateWishlistItem (no category → key omitted)',
    use: () => {
      const m = useCreateWishlistItem();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ keyword: 'table saw', max_price_cents: 30000 });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/wishlist', { keyword: 'table saw', max_price_cents: 30000 }],
    invalidates: [['wishlist']],
    successToast: 'Added to wishlist — we’ll alert you when a match goes live',
    errorToast: 'Failed to add to wishlist',
  },
  {
    name: 'useCreateWishlistItem (empty category is treated as none)',
    use: () => {
      const m = useCreateWishlistItem();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ keyword: 'lathe', max_price_cents: 90000, category_id: '' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/wishlist', { keyword: 'lathe', max_price_cents: 90000 }],
    invalidates: [['wishlist']],
    successToast: 'Added to wishlist — we’ll alert you when a match goes live',
    errorToast: 'Failed to add to wishlist',
  },
  {
    name: 'useCreateWishlistItem (with category)',
    use: () => {
      const m = useCreateWishlistItem();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate({ keyword: 'drill', max_price_cents: 5000, category_id: 'tools' });
        },
      };
    },
    method: 'post',
    args: ['/api/v1/me/wishlist', { keyword: 'drill', max_price_cents: 5000, category_id: 'tools' }],
    invalidates: [['wishlist']],
    successToast: 'Added to wishlist — we’ll alert you when a match goes live',
    errorToast: 'Failed to add to wishlist',
  },
  {
    name: 'useDeleteWishlistItem',
    use: () => {
      const m = useDeleteWishlistItem();
      return {
        isSuccess: m.isSuccess,
        isError: m.isError,
        fire: () => {
          m.mutate('wish-1');
        },
      };
    },
    method: 'delete',
    args: ['/api/v1/me/wishlist/wish-1'],
    invalidates: [['wishlist']],
    successToast: 'Removed from wishlist',
    errorToast: 'Failed to remove wishlist item',
  },
];

describe('account / chat mutation hooks', () => {
  it.each(MUTATION_CASES)(
    '$name → request, invalidation and success toast',
    async ({ use, method, args, response, invalidates, successToast }) => {
      vi.mocked(api[method]).mockResolvedValueOnce(response ?? {});
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper });
      result.current.fire();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(vi.mocked(api[method])).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api[method]).mock.calls[0]).toStrictEqual([...args]);
      expect(invalidatedKeys(invalidateSpy)).toEqual(invalidates.map((key) => [...key]));
      if (successToast === undefined) {
        expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      } else {
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(successToast);
      }
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    },
  );

  it.each(MUTATION_CASES)(
    '$name → failure invalidates nothing and toasts only where the hook owns the error',
    async ({ use, method, errorToast }) => {
      vi.mocked(api[method]).mockRejectedValueOnce(new Error('boom'));
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(use, { wrapper });
      result.current.fire();

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      if (errorToast === undefined) {
        expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      } else {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(errorToast);
      }
    },
  );
});

describe('error message unwrapping', () => {
  it('wishlist hooks surface the gateway’s own error string from an ApiError', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: 'You already track this keyword' })),
    );
    vi.mocked(api.delete).mockRejectedValueOnce(new ApiError(404, 'x'.repeat(300)));

    const create = renderHook(() => useCreateWishlistItem(), { wrapper });
    create.result.current.mutate({ keyword: 'drill', max_price_cents: 1 });
    await waitFor(() => {
      expect(create.result.current.isError).toBe(true);
    });
    expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('You already track this keyword');

    // A long non-JSON body (e.g. an HTML error page) falls back to the hook's copy.
    const remove = renderHook(() => useDeleteWishlistItem(), { wrapper });
    remove.result.current.mutate('wish-1');
    await waitFor(() => {
      expect(remove.result.current.isError).toBe(true);
    });
    expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('Failed to remove wishlist item');
  });

  it('NPS and referral hooks fall back to their own copy for a non-Error rejection', async () => {
    vi.mocked(api.post).mockRejectedValueOnce('nope').mockRejectedValueOnce('nope');

    const nps = renderHook(() => useSubmitNPS(), { wrapper });
    nps.result.current.mutate({ id: 'nps-1', score: 1 });
    await waitFor(() => {
      expect(nps.result.current.isError).toBe(true);
    });
    expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('Failed to submit');

    const redeem = renderHook(() => useRedeemReferral(), { wrapper });
    redeem.result.current.mutate('BAD');
    await waitFor(() => {
      expect(redeem.result.current.isError).toBe(true);
    });
    expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('Failed to redeem code');
  });
});

describe('REPORT_REASONS', () => {
  it('offers unique reason values ending in the catch-all', () => {
    const values = REPORT_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.at(-1)).toBe('other');
    expect(REPORT_REASONS.every((r) => r.label.length > 0)).toBe(true);
  });
});
