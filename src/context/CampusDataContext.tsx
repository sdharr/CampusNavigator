/**
 * CampusDataContext.tsx
 *
 * React bridge around the imperative campusDataService singleton.
 *
 * • Calls initializeCampusData() exactly once per app session (on mount).
 * • Exposes { isReady, locations, roadNodes, graph, coordinateMap } to all
 *   screens via the useCampusData() hook.
 * • When isReady is true, all data is available synchronously — no screen
 *   needs to issue its own Firestore reads.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  initializeCampusData,
  getCampusData,
  type CampusData,
} from "../services/campusDataService";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface CampusDataContextValue {
  /** True once initializeCampusData() has resolved successfully. */
  isReady: boolean;
  /** Non-null when initialization threw an error. */
  error: string | null;
  /** Shortcut accessors — all null until isReady is true. */
  data: CampusData | null;
}

const CampusDataContext = createContext<CampusDataContextValue>({
  isReady: false,
  error: null,
  data: null,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CampusDataProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CampusData | null>(null);

  useEffect(() => {
    let cancelled = false;

    initializeCampusData()
      .then(() => {
        if (cancelled) return;
        setData(getCampusData());
        setIsReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CampusDataContext] initialization failed:", msg);
        setError(msg);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CampusDataContext.Provider value={{ isReady, error, data }}>
      {children}
    </CampusDataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the campus data context value.
 *
 * Usage:
 *   const { isReady, data } = useCampusData();
 *   if (!isReady) { /* show skeleton *\/ }
 *   const { locations, graph, roadNodes, coordinateMap } = data!;
 */
export function useCampusData(): CampusDataContextValue {
  return useContext(CampusDataContext);
}
