# TypeScript Strict Mode — Best Practices

Source: repo's own `tsconfig.base.json` + established TypeScript community conventions.

Used across: all packages and apps. This repo runs `strict: true` — these rules are enforced.

---

## Non-Negotiable Rules (Strict Mode)

- **Never use `any`** — use `unknown` at boundaries, then narrow before use
- **Never disable `strict`** or individual strict flags (`noImplicitAny`, `strictNullChecks`) to suppress errors — fix the root cause
- **Never use `// @ts-ignore`** — use `// @ts-expect-error` with a comment explaining why if you must suppress

```ts
// Bad
function parse(input: any) { return input.value }

// Good
function parse(input: unknown) {
  if (typeof input === 'object' && input !== null && 'value' in input) {
    return input.value
  }
  throw new Error('Invalid input')
}
```

## Type vs Interface

- **`interface`** for object shapes that might be extended or implemented:
  ```ts
  interface Screen { id: string; name: string }
  interface DetailedScreen extends Screen { experiences: Experience[] }
  ```
- **`type`** for unions, intersections, mapped types, and aliases:
  ```ts
  type ScreenStatus = 'active' | 'offline' | 'maintenance'
  type PartialScreen = Partial<Screen>
  ```

## Exports

- Always use `export type` for type-only exports — do not mix value and type exports:
  ```ts
  export type { Screen, ScreenStatus }   // type-only
  export { createScreen }                // value
  ```
- In this repo: all shared types live in `@platform/types` — never redefine them in apps

## Inference

- **Infer return types** from functions where possible — only annotate when inference fails, the function is public API, or the inferred type is too wide:
  ```ts
  // Good: inference is precise and obvious
  function toId(name: string) { return name.toLowerCase().replace(/ /g, '-') }

  // Annotate: public API surface, inference might widen
  export function createScreen(data: NewScreen): Promise<Screen> { ... }
  ```

## Literal Types and `as const`

- Use `as const` for arrays and objects whose values should be literal types, not widened:
  ```ts
  const STATUSES = ['active', 'offline', 'maintenance'] as const
  type ScreenStatus = typeof STATUSES[number]  // 'active' | 'offline' | 'maintenance'
  ```

## `satisfies` Operator

- Use `satisfies` to validate an object literal against a type without losing the literal type:
  ```ts
  const config = {
    port: 4000,
    host: 'localhost',
  } satisfies ServerConfig   // validated against ServerConfig, but type is still the literal
  ```

## Null Safety

- **Avoid non-null assertion (`!`)** — it bypasses null checks and causes runtime errors:
  ```ts
  // Bad
  const name = user!.name

  // Good
  const name = user?.name ?? 'Anonymous'
  ```
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safe access

## Generics

- Write generic constraints to be as narrow as useful — `<T extends object>` is better than `<T>`
- Avoid over-generalization — if a function only ever handles `Screen`, type it as `Screen`

## Running Type Checks

- Full monorepo check: `pnpm typecheck` (runs `turbo run typecheck` — checks all packages)
- Single package: `pnpm --filter @platform/api typecheck`
- Type errors in `packages/types` will cascade — fix them first before checking apps

## In This Repo

- Shared config in `tsconfig.base.json` at root — all packages extend it
- `@platform/types` is the canonical type package — import from there, never redefine
- The `@platform/db` package exports Drizzle inferred types — use `$inferSelect` / `$inferInsert` rather than hand-writing DB entity types
