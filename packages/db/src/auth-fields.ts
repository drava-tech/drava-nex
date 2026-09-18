/**
 * Extra columns on better-auth's `user` table. Shared by the schema generator
 * (scripts/auth-schema.config.ts) and the API's real auth instance, so the
 * generated schema and the runtime config cannot drift apart.
 */
export const ROLE_VALUES: ["ADMIN", "OPERATOR", "VIEWER"] = ["ADMIN", "OPERATOR", "VIEWER"]

export const userAdditionalFields = {
  role: {
    type: ROLE_VALUES,
    required: true,
    defaultValue: "OPERATOR",
    // Server-owned: sign-up input and provider profiles can never set a role.
    input: false as const,
  },
}
