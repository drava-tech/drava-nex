import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { EnvironmentView } from "./_components/environment-view";

export default async function EnvironmentPage6() {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col p-4 h-[calc(100dvh-40px)] overflow-hidden min-h-0">
      <div className="w-full h-full flex flex-col min-h-0">
        <EnvironmentView />
      </div>
    </div>
  );
}