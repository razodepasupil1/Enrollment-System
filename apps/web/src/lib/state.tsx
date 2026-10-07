import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TermDTO, UserDTO } from "@enroll/shared";
import { api } from "./api";
import { useMe, useTerms } from "./queries";

/**
 * Forget everything cached for the previous person, then record who is signed in now.
 * NOT qc.clear(): that deletes the "me" query out from under the component already watching it, so the
 * new value would be written to a fresh query nobody observes and the screen would never change.
 */
function switchUser(qc: QueryClient, user: UserDTO | null): void {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  qc.setQueryData(["me"], user);
}

// --- auth -----------------------------------------------------------------------------------------
export function useAuth() {
  const me = useMe();
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: (v: { email: string; password: string } | { demo: string }) =>
      "demo" in v
        ? api<{ user: UserDTO }>("/auth/demo-login", { method: "POST", body: { email: v.demo } })
        : api<{ user: UserDTO }>("/auth/login", { method: "POST", body: v }),
    onSuccess: ({ user }) => switchUser(qc, user),
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => switchUser(qc, null),
  });
  return { user: me.data ?? null, loading: me.isLoading, login, logout };
}

// --- selected term ------------------------------------------------------------------------------------
interface TermCtx {
  terms: TermDTO[];
  term: TermDTO | null;
  /** Undefined means "let the server pick the current term". */
  termId: number | undefined;
  isCurrent: boolean;
  setTermId: (id: number) => void;
}
const TermContext = createContext<TermCtx>({ terms: [], term: null, termId: undefined, isCurrent: true, setTermId: () => undefined });
export const useTerm = () => useContext(TermContext);

export function TermProvider({ children }: { children: ReactNode }) {
  const { data } = useTerms();
  const [selected, setSelected] = useState<number | null>(() => {
    const raw = localStorage.getItem("termId");
    return raw ? Number(raw) : null;
  });
  const terms = data?.terms ?? [];
  const current = terms.find((t) => t.isCurrent) ?? terms[0] ?? null;
  const term = terms.find((t) => t.id === selected) ?? current;
  const setTermId = useCallback((id: number) => { setSelected(id); localStorage.setItem("termId", String(id)); }, []);
  const value = useMemo<TermCtx>(
    () => ({ terms, term, termId: term?.id, isCurrent: term?.isCurrent ?? true, setTermId }),
    [terms, term, setTermId],
  );
  return <TermContext.Provider value={value}>{children}</TermContext.Provider>;
}

// --- cart (pre-enrollment) --------------------------------------------------------------------------------
interface CartCtx {
  ids: number[];
  has: (id: number) => boolean;
  add: (id: number) => void;
  remove: (id: number) => void;
  clear: () => void;
}
const CartContext = createContext<CartCtx>({ ids: [], has: () => false, add: () => undefined, remove: () => undefined, clear: () => undefined });
export const useCart = () => useContext(CartContext);

/** The cart is just a list of course ids kept per user in localStorage. It is a convenience, not data of record. */
export function CartProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const key = `cart:${userId}`;
  const [ids, setIds] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]") as number[]; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(ids)); }, [key, ids]);
  const value = useMemo<CartCtx>(() => ({
    ids,
    has: (id) => ids.includes(id),
    add: (id) => setIds((c) => (c.includes(id) ? c : [...c, id])),
    remove: (id) => setIds((c) => c.filter((x) => x !== id)),
    clear: () => setIds([]),
  }), [ids]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
