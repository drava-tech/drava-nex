import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { EnvironmentView } from "./_components/environment-view";

export default async function Environment4Page() {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <EnvironmentView />
    </div>
  );
}
