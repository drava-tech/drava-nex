"use client";

import React, { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Plus } from 'lucide-react';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  Separator,
} from "@platform/ui";
import { ThemeToggle } from '@/components/theme-toggle';
import { AppSidebar } from '@/app/(dashboard)/_components/sidebar/app-sidebar';
import { DashboardBreadcrumb } from '@/app/(dashboard)/_components/dashboard-breadcrumb';
import { useSession } from '@/lib/auth-client';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: sessionData } = useSession();
  const role = (sessionData?.user as { role?: string } | undefined)?.role ?? "GUEST";

  const isProjectsPage = pathname.startsWith("/experiences");

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-auto shrink-0 items-center justify-between border-b gap-2 p-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1 h-5 w-5 [&>svg]:size-4" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Suspense fallback={<div className="h-4 w-20 animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" />}>
              <DashboardBreadcrumb />
            </Suspense>
          </div>
          <div className="flex items-center gap-2">
            {isProjectsPage && (
              <div className="flex items-center gap-1">
                {(role === "ADMIN" || role === "SUPERADMIN") && (
                  <button
                    onClick={() => {
                      alert("Add project action coming soon!");
                    }}
                    className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors text-zinc-600 dark:text-zinc-400 flex items-center justify-center"
                    title="Add new project"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
                <button
                  className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors text-zinc-600 dark:text-zinc-400 flex items-center justify-center mr-1"
                  title="Three Verticals"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </div>
            )}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

