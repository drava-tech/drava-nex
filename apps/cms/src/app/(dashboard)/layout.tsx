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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-auto shrink-0 items-center gap-2 border-b p-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
          <SidebarTrigger className="-ml-1 h-5 w-5 [&>svg]:size-4" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Suspense fallback={<div className="h-4 w-20 animate-pulse bg-zinc-800 rounded" />}>
            <DashboardBreadcrumb />
          </Suspense>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

