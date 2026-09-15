import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { EnvironmentView } from "./_components/environment-view";

export default async function EnvironmentPage6() {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col p-2 sm:p-4 h-full lg:h-[calc(100dvh-40px)] overflow-y-auto lg:overflow-hidden min-h-0">
      <div className="w-full h-full flex flex-col min-h-0">
        <EnvironmentView />
      </div>
    </div>
  );
}