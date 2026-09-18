/**
 * Creates (or promotes) an ADMIN account. Public sign-up is disabled, so this
 * is how the first user comes to exist.
 *
 *   pnpm --filter api seed:admin --email you@example.com --password <secret> --name "You"
 */
import { parseArgs } from "node:util"
import { eq } from "drizzle-orm"
import { account, user } from "@workspace/db"

import { auth } from "../src/lib/auth"
import { db, pool } from "../src/lib/db"

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string", default: "Admin" },
    password: { type: "string" },
  },
})

if (!values.email || !values.password || values.password.length < 8) {
  console.error("Usage: seed:admin --email <email> --password <min 8 chars> [--name <name>]")
  process.exit(1)
}
const email = values.email.toLowerCase()

const ctx = await auth.$context
const existing = await ctx.internalAdapter.findUserByEmail(email)

if (existing) {
  await db.update(user).set({ role: "ADMIN" }).where(eq(user.id, existing.user.id))
  const hashedPassword = await ctx.password.hash(values.password)
  await db.update(account).set({ password: hashedPassword }).where(eq(account.userId, existing.user.id))
  console.log(`Updated ADMIN ${email} role and password successfully.`)
} else {
  const created = await ctx.internalAdapter.createUser(
    {
      email,
      name: values.name ?? "Admin",
      emailVerified: true,
      role: "ADMIN",
    },
    { method: "admin" }
  )
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(values.password),
  })
  console.log(`Created ADMIN ${email}.`)
}

await pool.end()
