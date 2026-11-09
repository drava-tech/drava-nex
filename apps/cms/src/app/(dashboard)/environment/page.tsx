import React from "react";
import { requireGuestOrAdmin } from "@/lib/auth-helpers";
import { EnvironmentView } from "./_components/environment-view";

export default async function EnvironmentPage6() {
  // Users operate the room too; setup actions inside are still admin-only.
  await requireGuestOrAdmin();
  return (
    <div className="flex flex-1 flex-col p-2 sm:p-4 h-full overflow-y-auto lg:overflow-hidden min-h-0">
      <div className="w-full h-full flex flex-col min-h-0">
        <EnvironmentView />
      </div>
    </div>
  );
}