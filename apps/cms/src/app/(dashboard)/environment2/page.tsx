import React from "react";
import { requireAdmin } from "@/lib/auth-helpers";
import { EnvironmentView } from "./_components/environment-view";

export default async function EnvironmentPage2() {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-full overflow-hidden">
      <div className="w-full h-full flex flex-col">
        <EnvironmentView />
      </div>
    </div>
  );
}
