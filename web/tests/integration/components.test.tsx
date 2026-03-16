import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock auth store
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      login: vi.fn(),
      user: null,
      isAuthenticated: false,
      token: null,
      logout: vi.fn(),
      register: vi.fn(),
    }),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    getPublic: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock hooks
vi.mock('@/hooks/useJobs', () => ({
  useCreateJob: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
  usePublishJob: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

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
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('LoginForm', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('renders login form with email and password fields', async () => {
    const { LoginForm } = await import('@/components/forms/LoginForm');

    render(createElement(LoginForm), {
      wrapper: createWrapper(queryClient),
    });

    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
  });

  it('shows validation error for invalid email', async () => {
    const user = userEvent.setup();
    const { LoginForm } = await import('@/components/forms/LoginForm');

    render(createElement(LoginForm), {
      wrapper: createWrapper(queryClient),
    });

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'not-an-email');
    await user.type(passwordInput, 'Password123!');
    await user.click(submitButton);

    // Should show a validation error for email.
    const errorMessage = await screen.findByText(/invalid email/i);
    expect(errorMessage).toBeDefined();
  });

  it('renders forgot password link', async () => {
    const { LoginForm } = await import('@/components/forms/LoginForm');

    render(createElement(LoginForm), {
      wrapper: createWrapper(queryClient),
    });

    const forgotLink = screen.getByRole('link', { name: /forgot password/i });
    expect(forgotLink).toBeDefined();
  });
});

describe('JobPostingForm', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  it('renders the first step of job posting form', async () => {
    const { JobPostingForm } = await import(
      '@/components/forms/JobPostingForm'
    );

    render(createElement(JobPostingForm), {
      wrapper: createWrapper(queryClient),
    });

    // First step should show category selection.
    const heading = screen.getByText(/category|what type/i);
    expect(heading).toBeDefined();
  });

  it('shows step navigation buttons', async () => {
    const { JobPostingForm } = await import(
      '@/components/forms/JobPostingForm'
    );

    render(createElement(JobPostingForm), {
      wrapper: createWrapper(queryClient),
    });

    // Should have a next button on the first step.
    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDefined();
  });
});
