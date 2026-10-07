import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function makeQueryClient(): QueryClient {
  const qc: QueryClient = new QueryClient({
    // An expired session on ANY request sends the user back to the sign-in page instead of a wall of errors.
    queryCache: new QueryCache({ onError: (e) => { if (e instanceof ApiError && e.status === 401) qc.setQueryData(["me"], null); } }),
    mutationCache: new MutationCache({ onError: (e) => { if (e instanceof ApiError && e.status === 401) qc.setQueryData(["me"], null); } }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
        refetchOnWindowFocus: true,
        staleTime: 5_000,
      },
    },
  });
  return qc;
}
