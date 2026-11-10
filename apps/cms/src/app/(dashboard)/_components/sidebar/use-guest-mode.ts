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
  // Inside an iframe on another site a default (Lax) cookie is dropped, so the
  // toggle would never stick. SameSite=None requires Secure, i.e. HTTPS.
  const crossSiteFrame = window.top !== window.self && location.protocol === "https:";
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${maxAge}${
    crossSiteFrame ? "; SameSite=None; Secure" : ""
  }`;
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
