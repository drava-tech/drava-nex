# Drizzle ORM — Best Practices

Source: orm.drizzle.team docs (official, fetched June 2026) + jezweb/claude-skills community skill.

Used in: `packages/db` (Postgres via `pg` driver). Schema files: `packages/db/src/schema/`.

---

## Schema as Source of Truth

- Define all tables as TypeScript objects using `pgTable()` — the schema IS the single source of truth
- Never write raw SQL to create or alter tables; always go through Drizzle and `db:generate`
- Keep all schema files in `packages/db/src/schema/` — one file per domain area

```ts
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'

export const screens = pgTable('screens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

## Migration Workflow

| Command | When to use |
|---|---|
| `pnpm db:generate` | After every schema change — generates migration SQL in `drizzle/` |
| `pnpm db:push` | Local dev — fast apply without creating a migration file |
| `pnpm db:migrate` | Production — runs the generated migration SQL files in order |
| `pnpm db:studio` | Drizzle Studio GUI — inspect and edit data locally |

- **Never edit generated migration SQL files manually**
- Run `db:generate` and commit the resulting SQL file alongside schema changes

## TypeScript Types

- Use Drizzle's inferred types — never hand-write them:

```ts
type Screen = typeof screens.$inferSelect   // SELECT result type
type NewScreen = typeof screens.$inferInsert // INSERT input type
```

- Export these from `packages/db/src/schema/` and re-export from `@platform/types` for use in apps
- Use `InferSelectModel<typeof screens>` and `InferInsertModel<typeof screens>` as alternatives

## Querying

- Prefer the **Query Builder v2** (`db.query.*`) for relational queries — it respects declared relations:

```ts
const screen = await db.query.screens.findFirst({
  where: eq(screens.id, id),
  with: { experiences: true },   // join via declared relation
})
```

- Use `db.select()` for simple selects or when you need explicit column control
- Use `db.insert()`, `db.update()`, `db.delete()` for mutations

## Relations

- Define relations with `relations()` to enable type-safe `with:` joins:

```ts
import { relations } from 'drizzle-orm'

export const screensRelations = relations(screens, ({ many }) => ({
  experiences: many(experiences),
}))
```

- Declare both sides of a relation (e.g., `screens` has many `experiences`; `experiences` belongs to one `screen`)

## Transactions

- Wrap multi-step mutations in `db.transaction()` for atomicity:

```ts
await db.transaction(async (tx) => {
  const [screen] = await tx.insert(screens).values({ ... }).returning()
  await tx.insert(experiences).values({ screenId: screen.id, ... })
})
```

## Validation Integration

- Use `drizzle-zod` to generate Zod schemas directly from table definitions:

```ts
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

export const insertScreenSchema = createInsertSchema(screens)
export const selectScreenSchema = createSelectSchema(screens)
```

- Wire these into Hono validators with `@hono/zod-validator` for zero-drift between DB schema and API validation

## Filtering and Operators

```ts
import { eq, and, or, like, gt, lt, isNull } from 'drizzle-orm'

// Common patterns
db.query.screens.findMany({ where: eq(screens.active, true) })
db.query.screens.findMany({ where: and(eq(screens.active, true), gt(screens.width, 1920)) })
```

## In This Repo

- All DB access goes through `packages/db` — apps import `{ db }` from `@platform/db`
- Never open a new Postgres connection in app code; always use the shared `db` instance
- Run all DB commands from the repo root: `pnpm db:generate`, `pnpm db:push`, etc. (they proxy to `@platform/db`)
