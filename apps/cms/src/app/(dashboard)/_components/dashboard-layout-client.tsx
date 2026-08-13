"use client";

import React, { Suspense } from 'react';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  Separator,
} from "@platform/ui";
import { AppSidebar } from '@/app/(dashboard)/_components/sidebar/app-sidebar';
import { DashboardBreadcrumb } from '@/app/(dashboard)/_components/dashboard-breadcrumb';
import { WhiteboardOverlay } from '@/app/(dashboard)/_components/whiteboard/whiteboard-overlay';
import { WelcomeTriggerToggle } from './welcome-trigger-toggle';

export function DashboardLayoutClient({
  children,
  isAdmin,
  initialTriggerArmed,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
  initialTriggerArmed: boolean;
}) {
  // The dark shell and the wider rail belong to the redesigned sidebar, which
  // survives the dashboard revert. The editor provider does not: origin/master
  // deleted lib/whiteboard-editor-context.tsx and moved that state into
  // WhiteboardOverlay itself.
  return (
    <SidebarProvider
      className="bg-[#010108] font-['Satoshi',sans-serif]"
      style={
        {
          "--sidebar-width": "22.125rem",
          "--sidebar-width-icon": "5.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="floating" />
      {/* Bounded to the viewport + overflow-hidden so this is the ONE
          scrolling boundary for the whole dashboard — without this, `<main>`
          has no defined height and just grows with its content, so the
          browser's own document scroll moves everything (this header
          included) instead of a contained region, and no `sticky` element
          on any page below has a real scrolling ancestor to stick against. */}
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-auto shrink-0 items-center gap-2 border-b p-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
          <SidebarTrigger className="-ml-1 h-5 w-5 [&>svg]:size-4" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Suspense fallback={<div className="h-4 w-20 animate-pulse bg-zinc-800 rounded" />}>
            <DashboardBreadcrumb />
          </Suspense>
          {/* Global — every dashboard page, not just Visitors. Admin-only
              since arming/disarming requires it server-side anyway. */}
          {isAdmin && (
            <div className="ml-auto">
              <WelcomeTriggerToggle initialArmed={initialTriggerArmed} />
            </div>
          )}
        </header>
        {/* The guaranteed scroll fallback for every dashboard page — some
            pages (Settings, Users) have no internal scroll region of their
            own at all and relied entirely on the old document-level scroll,
            so this can't be sizing-only. Pages that DO implement their own
            internal `overflow-y-auto` (Visitors, Media Library, Screens,
            …) simply never need this one to activate:
            their own inner region scrolls first, and this outer one stays
            exactly full without a visible scrollbar. That nesting is safe
            now — the earlier misaligned-scrollbar issue was actually
            `scrollbar-gutter: stable` on <html> reserving space for a
            document scrollbar that no longer exists (removed in
            globals.css), not the nesting itself. */}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </SidebarInset>
      {/* Floating whiteboard — available on every dashboard page */}
      <WhiteboardOverlay />
    </SidebarProvider>
  );
}
