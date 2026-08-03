import React from 'react';
import { getCurrentUser } from '@/lib/auth-helpers';
import { getVisionTriggerArmed } from '@/actions/vision-actions';
import { DashboardLayoutClient } from '@/app/(dashboard)/_components/dashboard-layout-client';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const role = (user as { role?: string } | null)?.role;
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";
  // getVisionTriggerArmed() itself redirects non-admins (via requireAdmin) —
  // only ever call it once we already know the user is admin, since this
  // layout wraps every dashboard page, including ones guests legitimately visit.
  const initialTriggerArmed = isAdmin ? await getVisionTriggerArmed() : false;

  return (
    <DashboardLayoutClient isAdmin={isAdmin} initialTriggerArmed={initialTriggerArmed}>
      {children}
    </DashboardLayoutClient>
  );
}
