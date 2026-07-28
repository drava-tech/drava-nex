"use client";

import { useState, useCallback } from "react";

const COOKIE_NAME = "guest-mode";

function readGuestModeCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((row) => row === `${COOKIE_NAME}=1`);
}

function writeGuestModeCookie(value: boolean) {
  const maxAge = value ? 60 * 60 * 24 * 365 : 0;
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${maxAge}`;
}

export function useGuestMode() {
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => readGuestModeCookie());

  const toggleGuestMode = useCallback(() => {
    setIsGuestMode((prev) => {
      const next = !prev;
      writeGuestModeCookie(next);
      return next;
    });
  }, []);

  return [isGuestMode, toggleGuestMode] as const;
}
