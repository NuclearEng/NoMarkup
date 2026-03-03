# NoMarkup Frontend State Management Specification

**Version:** 1.0
**Date:** March 2, 2026
**Stack:** Next.js 15 App Router, Zustand 5, TanStack Query 5, React Hook Form + Zod, Native WebSocket
**Constraints:** TypeScript strict mode, no `any`, const objects instead of enums, no Redux, no React Context for state

---

## 1. State Categories

Every piece of client state belongs to exactly one of the following categories. There are no exceptions.

| Category | Library | What Goes Here | Persistence |
|---|---|---|---|
| **Client State** | Zustand 5 | Auth session, UI preferences, WebSocket connection, notification toasts | Auth: memory + cookie signal; UI: `localStorage`; WS: memory only |
| **Server State** | TanStack Query 5 | ALL data from the API gateway: users, jobs, bids, contracts, payments, reviews, chat, analytics, categories, notifications, subscriptions, admin data | TanStack Query cache (memory); refetched on stale |
| **Form State** | React Hook Form + Zod | ALL form inputs, validation, submission lifecycle, field-level errors | Component-scoped; multi-step forms persist via Zustand |
| **URL State** | `searchParams` / `useSearchParams` | Filters, pagination, sort order, search queries, active tab, map viewport | URL (shareable, bookmarkable) |
| **Local Component State** | `useState` | Modal open/closed, tooltip visible, accordion expanded, hover state, temporary animations | Component-scoped; not persisted |

### Decision Rules

1. **"Does the server own this data?"** -- Yes: TanStack Query. No: continue.
2. **"Is this form input?"** -- Yes: React Hook Form. No: continue.
3. **"Should this survive a page refresh and be shareable via URL?"** -- Yes: URL `searchParams`. No: continue.
4. **"Does this need to be shared across multiple unrelated components?"** -- Yes: Zustand. No: continue.
5. **"Is this scoped to a single component's render cycle?"** -- Yes: `useState`. No: Zustand.

### Prohibited Patterns

- No React Context for state management. Context is permitted only for dependency injection (e.g., providing a configured API client to the tree).
- No `useReducer` for complex state -- use Zustand instead.
- No lifting state up more than one level -- if two siblings need shared state, use Zustand.
- No caching server data in Zustand -- TanStack Query owns all server data.
- No storing form values in Zustand -- React Hook Form owns all form state (except multi-step form persistence, which uses Zustand as a draft store).

---

## 2. Zustand Stores

All stores live under `src/stores/`. Each store is one file. Each file exports one hook.

### 2.1 `useAuthStore`

**File:** `src/stores/auth-store.ts`

```typescript
import { create } from 'zustand';
import type { User, UserRole } from '@/types';

interface AuthState {
  // State
  user: User | null;
  activeRole: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  lastActivity: number; // Unix timestamp (ms) for session timeout tracking

  // Actions
  setUser: (user: User) => void;
  clearUser: () => void;
  setActiveRole: (role: UserRole) => void;
  setLoading: (loading: boolean) => void;
  touchActivity: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  activeRole: null,
  isAuthenticated: false,
  isLoading: true,
  lastActivity: Date.now(),

  setUser: (user) =>
    set({
      user,
      isAuthenticated: true,
      isLoading: false,
      activeRole: user.roles[0] ?? null,
      lastActivity: Date.now(),
    }),

  clearUser: () =>
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      activeRole: null,
    }),

  setActiveRole: (role) => set({ activeRole: role }),
  setLoading: (loading) => set({ isLoading: loading }),
  touchActivity: () => set({ lastActivity: Date.now() }),
}));
```

**Persistence:** None. Auth state is derived from the HTTP-only session cookie. On app mount, a `GET /api/auth/me` call (via TanStack Query) hydrates this store. The store holds the deserialized user for synchronous access. The cookie is the source of truth.

**Session Timeout:** A `useSessionTimeout` hook reads `lastActivity` and compares against the role-based timeout (customer: 60 min, provider: 120 min, admin: 30 min). On timeout, it calls `clearUser()` and redirects to `/login`.

**Usage:**
```typescript
// In a component
const { user, isAuthenticated, activeRole } = useAuthStore();

// In a server action or middleware -- DO NOT use this store.
// Server-side auth reads the cookie directly.
```

---

### 2.2 `useUIStore`

**File:** `src/stores/ui-store.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;
type Theme = (typeof THEME)[keyof typeof THEME];

interface UIState {
  // State
  sidebarCollapsed: boolean;
  mobileMenuOpen: boolean;
  theme: Theme;
  analyticsOverlayVisible: boolean; // Shift+~ toggle (PRD FR-11.6)
  commandPaletteOpen: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleAnalyticsOverlay: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileMenuOpen: false,
      theme: THEME.SYSTEM,
      analyticsOverlayVisible: false,
      commandPaletteOpen: false,

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
      setTheme: (theme) => set({ theme }),
      toggleAnalyticsOverlay: () =>
        set((state) => ({
          analyticsOverlayVisible: !state.analyticsOverlayVisible,
        })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'nomarkup-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    },
  ),
);
```

**Persistence:** `localStorage` via Zustand `persist` middleware. Only `sidebarCollapsed` and `theme` persist. Transient UI state (`mobileMenuOpen`, `commandPaletteOpen`) resets on page load.

---

### 2.3 `useWebSocketStore`

**File:** `src/stores/websocket-store.ts`

```typescript
import { create } from 'zustand';

const WS_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
} as const;
type WebSocketStatus = (typeof WS_STATUS)[keyof typeof WS_STATUS];

interface QueuedMessage {
  event: string;
  payload: unknown;
  timestamp: number;
}

interface WebSocketState {
  // State
  status: WebSocketStatus;
  socket: WebSocket | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastPongAt: number | null;
  messageQueue: QueuedMessage[]; // Messages queued while disconnected

  // Actions
  connect: (url: string) => void;
  disconnect: () => void;
  send: (event: string, payload: unknown) => void;
  setStatus: (status: WebSocketStatus) => void;
  setSocket: (socket: WebSocket | null) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
  setPongTimestamp: (timestamp: number) => void;
  enqueueMessage: (message: QueuedMessage) => void;
  flushQueue: () => QueuedMessage[];
}

export const useWebSocketStore = create<WebSocketState>()((set, get) => ({
  status: WS_STATUS.DISCONNECTED,
  socket: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  lastPongAt: null,
  messageQueue: [],

  connect: (url) => {
    const current = get().socket;
    if (current && current.readyState === WebSocket.OPEN) return;

    set({ status: WS_STATUS.CONNECTING });

    const socket = new WebSocket(url);

    socket.onopen = () => {
      set({
        status: WS_STATUS.CONNECTED,
        socket,
        reconnectAttempts: 0,
      });
      // Flush queued messages
      const queued = get().flushQueue();
      for (const msg of queued) {
        socket.send(JSON.stringify({ event: msg.event, payload: msg.payload }));
      }
    };

    socket.onclose = () => {
      set({ status: WS_STATUS.DISCONNECTED, socket: null });
    };

    socket.onerror = () => {
      set({ status: WS_STATUS.DISCONNECTED });
    };

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      set({ status: WS_STATUS.DISCONNECTING });
      socket.close(1000, 'Client disconnect');
      set({ socket: null, status: WS_STATUS.DISCONNECTED });
    }
  },

  send: (event, payload) => {
    const { socket, status } = get();
    const message = { event, payload, timestamp: Date.now() };

    if (socket && status === WS_STATUS.CONNECTED) {
      socket.send(JSON.stringify({ event, payload }));
    } else {
      // Queue for delivery when reconnected
      get().enqueueMessage(message);
    }
  },

  setStatus: (status) => set({ status }),
  setSocket: (socket) => set({ socket }),
  incrementReconnectAttempts: () =>
    set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 })),
  resetReconnectAttempts: () => set({ reconnectAttempts: 0 }),
  setPongTimestamp: (timestamp) => set({ lastPongAt: timestamp }),
  enqueueMessage: (message) =>
    set((state) => ({ messageQueue: [...state.messageQueue, message] })),
  flushQueue: () => {
    const queue = get().messageQueue;
    set({ messageQueue: [] });
    return queue;
  },
}));
```

**Persistence:** None. WebSocket state is entirely in-memory. Connection is re-established on page load via the `useWebSocket` hook.

---

### 2.4 `useNotificationStore`

**File:** `src/stores/notification-store.ts`

```typescript
import { create } from 'zustand';

const TOAST_TYPE = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;
type ToastType = (typeof TOAST_TYPE)[keyof typeof TOAST_TYPE];

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration: number; // milliseconds; 0 = persistent until dismissed
  action?: {
    label: string;
    href: string;
  };
}

interface NotificationState {
  // State
  unreadCount: number;
  toastQueue: Toast[];

  // Actions
  setUnreadCount: (count: number) => void;
  incrementUnreadCount: () => void;
  decrementUnreadCount: (by?: number) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount: 0,
  toastQueue: [],

  setUnreadCount: (count) => set({ unreadCount: count }),
  incrementUnreadCount: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),
  decrementUnreadCount: (by = 1) =>
    set((state) => ({ unreadCount: Math.max(0, state.unreadCount - by) })),

  addToast: (toast) =>
    set((state) => ({
      toastQueue: [
        ...state.toastQueue,
        { ...toast, id: crypto.randomUUID() },
      ],
    })),
  dismissToast: (id) =>
    set((state) => ({
      toastQueue: state.toastQueue.filter((t) => t.id !== id),
    })),
  clearToasts: () => set({ toastQueue: [] }),
}));
```

**Persistence:** None. Unread count is fetched from the server on mount (via TanStack Query) and synced into this store. WebSocket events increment it in real time. Toast queue is transient.

---

## 3. TanStack Query Key Factory

**File:** `src/lib/query-keys.ts`

All query keys are defined in a single factory object. Every query hook must use keys from this factory. No ad-hoc key strings.

```typescript
export const queryKeys = {
  // ─── Users ───────────────────────────────────────────────
  users: {
    all: ['users'] as const,
    me: () => ['users', 'me'] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
    search: (params: { query: string; role?: string; page?: number }) =>
      ['users', 'search', params] as const,
    providers: (params: {
      categoryId?: string;
      lat?: number;
      lng?: number;
      radius?: number;
      page?: number;
    }) => ['users', 'providers', params] as const,
  },

  // ─── Jobs ────────────────────────────────────────────────
  jobs: {
    all: ['jobs'] as const,
    list: (params: {
      status?: string;
      categoryId?: string;
      lat?: number;
      lng?: number;
      radius?: number;
      minBudget?: number;
      maxBudget?: number;
      sortBy?: string;
      page?: number;
      pageSize?: number;
    }) => ['jobs', 'list', params] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    drafts: () => ['jobs', 'drafts'] as const,
    customerJobs: (params: { status?: string; page?: number }) =>
      ['jobs', 'customer-jobs', params] as const,
    providerJobs: (params: { status?: string; page?: number }) =>
      ['jobs', 'provider-jobs', params] as const,
    map: (params: {
      bounds: { north: number; south: number; east: number; west: number };
      categoryId?: string;
    }) => ['jobs', 'map', params] as const,
    search: (params: { query: string; categoryId?: string; page?: number }) =>
      ['jobs', 'search', params] as const,
  },

  // ─── Bids ────────────────────────────────────────────────
  bids: {
    all: ['bids'] as const,
    forJob: (jobId: string, params?: { sortBy?: string }) =>
      ['bids', 'for-job', jobId, params] as const,
    forProvider: (params?: { status?: string; page?: number }) =>
      ['bids', 'for-provider', params] as const,
    detail: (id: string) => ['bids', 'detail', id] as const,
    count: (jobId: string) => ['bids', 'count', jobId] as const,
    analytics: () => ['bids', 'analytics'] as const,
  },

  // ─── Contracts ───────────────────────────────────────────
  contracts: {
    all: ['contracts'] as const,
    list: (params?: { status?: string; page?: number }) =>
      ['contracts', 'list', params] as const,
    detail: (id: string) => ['contracts', 'detail', id] as const,
    recurring: (params?: { page?: number }) =>
      ['contracts', 'recurring', params] as const,
    instances: (contractId: string, params?: { page?: number }) =>
      ['contracts', 'instances', contractId, params] as const,
  },

  // ─── Payments ────────────────────────────────────────────
  payments: {
    all: ['payments'] as const,
    list: (params?: { contractId?: string; status?: string; page?: number }) =>
      ['payments', 'list', params] as const,
    detail: (id: string) => ['payments', 'detail', id] as const,
    methods: () => ['payments', 'methods'] as const,
    fees: (params: { amount: number; categoryId?: string }) =>
      ['payments', 'fees', params] as const,
  },

  // ─── Chat ────────────────────────────────────────────────
  chat: {
    all: ['chat'] as const,
    channels: (params?: { page?: number }) =>
      ['chat', 'channels', params] as const,
    messages: (channelId: string, params?: { cursor?: string }) =>
      ['chat', 'messages', channelId, params] as const,
    unread: () => ['chat', 'unread'] as const,
  },

  // ─── Reviews ─────────────────────────────────────────────
  reviews: {
    all: ['reviews'] as const,
    forUser: (userId: string, params?: { role?: string; page?: number }) =>
      ['reviews', 'for-user', userId, params] as const,
    byUser: (userId: string, params?: { page?: number }) =>
      ['reviews', 'by-user', userId, params] as const,
    detail: (id: string) => ['reviews', 'detail', id] as const,
    eligibility: (contractId: string) =>
      ['reviews', 'eligibility', contractId] as const,
    flagged: (params?: { page?: number }) =>
      ['reviews', 'flagged', params] as const,
  },

  // ─── Trust ───────────────────────────────────────────────
  trust: {
    all: ['trust'] as const,
    score: (userId: string) => ['trust', 'score', userId] as const,
    history: (userId: string) => ['trust', 'history', userId] as const,
    requirements: () => ['trust', 'requirements'] as const,
  },

  // ─── Notifications ───────────────────────────────────────
  notifications: {
    all: ['notifications'] as const,
    list: (params?: { page?: number; read?: boolean }) =>
      ['notifications', 'list', params] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
    preferences: () => ['notifications', 'preferences'] as const,
  },

  // ─── Subscriptions ───────────────────────────────────────
  subscriptions: {
    all: ['subscriptions'] as const,
    current: () => ['subscriptions', 'current'] as const,
    tiers: () => ['subscriptions', 'tiers'] as const,
    usage: () => ['subscriptions', 'usage'] as const,
    invoices: (params?: { page?: number }) =>
      ['subscriptions', 'invoices', params] as const,
  },

  // ─── Analytics ───────────────────────────────────────────
  analytics: {
    all: ['analytics'] as const,
    marketRange: (params: {
      serviceTypeId: string;
      zipCode: string;
    }) => ['analytics', 'market-range', params] as const,
    trends: (params: {
      serviceTypeId: string;
      zipCode: string;
      period: string;
    }) => ['analytics', 'trends', params] as const,
    provider: (providerId: string) =>
      ['analytics', 'provider', providerId] as const,
    customer: (customerId: string) =>
      ['analytics', 'customer', customerId] as const,
    platform: (params?: { period?: string }) =>
      ['analytics', 'platform', params] as const,
  },

  // ─── Categories ──────────────────────────────────────────
  categories: {
    all: ['categories'] as const,
    tree: () => ['categories', 'tree'] as const,
    list: (params?: { parentId?: string }) =>
      ['categories', 'list', params] as const,
  },

  // ─── Properties ──────────────────────────────────────────
  properties: {
    all: ['properties'] as const,
    list: () => ['properties', 'list'] as const,
    detail: (id: string) => ['properties', 'detail', id] as const,
  },

  // ─── Verification ────────────────────────────────────────
  verification: {
    all: ['verification'] as const,
    documents: () => ['verification', 'documents'] as const,
    status: () => ['verification', 'status'] as const,
  },

  // ─── Admin ───────────────────────────────────────────────
  admin: {
    all: ['admin'] as const,
    users: (params?: {
      query?: string;
      role?: string;
      status?: string;
      page?: number;
    }) => ['admin', 'users', params] as const,
    userDetail: (id: string) => ['admin', 'user-detail', id] as const,
    fraudQueue: (params?: { minConfidence?: number; page?: number }) =>
      ['admin', 'fraud-queue', params] as const,
    disputeQueue: (params?: { status?: string; page?: number }) =>
      ['admin', 'dispute-queue', params] as const,
    verificationQueue: (params?: { status?: string; page?: number }) =>
      ['admin', 'verification-queue', params] as const,
    auditLog: (params?: { adminId?: string; action?: string; page?: number }) =>
      ['admin', 'audit-log', params] as const,
    systemHealth: () => ['admin', 'system-health'] as const,
    config: () => ['admin', 'config'] as const,
    revenue: (params?: { period?: string }) =>
      ['admin', 'revenue', params] as const,
  },
} as const;
```

### Key Convention Rules

1. Every entity has an `all` key at the root for broad invalidation (e.g., `queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all })`).
2. Keys that accept parameters use function form. Keys that are static use array literals.
3. Parameters are passed as an object at the end of the key array. TanStack Query performs structural comparison, so order-insensitive matching works.
4. Never construct query keys inline. Always reference `queryKeys`.

---

## 4. Query/Mutation Patterns

### 4.1 Global TanStack Query Configuration

**File:** `src/lib/query-client.ts`

```typescript
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,         // 1 minute
        gcTime: 5 * 60 * 1000,        // 5 minutes (garbage collection)
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0, // Mutations do not retry by default
      },
    },
  });
}
```

### 4.2 Custom Stale Times by Data Type

| Data Type | `staleTime` | `gcTime` | Rationale |
|---|---|---|---|
| Auth (`users.me`) | `Infinity` | `Infinity` | Only changes on explicit login/logout/profile update |
| Categories (taxonomy) | 24 hours | 24 hours | Rarely changes; admin-managed |
| Job list (active auctions) | 30 seconds | 5 minutes | Bid counts and new jobs change frequently |
| Job detail | 15 seconds | 5 minutes | Bid activity during active auction |
| Bids for a job | 10 seconds | 2 minutes | Critical real-time data during auction |
| Chat messages | 0 (always stale) | 10 minutes | WebSocket handles real-time; refetch on focus is safety net |
| Notifications list | 30 seconds | 5 minutes | WebSocket handles real-time |
| Market analytics | 5 minutes | 30 minutes | Updated periodically, not real-time |
| Subscription tiers | 1 hour | 24 hours | Changes are infrequent |
| Admin system health | 15 seconds | 1 minute | Monitoring dashboard needs freshness |

### 4.3 Query Hook Patterns

All query hooks live in `src/hooks/` with the naming convention `use-{entity}.ts`.

#### Example: Jobs

**File:** `src/hooks/use-jobs.ts`

```typescript
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// ─── Types ─────────────────────────────────────────────────

interface JobListParams {
  status?: string;
  categoryId?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  minBudget?: number;
  maxBudget?: number;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}

interface JobListResponse {
  jobs: Job[];
  pagination: PaginationResponse;
}

interface CreateJobInput {
  title: string;
  description: string;
  categoryId: string;
  propertyId: string;
  photos: string[];
  scheduleType: ScheduleType;
  scheduledDate?: string;
  scheduledDateRangeStart?: string;
  scheduledDateRangeEnd?: string;
  isRecurring: boolean;
  recurrencePattern?: string;
  startingBidCents?: number;
  offerAcceptedPriceCents?: number;
  auctionDurationHours: number;
  minProviderRating?: number;
}

// ─── Queries ───────────────────────────────────────────────

export function useJobs(params: JobListParams) {
  return useQuery({
    queryKey: queryKeys.jobs.list(params),
    queryFn: () => api.get<JobListResponse>(`/api/v1/jobs?${toSearchParams(params)}`),
    staleTime: 30 * 1000,
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.get<Job>(`/api/v1/jobs/${id}`),
    staleTime: 15 * 1000,
    enabled: id.length > 0,
  });
}

export function useJobDrafts() {
  return useQuery({
    queryKey: queryKeys.jobs.drafts(),
    queryFn: () => api.get<Job[]>('/api/v1/jobs/drafts'),
  });
}

export function useCustomerJobs(params: { status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.jobs.customerJobs(params),
    queryFn: () =>
      api.get<JobListResponse>(`/api/v1/jobs/mine?${toSearchParams(params)}`),
  });
}

export function useProviderJobs(params: { status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.jobs.providerJobs(params),
    queryFn: () =>
      api.get<JobListResponse>(
        `/api/v1/jobs/provider-jobs?${toSearchParams(params)}`,
      ),
  });
}

export function useJobsMap(params: {
  bounds: { north: number; south: number; east: number; west: number };
  categoryId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.jobs.map(params),
    queryFn: () =>
      api.get<JobMapResponse>(`/api/v1/jobs/map?${toSearchParams(params)}`),
    staleTime: 30 * 1000,
  });
}

// ─── Mutations ─────────────────────────────────────────────

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateJobInput) =>
      api.post<Job>('/api/v1/jobs', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<CreateJobInput> & { id?: string }) =>
      input.id
        ? api.patch<Job>(`/api/v1/jobs/drafts/${input.id}`, input)
        : api.post<Job>('/api/v1/jobs/drafts', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.drafts() });
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<void>(`/api/v1/jobs/${jobId}/cancel`, {}),
    onSuccess: (_data, jobId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.customerJobs({}),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.all });
    },
  });
}

export function useRepostJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { jobId: string; modifications?: Partial<CreateJobInput> }) =>
      api.post<Job>(`/api/v1/jobs/${input.jobId}/repost`, input.modifications),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useAwardJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { jobId: string; bidId: string }) =>
      api.post<Contract>(`/api/v1/jobs/${input.jobId}/award`, {
        bidId: input.bidId,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
    },
  });
}
```

### 4.4 Bidding Feature

**File:** `src/hooks/use-bids.ts`

```typescript
export function useBidsForJob(
  jobId: string,
  params?: { sortBy?: string },
) {
  return useQuery({
    queryKey: queryKeys.bids.forJob(jobId, params),
    queryFn: () =>
      api.get<BidListResponse>(
        `/api/v1/jobs/${jobId}/bids?${toSearchParams(params ?? {})}`,
      ),
    staleTime: 10 * 1000,
    enabled: jobId.length > 0,
  });
}

export function useBidCount(jobId: string) {
  return useQuery({
    queryKey: queryKeys.bids.count(jobId),
    queryFn: () => api.get<{ count: number }>(`/api/v1/jobs/${jobId}/bids/count`),
    staleTime: 10 * 1000,
    enabled: jobId.length > 0,
  });
}

export function useProviderBids(params?: { status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.bids.forProvider(params),
    queryFn: () =>
      api.get<BidListResponse>(`/api/v1/bids/mine?${toSearchParams(params ?? {})}`),
  });
}

export function usePlaceBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { jobId: string; amountCents: number; message?: string }) =>
      api.post<Bid>(`/api/v1/jobs/${input.jobId}/bids`, {
        amountCents: input.amountCents,
        message: input.message,
      }),
    onSuccess: (_data, variables) => {
      // Invalidate all bid queries for this job
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.count(variables.jobId),
      });
      // Also invalidate provider's own bids
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
      // Invalidate job detail (bid count shown on job)
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(variables.jobId),
      });
      // Invalidate chat channels (new channel created for bid)
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.channels(),
      });
    },
  });
}

export function useUpdateBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { bidId: string; jobId: string; amountCents: number }) =>
      api.patch<Bid>(`/api/v1/bids/${input.bidId}`, {
        amountCents: input.amountCents,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.detail(variables.bidId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
    },
  });
}

export function useWithdrawBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { bidId: string; jobId: string }) =>
      api.post<void>(`/api/v1/bids/${input.bidId}/withdraw`, {}),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.count(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
    },
  });
}

export function useAcceptOfferPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { jobId: string }) =>
      api.post<Bid>(`/api/v1/jobs/${input.jobId}/bids/accept-offer`, {}),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.count(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
    },
  });
}
```

### 4.5 Contract Feature

**File:** `src/hooks/use-contracts.ts`

```typescript
export function useContract(id: string) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id),
    queryFn: () => api.get<Contract>(`/api/v1/contracts/${id}`),
    enabled: id.length > 0,
  });
}

export function useContracts(params?: { status?: string; page?: number }) {
  return useQuery({
    queryKey: queryKeys.contracts.list(params),
    queryFn: () =>
      api.get<ContractListResponse>(
        `/api/v1/contracts?${toSearchParams(params ?? {})}`,
      ),
  });
}

export function useAcceptContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contractId: string) =>
      api.post<Contract>(`/api/v1/contracts/${contractId}/accept`, {}),
    onSuccess: (_data, contractId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useCompleteJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contractId: string) =>
      api.post<void>(`/api/v1/contracts/${contractId}/complete`, {}),
    onSuccess: (_data, contractId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
    },
  });
}

export function useApproveMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { contractId: string; milestoneId: string }) =>
      api.post<void>(
        `/api/v1/contracts/${input.contractId}/milestones/${input.milestoneId}/approve`,
        {},
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    },
  });
}

export function useRequestRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { contractId: string; notes: string }) =>
      api.post<void>(
        `/api/v1/contracts/${input.contractId}/request-revision`,
        { notes: input.notes },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
    },
  });
}

export function useOpenDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { contractId: string; reason: string; description: string }) =>
      api.post<void>(
        `/api/v1/contracts/${input.contractId}/dispute`,
        { reason: input.reason, description: input.description },
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    },
  });
}

export function useChangeOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changes: { description: string; amountDeltaCents: number; milestones?: unknown[] };
    }) =>
      api.post<void>(
        `/api/v1/contracts/${input.contractId}/change-order`,
        input.changes,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
    },
  });
}
```

### 4.6 Payment Feature

**File:** `src/hooks/use-payments.ts`

```typescript
export function usePayments(params?: {
  contractId?: string;
  status?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: queryKeys.payments.list(params),
    queryFn: () =>
      api.get<PaymentListResponse>(
        `/api/v1/payments?${toSearchParams(params ?? {})}`,
      ),
  });
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: queryKeys.payments.methods(),
    queryFn: () => api.get<PaymentMethod[]>('/api/v1/payments/methods'),
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      contractId: string;
      amountCents: number;
      paymentMethodId: string;
      idempotencyKey: string;
    }) =>
      api.post<Payment>('/api/v1/payments', input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
    },
  });
}

export function useRequestRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      paymentId: string;
      amountCents: number;
      reason: string;
    }) =>
      api.post<void>(`/api/v1/payments/${input.paymentId}/refund`, {
        amountCents: input.amountCents,
        reason: input.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
    },
  });
}
```

### 4.7 Chat Feature

**File:** `src/hooks/use-chat.ts`

```typescript
export function useChatChannels(params?: { page?: number }) {
  return useQuery({
    queryKey: queryKeys.chat.channels(params),
    queryFn: () =>
      api.get<ChatChannelListResponse>(
        `/api/v1/chat/channels?${toSearchParams(params ?? {})}`,
      ),
  });
}

export function useChatMessages(
  channelId: string,
  params?: { cursor?: string },
) {
  return useInfiniteQuery({
    queryKey: queryKeys.chat.messages(channelId, params),
    queryFn: ({ pageParam }) =>
      api.get<ChatMessagePage>(
        `/api/v1/chat/channels/${channelId}/messages?cursor=${pageParam ?? ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    enabled: channelId.length > 0,
  });
}

export function useUnreadChatCount() {
  return useQuery({
    queryKey: queryKeys.chat.unread(),
    queryFn: () => api.get<{ count: number }>('/api/v1/chat/unread'),
    staleTime: 30 * 1000,
  });
}

// See Section 7 for optimistic send-message mutation.
```

### 4.8 Reviews Feature

**File:** `src/hooks/use-reviews.ts`

```typescript
export function useReviewsForUser(
  userId: string,
  params?: { role?: string; page?: number },
) {
  return useQuery({
    queryKey: queryKeys.reviews.forUser(userId, params),
    queryFn: () =>
      api.get<ReviewListResponse>(
        `/api/v1/users/${userId}/reviews?${toSearchParams(params ?? {})}`,
      ),
    enabled: userId.length > 0,
  });
}

export function useReviewEligibility(contractId: string) {
  return useQuery({
    queryKey: queryKeys.reviews.eligibility(contractId),
    queryFn: () =>
      api.get<{ eligible: boolean; reason?: string }>(
        `/api/v1/contracts/${contractId}/review-eligibility`,
      ),
    enabled: contractId.length > 0,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      contractId: string;
      rating: number;
      comment: string;
      categoryRatings: Record<string, number>;
    }) =>
      api.post<Review>(`/api/v1/contracts/${input.contractId}/review`, input),
    onSuccess: (_data, variables) => {
      // Invalidate review-related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      // Invalidate eligibility check
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviews.eligibility(variables.contractId),
      });
      // Invalidate trust scores (reviews affect score)
      queryClient.invalidateQueries({ queryKey: queryKeys.trust.all });
      // Invalidate contract detail (review status shown on contract)
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.contractId),
      });
    },
  });
}

export function useFlagReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { reviewId: string; reason: string }) =>
      api.post<void>(`/api/v1/reviews/${input.reviewId}/flag`, {
        reason: input.reason,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviews.detail(variables.reviewId),
      });
    },
  });
}
```

### 4.9 Cache Invalidation Matrix

This matrix defines which query keys are invalidated by each mutation. Implementation is in the `onSuccess` callback of each mutation hook (as shown above).

| Mutation | Invalidated Query Keys |
|---|---|
| **Create job** | `jobs.all` |
| **Cancel job** | `jobs.detail(jobId)`, `jobs.customerJobs`, `bids.all` |
| **Repost job** | `jobs.all` |
| **Award job** | `jobs.detail(jobId)`, `bids.forJob(jobId)`, `contracts.all` |
| **Place bid** | `bids.forJob(jobId)`, `bids.count(jobId)`, `bids.forProvider`, `jobs.detail(jobId)`, `chat.channels` |
| **Update bid** | `bids.forJob(jobId)`, `bids.detail(bidId)`, `bids.forProvider` |
| **Withdraw bid** | `bids.forJob(jobId)`, `bids.count(jobId)`, `bids.forProvider` |
| **Accept contract** | `contracts.detail(contractId)`, `contracts.all`, `jobs.all` |
| **Complete job** | `contracts.detail(contractId)`, `contracts.all`, `jobs.all`, `reviews.all` |
| **Approve milestone** | `contracts.detail(contractId)`, `payments.all` |
| **Create payment** | `payments.all`, `contracts.detail(contractId)` |
| **Request refund** | `payments.all`, `contracts.all` |
| **Submit review** | `reviews.all`, `reviews.eligibility(contractId)`, `trust.all`, `contracts.detail(contractId)` |
| **Flag review** | `reviews.detail(reviewId)` |
| **Send chat message** | Optimistic update to `chat.messages(channelId)` (see Section 7) |
| **Mark notifications read** | `notifications.unreadCount`, `notifications.list` |
| **Update profile** | `users.me`, `users.detail(userId)` |
| **Upload verification doc** | `verification.documents`, `verification.status` |
| **Update subscription** | `subscriptions.current`, `subscriptions.usage` |
| **Change order** | `contracts.detail(contractId)` |
| **Open dispute** | `contracts.detail(contractId)`, `payments.all` |

---

## 5. WebSocket Integration

### 5.1 Connection Lifecycle

**File:** `src/hooks/use-websocket.ts`

The `useWebSocket` hook manages the connection lifecycle. It is mounted once in the root authenticated layout (`src/app/(dashboard)/layout.tsx`).

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketStore } from '@/stores/websocket-store';
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationStore } from '@/stores/notification-store';
import { queryKeys } from '@/lib/query-keys';
import { API_BASE_URL } from '@/lib/constants';

const WS_URL = API_BASE_URL.replace(/^http/, 'ws') + '/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function useWebSocket() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const {
    connect,
    disconnect,
    socket,
    status,
    reconnectAttempts,
    maxReconnectAttempts,
    incrementReconnectAttempts,
    resetReconnectAttempts,
    setPongTimestamp,
  } = useWebSocketStore();
  const { incrementUnreadCount, addToast } = useNotificationStore();

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
  const getReconnectDelay = useCallback(
    (attempt: number) =>
      Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS),
    [],
  );

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const ws = useWebSocketStore.getState().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    const attempts = useWebSocketStore.getState().reconnectAttempts;
    if (attempts >= maxReconnectAttempts) return;

    const delay = getReconnectDelay(attempts);
    reconnectTimeoutRef.current = setTimeout(() => {
      incrementReconnectAttempts();
      connect(WS_URL);
    }, delay);
  }, [connect, getReconnectDelay, incrementReconnectAttempts, maxReconnectAttempts]);

  // Message handler -- routes WebSocket events to TanStack Query invalidations
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = JSON.parse(String(event.data)) as {
        event: string;
        payload: Record<string, unknown>;
      };

      switch (data.event) {
        case 'pong':
          setPongTimestamp(Date.now());
          break;

        // See Section 5.2 for full event routing
        default:
          routeWebSocketEvent(data, queryClient, { incrementUnreadCount, addToast });
      }
    },
    [queryClient, setPongTimestamp, incrementUnreadCount, addToast],
  );

  // Connect on mount when authenticated; disconnect on unmount
  useEffect(() => {
    if (!isAuthenticated) {
      disconnect();
      return;
    }

    connect(WS_URL);

    return () => {
      stopHeartbeat();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect, stopHeartbeat]);

  // Attach message handler and lifecycle callbacks to socket
  useEffect(() => {
    if (!socket) return;

    socket.onmessage = handleMessage;

    socket.onopen = () => {
      resetReconnectAttempts();
      startHeartbeat();
    };

    socket.onclose = (e) => {
      stopHeartbeat();
      // Only reconnect on abnormal close
      if (e.code !== 1000) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      stopHeartbeat();
    };
  }, [
    socket,
    handleMessage,
    resetReconnectAttempts,
    startHeartbeat,
    stopHeartbeat,
    scheduleReconnect,
  ]);

  return { status };
}
```

### 5.2 Event-to-Query Invalidation Mapping

**File:** `src/lib/ws-event-router.ts`

```typescript
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';

interface EventActions {
  incrementUnreadCount: () => void;
  addToast: (toast: {
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    duration: number;
    action?: { label: string; href: string };
  }) => void;
}

export function routeWebSocketEvent(
  data: { event: string; payload: Record<string, unknown> },
  queryClient: QueryClient,
  actions: EventActions,
): void {
  switch (data.event) {
    // ─── Bids ────────────────────────────────────────────
    case 'new_bid': {
      const jobId = data.payload['jobId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.count(jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(jobId),
      });
      actions.addToast({
        type: 'info',
        title: 'New bid received',
        message: `A provider submitted a bid on your job.`,
        duration: 5000,
        action: { label: 'View bids', href: `/jobs/${jobId}/bids` },
      });
      break;
    }

    case 'bid_updated': {
      const jobId = data.payload['jobId'] as string;
      const bidId = data.payload['bidId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.detail(bidId),
      });
      break;
    }

    case 'bid_awarded': {
      const jobId = data.payload['jobId'] as string;
      const bidId = data.payload['bidId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.detail(bidId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
      actions.addToast({
        type: 'success',
        title: 'Bid awarded',
        message: `You have been awarded a job.`,
        duration: 8000,
        action: { label: 'View contract', href: `/contracts` },
      });
      break;
    }

    case 'bid_not_selected': {
      const jobId = data.payload['jobId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
      actions.addToast({
        type: 'info',
        title: 'Bid not selected',
        message: `Another provider was selected for a job you bid on.`,
        duration: 5000,
      });
      break;
    }

    // ─── Chat ────────────────────────────────────────────
    case 'new_message': {
      const channelId = data.payload['channelId'] as string;
      // Append the new message directly to the cache for instant display
      queryClient.setQueryData(
        queryKeys.chat.messages(channelId),
        (oldData: unknown) => {
          if (!oldData) return oldData;
          // Append to the first page of the infinite query
          return appendMessageToCache(oldData, data.payload['message']);
        },
      );
      // Invalidate unread counts
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.unread() });
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.channels() });
      break;
    }

    case 'typing_indicator': {
      // Typing indicators are NOT stored in TanStack Query.
      // They are transient and handled by a local event emitter
      // subscribed to by the active ChatWindow component.
      // The ChatWindow listens for typing events and uses useState
      // to show/hide the typing indicator.
      break;
    }

    // ─── Payments ────────────────────────────────────────
    case 'payment_status': {
      const paymentId = data.payload['paymentId'] as string;
      const contractId = data.payload['contractId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.payments.detail(paymentId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      });
      break;
    }

    // ─── Notifications ───────────────────────────────────
    case 'notification': {
      actions.incrementUnreadCount();
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.list(),
      });
      const payload = data.payload as {
        title: string;
        message: string;
        actionUrl?: string;
      };
      actions.addToast({
        type: 'info',
        title: payload.title,
        message: payload.message,
        duration: 6000,
        action: payload.actionUrl
          ? { label: 'View', href: payload.actionUrl }
          : undefined,
      });
      break;
    }

    // ─── Contracts ───────────────────────────────────────
    case 'contract_update': {
      const contractId = data.payload['contractId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
      break;
    }

    case 'contract_completed': {
      const contractId = data.payload['contractId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all });
      actions.addToast({
        type: 'success',
        title: 'Job completed',
        message: 'A job has been marked as complete. Please leave a review.',
        duration: 8000,
        action: {
          label: 'Leave review',
          href: `/contracts/${contractId}/review`,
        },
      });
      break;
    }

    // ─── Job Lifecycle ───────────────────────────────────
    case 'auction_closing_soon': {
      const jobId = data.payload['jobId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(jobId),
      });
      actions.addToast({
        type: 'warning',
        title: 'Auction closing soon',
        message: `An auction you are watching is closing in 1 hour.`,
        duration: 10000,
        action: { label: 'View job', href: `/jobs/${jobId}` },
      });
      break;
    }

    case 'auction_closed': {
      const jobId = data.payload['jobId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(jobId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      break;
    }

    // ─── Verification ────────────────────────────────────
    case 'verification_update': {
      queryClient.invalidateQueries({
        queryKey: queryKeys.verification.documents(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.verification.status(),
      });
      break;
    }

    // ─── Trust Score ─────────────────────────────────────
    case 'trust_score_update': {
      const userId = data.payload['userId'] as string;
      queryClient.invalidateQueries({
        queryKey: queryKeys.trust.score(userId),
      });
      break;
    }
  }
}
```

### 5.3 WebSocket Event Type Reference

| Event | Direction | Payload | Triggers |
|---|---|---|---|
| `ping` | Client -> Server | `{}` | Heartbeat (every 30s) |
| `pong` | Server -> Client | `{}` | Heartbeat response |
| `new_bid` | Server -> Client | `{ jobId, bidId, providerName }` | Invalidate bids + toast |
| `bid_updated` | Server -> Client | `{ jobId, bidId }` | Invalidate bids |
| `bid_awarded` | Server -> Client | `{ jobId, bidId, contractId }` | Invalidate job + bids + contracts + toast |
| `bid_not_selected` | Server -> Client | `{ jobId, bidId }` | Invalidate provider bids + toast |
| `new_message` | Server -> Client | `{ channelId, message }` | Append to cache + update unread |
| `typing_indicator` | Both | `{ channelId, userId, isTyping }` | Local state in ChatWindow |
| `payment_status` | Server -> Client | `{ paymentId, contractId, status }` | Invalidate payments + contract |
| `notification` | Server -> Client | `{ title, message, actionUrl? }` | Increment unread + toast |
| `contract_update` | Server -> Client | `{ contractId, status }` | Invalidate contract |
| `contract_completed` | Server -> Client | `{ contractId }` | Invalidate contract + jobs + reviews + toast |
| `auction_closing_soon` | Server -> Client | `{ jobId, closesAt }` | Invalidate job + toast |
| `auction_closed` | Server -> Client | `{ jobId }` | Invalidate job |
| `verification_update` | Server -> Client | `{ documentType, status }` | Invalidate verification |
| `trust_score_update` | Server -> Client | `{ userId, newScore }` | Invalidate trust score |

---

## 6. Form State Patterns

All Zod schemas live in `src/lib/validations.ts` (shared schemas) or `src/lib/validations/{feature}.ts` (feature-specific schemas). All form components live in `src/components/forms/`.

### 6.1 Standard Form Hook Pattern

Every form follows this pattern:

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// 1. Define schema
const schema = z.object({ ... });
type FormValues = z.infer<typeof schema>;

// 2. In component
function MyForm() {
  const mutation = useMyMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ... },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 422) {
          // Map server field errors to form fields
          const fieldErrors = parseFieldErrors(error.body);
          for (const [field, message] of Object.entries(fieldErrors)) {
            form.setError(field as keyof FormValues, { message });
          }
        }
      },
    });
  });

  return <form onSubmit={onSubmit}>...</form>;
}
```

### 6.2 Login Form

**Schema file:** `src/lib/validations.ts` (already defined as `loginSchema`)

```typescript
// Already exists in src/lib/validations.ts
export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
type LoginFormValues = z.infer<typeof loginSchema>;

// Default values
const LOGIN_DEFAULTS: LoginFormValues = {
  email: '',
  password: '',
};
```

**Mutation:** `useLogin` in `src/hooks/use-auth.ts`
**Error handling:** 401 -> show "Invalid email or password" as form-level error. 429 -> show "Too many attempts. Try again in X minutes."

### 6.3 Registration Form

**Schema file:** `src/lib/validations/registration.ts`

```typescript
import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  displayNameSchema,
  phoneSchema,
} from '@/lib/validations';

export const customerRegistrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    displayName: displayNameSchema,
    phone: phoneSchema.optional(),
    address: z.object({
      street: z.string().min(1, 'Street address is required'),
      city: z.string().min(1, 'City is required'),
      state: z.string().length(2, 'Use 2-letter state code'),
      zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
    }),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms of service' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const providerRegistrationSchema = customerRegistrationSchema.extend({
  businessName: z.string().min(2).max(200).optional(),
  serviceCategories: z
    .array(z.string())
    .min(1, 'Select at least one service category'),
  serviceRadiusMiles: z.number().int().min(1).max(100),
  isIndependent: z.boolean(),
});

type CustomerRegistrationValues = z.infer<typeof customerRegistrationSchema>;
type ProviderRegistrationValues = z.infer<typeof providerRegistrationSchema>;
```

**Default values:**
```typescript
const CUSTOMER_REGISTRATION_DEFAULTS: CustomerRegistrationValues = {
  email: '',
  password: '',
  confirmPassword: '',
  displayName: '',
  phone: undefined,
  address: { street: '', city: '', state: '', zipCode: '' },
  acceptTerms: false as unknown as true, // Form won't submit unless true
};
```

### 6.4 Job Posting Form (Multi-Step)

This is the most complex form. It uses a multi-step pattern with Zustand for cross-step persistence.

**Schema file:** `src/lib/validations/job-posting.ts`

```typescript
import { z } from 'zod';
import { jobTitleSchema, jobDescriptionSchema } from '@/lib/validations';

// Step 1: Category
const jobCategoryStepSchema = z.object({
  categoryId: z.string().min(1, 'Select a category'),
  subcategoryId: z.string().min(1, 'Select a subcategory'),
  serviceTypeId: z.string().min(1, 'Select a service type'),
});

// Step 2: Details
const jobDetailsStepSchema = z.object({
  title: jobTitleSchema,
  description: jobDescriptionSchema,
  propertyId: z.string().min(1, 'Select a property'),
});

// Step 3: Photos
const jobPhotosStepSchema = z.object({
  photos: z.array(z.string().url()).max(10, 'Maximum 10 photos'),
});

// Step 4: Schedule
const jobScheduleStepSchema = z.object({
  scheduleType: z.enum(['specific_date', 'date_range', 'flexible']),
  scheduledDate: z.string().optional(),
  scheduledDateRangeStart: z.string().optional(),
  scheduledDateRangeEnd: z.string().optional(),
  isRecurring: z.boolean(),
  recurrencePattern: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
}).refine(
  (data) => {
    if (data.scheduleType === 'specific_date') return Boolean(data.scheduledDate);
    if (data.scheduleType === 'date_range')
      return Boolean(data.scheduledDateRangeStart && data.scheduledDateRangeEnd);
    return true;
  },
  { message: 'Schedule dates are required for the selected schedule type' },
);

// Step 5: Auction Settings
const jobAuctionStepSchema = z.object({
  startingBidCents: z.number().int().positive().optional(),
  offerAcceptedPriceCents: z.number().int().positive().optional(),
  auctionDurationHours: z.number().int().min(12).max(168),
  minProviderRating: z.number().min(1).max(5).optional(),
});

// Full schema (for final submission validation)
export const jobPostingSchema = jobCategoryStepSchema
  .merge(jobDetailsStepSchema)
  .merge(jobPhotosStepSchema)
  .merge(jobScheduleStepSchema)
  .merge(jobAuctionStepSchema);

export type JobPostingFormValues = z.infer<typeof jobPostingSchema>;

// Per-step schemas for step-level validation
export const JOB_POSTING_STEP_SCHEMAS = [
  jobCategoryStepSchema,
  jobDetailsStepSchema,
  jobPhotosStepSchema,
  jobScheduleStepSchema,
  jobAuctionStepSchema,
] as const;

export const JOB_POSTING_STEP_LABELS = [
  'Category',
  'Details',
  'Photos',
  'Schedule',
  'Auction Settings',
] as const;
```

**Multi-step draft store:** `src/stores/job-draft-store.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JobPostingFormValues } from '@/lib/validations/job-posting';

interface JobDraftState {
  currentStep: number;
  draft: Partial<JobPostingFormValues>;
  setStep: (step: number) => void;
  updateDraft: (values: Partial<JobPostingFormValues>) => void;
  clearDraft: () => void;
}

export const useJobDraftStore = create<JobDraftState>()(
  persist(
    (set) => ({
      currentStep: 0,
      draft: {},
      setStep: (step) => set({ currentStep: step }),
      updateDraft: (values) =>
        set((state) => ({ draft: { ...state.draft, ...values } })),
      clearDraft: () => set({ currentStep: 0, draft: {} }),
    }),
    {
      name: 'nomarkup-job-draft',
    },
  ),
);
```

**Pattern:** Each step renders its own `<form>` with `useForm` using the step-specific schema. On step completion, values are saved to `useJobDraftStore`. On the final step's submit, the full `jobPostingSchema` validates the merged draft, and the `useCreateJob` mutation fires. On success, `clearDraft()` is called.

### 6.5 Bid Submission Form

**Schema file:** `src/lib/validations/bid.ts`

```typescript
import { z } from 'zod';
import { bidAmountSchema } from '@/lib/validations';

export const bidSubmissionSchema = z.object({
  amountCents: bidAmountSchema,
  message: z
    .string()
    .max(2000, 'Message must be at most 2000 characters')
    .optional(),
});

export type BidSubmissionValues = z.infer<typeof bidSubmissionSchema>;

const BID_DEFAULTS: BidSubmissionValues = {
  amountCents: 0,
  message: '',
};
```

**Mutation:** `usePlaceBid`
**Special behavior:** If the job has an offer-accepted price, show a one-click "Accept Offer Price" button that calls `useAcceptOfferPrice` instead of submitting the form.

### 6.6 Review Form

**Schema file:** `src/lib/validations/review.ts`

```typescript
import { z } from 'zod';
import { ratingSchema, reviewCommentSchema } from '@/lib/validations';

// Category-specific ratings differ by reviewer role
const customerReviewingProviderSchema = z.object({
  rating: ratingSchema,
  comment: reviewCommentSchema,
  categoryRatings: z.object({
    qualityOfWork: ratingSchema,
    timeliness: ratingSchema,
    communication: ratingSchema,
    value: ratingSchema,
  }),
});

const providerReviewingCustomerSchema = z.object({
  rating: ratingSchema,
  comment: reviewCommentSchema,
  categoryRatings: z.object({
    paymentPromptness: ratingSchema,
    accuracyOfScope: ratingSchema,
    communication: ratingSchema,
    propertyAccess: ratingSchema,
  }),
});

export type CustomerReviewValues = z.infer<typeof customerReviewingProviderSchema>;
export type ProviderReviewValues = z.infer<typeof providerReviewingCustomerSchema>;
```

**Mutation:** `useSubmitReview`
**Conditional schema:** The component checks the active role from `useAuthStore` and uses the appropriate schema.

### 6.7 Profile Edit Forms

**Schema file:** `src/lib/validations/profile.ts`

```typescript
import { z } from 'zod';
import { displayNameSchema, phoneSchema } from '@/lib/validations';

export const customerProfileSchema = z.object({
  displayName: displayNameSchema,
  phone: phoneSchema.optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  }),
});

export const providerProfileSchema = customerProfileSchema.extend({
  businessName: z.string().min(2).max(200).optional(),
  bio: z.string().max(500).optional(),
  serviceCategories: z.array(z.string()).min(1),
  serviceRadiusMiles: z.number().int().min(1).max(100),
  globalTerms: z.object({
    paymentTiming: z.enum([
      'upfront',
      'milestone',
      'completion',
      'payment_plan',
      'recurring',
    ]),
    defaultMilestonePercentages: z.array(z.number()).optional(),
    cancellationPolicy: z.string().max(1000).optional(),
    warrantyTerms: z.string().max(1000).optional(),
  }),
});

export type CustomerProfileValues = z.infer<typeof customerProfileSchema>;
export type ProviderProfileValues = z.infer<typeof providerProfileSchema>;
```

### 6.8 Property Form

**Schema file:** `src/lib/validations/property.ts`

```typescript
import { z } from 'zod';

export const propertySchema = z.object({
  nickname: z.string().min(1, 'Give this property a name').max(100),
  address: z.object({
    street: z.string().min(1, 'Street address is required'),
    unit: z.string().max(50).optional(),
    city: z.string().min(1, 'City is required'),
    state: z.string().length(2, 'Use 2-letter state code'),
    zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  }),
  notes: z.string().max(500).optional(),
});

export type PropertyValues = z.infer<typeof propertySchema>;
```

### 6.9 Dispute Form

**Schema file:** `src/lib/validations/dispute.ts`

```typescript
import { z } from 'zod';

const DISPUTE_REASON = {
  INCOMPLETE_WORK: 'incomplete_work',
  POOR_QUALITY: 'poor_quality',
  NO_SHOW: 'no_show',
  SCOPE_DISAGREEMENT: 'scope_disagreement',
  PAYMENT_ISSUE: 'payment_issue',
  OTHER: 'other',
} as const;

export const disputeSchema = z.object({
  reason: z.enum([
    DISPUTE_REASON.INCOMPLETE_WORK,
    DISPUTE_REASON.POOR_QUALITY,
    DISPUTE_REASON.NO_SHOW,
    DISPUTE_REASON.SCOPE_DISAGREEMENT,
    DISPUTE_REASON.PAYMENT_ISSUE,
    DISPUTE_REASON.OTHER,
  ]),
  description: z
    .string()
    .min(50, 'Please provide at least 50 characters of detail')
    .max(5000),
  attachments: z.array(z.string().url()).max(5).optional(),
});

export type DisputeValues = z.infer<typeof disputeSchema>;
```

### 6.10 Admin Forms

**Schema file:** `src/lib/validations/admin.ts`

```typescript
import { z } from 'zod';

// Category CRUD
export const categorySchema = z.object({
  name: z.string().min(2).max(100),
  parentId: z.string().optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0),
});

// Platform config
export const platformConfigSchema = z.object({
  requireVerificationToBid: z.boolean(),
  analyticsVisibleToUsers: z.boolean(),
  transactionFeePercent: z.number().min(0).max(50),
  freeTierMaxActiveJobs: z.number().int().min(0),
  freeTierMaxBidsPerMonth: z.number().int().min(0),
  proTrialDays: z.number().int().min(0),
});

// User management actions
export const userActionSchema = z.object({
  action: z.enum(['warn', 'suspend', 'ban', 'reinstate']),
  reason: z.string().min(10).max(1000),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
export type PlatformConfigValues = z.infer<typeof platformConfigSchema>;
export type UserActionValues = z.infer<typeof userActionSchema>;
```

### 6.11 Server Error-to-Form-Field Mapping

**File:** `src/lib/form-errors.ts`

```typescript
import { ApiError } from '@/lib/api';

interface FieldError {
  field: string;
  message: string;
}

interface ApiValidationErrorBody {
  errors: FieldError[];
}

export function parseFieldErrors(
  responseBody: string,
): Record<string, string> {
  try {
    const parsed = JSON.parse(responseBody) as ApiValidationErrorBody;
    const result: Record<string, string> = {};

    for (const err of parsed.errors) {
      // Convert snake_case server field names to camelCase form field names
      const camelField = err.field.replace(/_([a-z])/g, (_, letter: string) =>
        letter.toUpperCase(),
      );
      result[camelField] = err.message;
    }

    return result;
  } catch {
    return {};
  }
}

export function isValidationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 422;
}
```

---

## 7. Optimistic Updates

### 7.1 Sending Chat Messages

**File:** `src/hooks/use-send-message.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/auth-store';

interface SendMessageInput {
  channelId: string;
  content: string;
  attachments?: string[];
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      api.post<ChatMessage>(
        `/api/v1/chat/channels/${input.channelId}/messages`,
        { content: input.content, attachments: input.attachments },
      ),

    onMutate: async (variables) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({
        queryKey: queryKeys.chat.messages(variables.channelId),
      });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData(
        queryKeys.chat.messages(variables.channelId),
      );

      // Optimistically add the new message
      const optimisticMessage: ChatMessage = {
        id: `optimistic-${crypto.randomUUID()}`,
        channelId: variables.channelId,
        senderId: user?.id ?? '',
        senderName: user?.displayName ?? '',
        content: variables.content,
        attachments: variables.attachments ?? [],
        createdAt: new Date().toISOString(),
        status: 'sending', // Visual indicator that message is in flight
      };

      queryClient.setQueryData(
        queryKeys.chat.messages(variables.channelId),
        (oldData: unknown) => {
          if (!oldData) return oldData;
          return appendMessageToCache(oldData, optimisticMessage);
        },
      );

      return { previousMessages };
    },

    onError: (_error, variables, context) => {
      // Rollback to the previous value
      if (context?.previousMessages) {
        queryClient.setQueryData(
          queryKeys.chat.messages(variables.channelId),
          context.previousMessages,
        );
      }
    },

    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.messages(variables.channelId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.channels(),
      });
    },
  });
}
```

### 7.2 Marking Notifications as Read

**File:** `src/hooks/use-mark-notifications-read.ts`

```typescript
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { setUnreadCount } = useNotificationStore();

  return useMutation({
    mutationFn: (notificationIds: string[]) =>
      api.post<void>('/api/v1/notifications/mark-read', { ids: notificationIds }),

    onMutate: async (notificationIds) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      });

      const previousCount = queryClient.getQueryData<{ count: number }>(
        queryKeys.notifications.unreadCount(),
      );

      // Optimistically decrement the count
      const newCount = Math.max(
        0,
        (previousCount?.count ?? 0) - notificationIds.length,
      );
      queryClient.setQueryData(queryKeys.notifications.unreadCount(), {
        count: newCount,
      });
      setUnreadCount(newCount);

      return { previousCount };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousCount) {
        queryClient.setQueryData(
          queryKeys.notifications.unreadCount(),
          context.previousCount,
        );
        setUnreadCount(context.previousCount.count);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.list(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      });
    },
  });
}
```

### 7.3 Placing a Bid (Optimistic)

The bid list on the customer side does NOT use optimistic updates (only the customer who placed the bid would see it, and the sealed-bid model means providers should not see each other's bids). However, the provider's own bid list uses optimistic updates:

```typescript
export function usePlaceBidOptimistic() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: (input: { jobId: string; amountCents: number; message?: string }) =>
      api.post<Bid>(`/api/v1/jobs/${input.jobId}/bids`, {
        amountCents: input.amountCents,
        message: input.message,
      }),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.bids.forProvider(),
      });

      const previousBids = queryClient.getQueryData(
        queryKeys.bids.forProvider(),
      );

      const optimisticBid: Bid = {
        id: `optimistic-${crypto.randomUUID()}`,
        jobId: variables.jobId,
        providerId: user?.id ?? '',
        amountCents: variables.amountCents,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(
        queryKeys.bids.forProvider(),
        (oldData: BidListResponse | undefined) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            bids: [optimisticBid, ...oldData.bids],
          };
        },
      );

      return { previousBids };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousBids) {
        queryClient.setQueryData(
          queryKeys.bids.forProvider(),
          context.previousBids,
        );
      }
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forJob(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.count(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.forProvider(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.detail(variables.jobId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.channels(),
      });
    },
  });
}
```

### 7.4 Optimistic Update Rules

1. **Always snapshot previous state in `onMutate`** and return it as context for rollback.
2. **Always call `cancelQueries` before setting data** to prevent in-flight fetches from overwriting the optimistic value.
3. **Always invalidate in `onSettled`** (not just `onSuccess`) to guarantee eventual consistency regardless of mutation outcome.
4. **Mark optimistic items** with a temporary ID prefix (`optimistic-`) or a `status: 'sending'` field so the UI can show a pending state.
5. **Only use optimistic updates for actions where the user expects instant feedback:** chat messages, notification read status, and the provider's own bid list. Do not use optimistic updates for mutations that affect other users' views (e.g., awarding a job, creating a payment).

---

## 8. Error Handling

### 8.1 Global Error Boundary

**File:** `src/app/global-error.tsx`

This catches unrecoverable React rendering errors. It is already scaffolded in the project.

```typescript
'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log to Sentry
  // Display full-page error with retry button
  // ...
}
```

### 8.2 Feature-Level Error Boundaries

Wrap each major feature area in its own error boundary:

```
src/app/(dashboard)/jobs/error.tsx
src/app/(dashboard)/contracts/error.tsx
src/app/(dashboard)/chat/error.tsx
src/app/(dashboard)/payments/error.tsx
```

Next.js App Router `error.tsx` files automatically act as error boundaries for their route segment.

### 8.3 Per-Query Error Handling

Every component that uses a query hook must handle three states:

```typescript
function JobList() {
  const { data, isLoading, isError, error, refetch } = useJobs(params);

  if (isLoading) return <JobListSkeleton />;

  if (isError) {
    return (
      <ErrorState
        title="Failed to load jobs"
        message={getErrorMessage(error)}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data || data.jobs.length === 0) {
    return <EmptyState icon={BriefcaseIcon} message="No jobs found" />;
  }

  return <ul>{/* render jobs */}</ul>;
}
```

### 8.4 Mutation Error Handling

```typescript
const mutation = useCreateJob();

const onSubmit = form.handleSubmit((values) => {
  mutation.mutate(values, {
    onSuccess: (job) => {
      // Navigate to the new job
      router.push(`/jobs/${job.id}`);
    },
    onError: (error) => {
      if (isValidationError(error)) {
        // Map server validation errors to form fields
        const fieldErrors = parseFieldErrors(error.body);
        for (const [field, message] of Object.entries(fieldErrors)) {
          form.setError(field as keyof FormValues, { message });
        }
      } else {
        // Show generic toast for non-validation errors
        addToast({
          type: 'error',
          title: 'Failed to create job',
          message: getErrorMessage(error),
          duration: 8000,
        });
      }
    },
  });
});
```

### 8.5 Auth Error Handling

**File:** `src/lib/api.ts` (enhancement to existing)

The API client intercepts 401 and 403 responses globally:

```typescript
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // ... existing fetch logic ...

  if (response.status === 401) {
    // Token expired or invalid
    useAuthStore.getState().clearUser();
    // Redirect happens via auth middleware or the component tree
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  if (response.status === 403) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  return response.json() as Promise<T>;
}
```

### 8.6 Network Error Detection

TanStack Query's built-in `retry` handles transient network failures (configured for 2 retries with exponential backoff in the global config). For explicit network detection:

```typescript
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return 'Invalid request. Please check your input.';
      case 401: return 'Session expired. Please log in again.';
      case 403: return 'You do not have permission to perform this action.';
      case 404: return 'The requested resource was not found.';
      case 409: return 'This action conflicts with the current state. Please refresh and try again.';
      case 422: return 'Please correct the errors in your submission.';
      case 429: return 'Too many requests. Please wait and try again.';
      default:
        if (error.status >= 500) return 'A server error occurred. Please try again later.';
        return 'An unexpected error occurred.';
    }
  }

  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'Network error. Please check your connection and try again.';
  }

  return 'An unexpected error occurred.';
}
```

### 8.7 Error Display Hierarchy

Per CLAUDE.md Section 9:

1. **Inline field errors** -- React Hook Form `form.formState.errors` rendered next to each field via `aria-describedby`.
2. **Toast/snackbar** -- `useNotificationStore.addToast()` for action feedback ("Bid placed", "Network error").
3. **Error state in component** -- `<ErrorState>` component with retry button for failed data fetches.
4. **Full-page error** -- `error.tsx` boundary for unrecoverable errors within a route segment.
5. **Global error** -- `global-error.tsx` for crashes that escape all other boundaries.

---

## 9. Data Prefetching

### 9.1 Route-Based Prefetching

Prefetch data on hover/focus for navigation links to eliminate loading states on navigation:

**File:** `src/components/layout/prefetch-link.tsx`

```typescript
'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type ComponentProps } from 'react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface PrefetchConfig {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  staleTime?: number;
}

interface PrefetchLinkProps extends ComponentProps<typeof Link> {
  prefetch?: PrefetchConfig[];
}

export function PrefetchLink({ prefetch, onMouseEnter, onFocus, ...props }: PrefetchLinkProps) {
  const queryClient = useQueryClient();

  const handlePrefetch = useCallback(() => {
    if (!prefetch) return;
    for (const config of prefetch) {
      void queryClient.prefetchQuery({
        queryKey: config.queryKey,
        queryFn: config.queryFn,
        staleTime: config.staleTime ?? 60_000,
      });
    }
  }, [queryClient, prefetch]);

  return (
    <Link
      {...props}
      onMouseEnter={(e) => {
        handlePrefetch();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        handlePrefetch();
        onFocus?.(e);
      }}
    />
  );
}
```

**Usage:**
```typescript
<PrefetchLink
  href={`/jobs/${job.id}`}
  prefetch={[
    {
      queryKey: queryKeys.jobs.detail(job.id),
      queryFn: () => api.get(`/api/v1/jobs/${job.id}`),
    },
    {
      queryKey: queryKeys.bids.forJob(job.id),
      queryFn: () => api.get(`/api/v1/jobs/${job.id}/bids`),
    },
  ]}
>
  {job.title}
</PrefetchLink>
```

### 9.2 Parallel Query Loading

Use TanStack Query's parallel query patterns for pages that need multiple independent data sources:

```typescript
// Job detail page needs job data, bids, and market analytics in parallel
function JobDetailPage({ params }: { params: { id: string } }) {
  const jobQuery = useJob(params.id);
  const bidsQuery = useBidsForJob(params.id);
  const marketQuery = useMarketRange({
    serviceTypeId: jobQuery.data?.serviceTypeId ?? '',
    zipCode: jobQuery.data?.zipCode ?? '',
  });
  // All three queries fire in parallel. Each component section
  // handles its own loading/error state independently.
}
```

For dependent queries, use `enabled`:

```typescript
// Market range depends on job data being loaded first
const marketQuery = useMarketRange({
  serviceTypeId: jobQuery.data?.serviceTypeId ?? '',
  zipCode: jobQuery.data?.zipCode ?? '',
}, {
  enabled: Boolean(jobQuery.data?.serviceTypeId && jobQuery.data?.zipCode),
});
```

### 9.3 SSR Data Loading

For pages that benefit from server-side data loading (SEO-relevant public pages), use TanStack Query's server-side prefetching with Next.js:

**File:** `src/app/(public)/jobs/[id]/page.tsx`

```typescript
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { api } from '@/lib/api';
import { JobDetailView } from '@/components/jobs/job-detail-view';

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.get(`/api/v1/jobs/${id}`),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <JobDetailView jobId={id} />
    </HydrationBoundary>
  );
}
```

### 9.4 SSR Prefetch Targets

| Route | Prefetched Queries | Rationale |
|---|---|---|
| `/jobs` (public browse) | `jobs.list` | SEO: job listings should be indexable |
| `/jobs/[id]` (public detail) | `jobs.detail`, `reviews.forUser(providerId)` | SEO: job details should be indexable |
| `/providers/[id]` (public profile) | `users.detail`, `reviews.forUser`, `trust.score` | SEO: provider profiles should be indexable |
| `/dashboard` (authenticated) | `users.me`, `notifications.unreadCount` | Fast initial load for authenticated users |
| `/dashboard/jobs` | `jobs.customerJobs` or `jobs.providerJobs` | Depends on active role |

Dashboard pages use client-side prefetching (hover/focus on sidebar links). Public pages use SSR prefetching for SEO.

---

## Appendix A: Utility Functions Referenced

```typescript
// Convert a params object to URLSearchParams string
function toSearchParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'object') {
        searchParams.set(key, JSON.stringify(value));
      } else {
        searchParams.set(key, String(value));
      }
    }
  }
  return searchParams.toString();
}

// Append a message to TanStack Query infinite query cache
function appendMessageToCache(
  oldData: unknown,
  message: unknown,
): unknown {
  // Implementation depends on the infinite query page structure
  // Appends to the first page's messages array
  const data = oldData as { pages: Array<{ messages: unknown[] }> };
  if (!data.pages[0]) return oldData;
  return {
    ...data,
    pages: [
      {
        ...data.pages[0],
        messages: [...data.pages[0].messages, message],
      },
      ...data.pages.slice(1),
    ],
  };
}
```

## Appendix B: File Structure Summary

```
src/
├── stores/
│   ├── auth-store.ts           # useAuthStore
│   ├── ui-store.ts             # useUIStore
│   ├── websocket-store.ts      # useWebSocketStore
│   ├── notification-store.ts   # useNotificationStore
│   └── job-draft-store.ts      # useJobDraftStore (multi-step form persistence)
├── hooks/
│   ├── use-auth.ts             # useLogin, useLogout, useRegister, useCurrentUser
│   ├── use-jobs.ts             # useJobs, useJob, useJobDrafts, useCreateJob, ...
│   ├── use-bids.ts             # useBidsForJob, usePlaceBid, useUpdateBid, ...
│   ├── use-contracts.ts        # useContract, useAcceptContract, useCompleteJob, ...
│   ├── use-payments.ts         # usePayments, useCreatePayment, useRequestRefund, ...
│   ├── use-chat.ts             # useChatChannels, useChatMessages, useSendMessage
│   ├── use-reviews.ts          # useReviewsForUser, useSubmitReview, useFlagReview, ...
│   ├── use-trust.ts            # useTrustScore, useTrustHistory
│   ├── use-notifications.ts    # useNotifications, useMarkNotificationsRead
│   ├── use-subscriptions.ts    # useSubscription, useSubscriptionTiers, ...
│   ├── use-analytics.ts        # useMarketRange, useTrends, ...
│   ├── use-categories.ts       # useCategoryTree, useCategories
│   ├── use-properties.ts       # useProperties, useProperty, useCreateProperty, ...
│   ├── use-verification.ts     # useVerificationDocuments, useUploadDocument, ...
│   ├── use-websocket.ts        # WebSocket connection lifecycle hook
│   └── use-session-timeout.ts  # Session inactivity detection
├── lib/
│   ├── api.ts                  # Type-safe API client (existing)
│   ├── query-keys.ts           # TanStack Query key factory
│   ├── query-client.ts         # QueryClient factory with default options
│   ├── ws-event-router.ts      # WebSocket event -> query invalidation mapping
│   ├── form-errors.ts          # Server error -> form field mapping
│   ├── validations.ts          # Shared Zod schemas (existing)
│   └── validations/
│       ├── registration.ts     # Registration schemas
│       ├── job-posting.ts      # Job posting multi-step schemas
│       ├── bid.ts              # Bid submission schema
│       ├── review.ts           # Review schemas (customer/provider variants)
│       ├── profile.ts          # Profile edit schemas
│       ├── property.ts         # Property CRUD schema
│       ├── dispute.ts          # Dispute form schema
│       └── admin.ts            # Admin form schemas
└── types/
    └── index.ts                # Domain types and const objects (existing)
```
