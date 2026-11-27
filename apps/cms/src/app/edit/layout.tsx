import React from "react";
import { StoreProvider } from "@/store/store-provider";

/**
 * The full-tab editors live outside the (dashboard) segment, so they don't get
 * DashboardLayoutClient's StoreProvider. They still render store-backed UI
 * (PushToScreenModal reads the screens slice), so provide the store here —
 * StoreSync inside it keeps that slice live from the gateway, just as on the
 * dashboard.
 */
export default function EditLayout({ children }: { children: React.ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}
