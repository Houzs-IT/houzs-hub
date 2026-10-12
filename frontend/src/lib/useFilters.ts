import { useSearchParams } from "react-router-dom";

const FILTER_KEYS = ["system", "type", "priority", "assignee", "status", "q"] as const;

const split = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

// All list / board state lives in the URL so views are shareable and survive reload.
export function useFilters() {
  const [params, setParams] = useSearchParams();

  function set(patch: Record<string, string | string[] | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const val = Array.isArray(v) ? v.join(",") : v;
      if (val) p.set(k, val);
      else p.delete(k);
    }
    if (!("page" in patch) && !("selected" in patch)) p.delete("page");
    setParams(p, { replace: !("selected" in patch) });
  }

  // Query string for the API: filters + sort/page, never UI-only keys like `selected`.
  function apiQuery(overrides: Record<string, string> = {}) {
    const q = new URLSearchParams();
    for (const k of [...FILTER_KEYS, "sort", "dir", "page"]) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) q.set(k, v);
    return q;
  }

  const active = FILTER_KEYS.some((k) => k !== "status" && params.get(k));

  return {
    params,
    get: (k: string) => params.get(k),
    list: (k: string) => split(params.get(k)),
    set,
    apiQuery,
    hasFilters: active,
    clear: () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))),
  };
}
