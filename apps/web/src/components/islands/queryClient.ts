import { QueryClient } from '@tanstack/react-query';

/** Shared across islands; patch-scale data is stable, so cache generously. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000, retry: 1, refetchOnWindowFocus: false },
  },
});
