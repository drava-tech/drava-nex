"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL — client uses the current page's origin so auth works from any
// host (localhost, LAN IP, hostname) without rebuilding.
export const authClient: ReturnType<typeof createAuthClient> = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
