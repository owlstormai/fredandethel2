"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export interface JsonState<T> {
  data: T | null;
  error: { code: string; message: string; status: number } | null;
  loading: boolean;
  reload: () => void;
}

interface Loaded<T> {
  /** Which request this state belongs to (`path#tick`). */
  key: string | null;
  data: T | null;
  error: JsonState<T>["error"];
}

/**
 * Small same-origin JSON loader with reload; errors are surfaced, never thrown.
 * `loading` is derived (request key !== loaded key) so no state is set inside
 * the effect body itself — only in the fetch callbacks.
 */
export function useJson<T>(path: string | null): JsonState<T> {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Loaded<T>>({ key: null, data: null, error: null });
  const key = path ? `${path}#${tick}` : null;

  useEffect(() => {
    if (!key || !path) return;
    let cancelled = false;
    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) setState({ key, data: result, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error =
          err instanceof ApiClientError
            ? { code: err.code, message: err.message, status: err.status }
            : { code: "network_error", message: "Could not reach the server.", status: 0 };
        setState((prev) => ({ key, data: prev.data, error }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: key !== null && state.key !== key, reload };
}
