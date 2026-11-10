import React from "react";
import { NexLogo } from "@/components/drava-logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-4">
      <NexLogo className="h-20" />
      {children}
    </div>
  );
}
