"use client";

import { useRef, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "./index";
import { StoreSync } from "./store-sync";

/**
 * The store must be created inside a component, never at module scope: on the
 * server a module-level store would be shared across concurrent requests from
 * different users. The ref keeps it to exactly one instance per client.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) storeRef.current = makeStore();

  return (
    <Provider store={storeRef.current}>
      <StoreSync />
      {children}
    </Provider>
  );
}
