import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-svh items-center justify-center p-4"
      style={{ background: "linear-gradient(to bottom, #01001F, #000000)" }}
    >
      {children}
    </div>
  );
}
