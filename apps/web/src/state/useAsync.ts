import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "idle" | "loading"; data?: T; error?: undefined }
  | { status: "success"; data: T; error?: undefined }
  | { status: "error"; data?: T; error: Error };

/**
 * Runs `load` when `deps` change (and on reload()). Keeps the previous data while
 * reloading so the UI does not flash empty, and ignores results of superseded runs.
 */
export function useAsync<T>(load: (() => Promise<T>) | null, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!load) {
      setState({ status: "idle" });
      return;
    }
    const id = ++run.current;
    setState((prev) => ({ status: "loading", data: prev.data }));
    load().then(
      (data) => id === run.current && setState({ status: "success", data }),
      (error: unknown) =>
        id === run.current &&
        setState((prev) => ({ status: "error", data: prev.data, error: error instanceof Error ? error : new Error(String(error)) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
