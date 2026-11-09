import React from "react";
import { DravaLogo } from "@/components/drava-logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-4">
      <DravaLogo product="nex" className="text-3xl" />
      {children}
    </div>
  );
}
