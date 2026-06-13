# Next.js 15 App Router — Best Practices

Source: Next.js official docs (nextjs.org), fetched June 2026. Applies to Next.js 15 with App Router and React 19.

Used in: `apps/cms` (port 3000) and `apps/screens` (port 3001).

---

## Server vs Client Components

- **Default is Server Component** — pages, layouts, and all components are Server Components unless marked otherwise
- Add `'use client'` only when you need: state (`useState`), event handlers (`onClick`, `onChange`), lifecycle effects (`useEffect`), or browser-only APIs (`localStorage`, `window`, `navigator`)
- **Never add `'use client'` to pages or layouts** — push the boundary as deep as possible into the tree
- Once a file is marked `'use client'`, all of its imports and directly rendered components become client bundle — mark strategically

```tsx
// Bad: entire layout is client-side
'use client'
export default function Layout({ children }) { ... }

// Good: only the interactive piece is a Client Component
import Search from './search'   // 'use client' inside search.tsx
export default function Layout({ children }) {
  return <><nav><Search /></nav><main>{children}</main></>
}
```

## Composing Server and Client Components

- Pass Server Components as `children` or props into Client Components — they render on the server regardless
- Use the `children` slot pattern to nest server-rendered content inside a client wrapper:

```tsx
// modal.tsx
'use client'
export default function Modal({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>  // children renders on server
}

// page.tsx (Server Component)
import Modal from './modal'
import Cart from './cart'        // Cart is a Server Component
export default function Page() {
  return <Modal><Cart /></Modal> // Cart renders on server, passed to client Modal
}
```

## Data Passing

- Props from Server to Client Components **must be serializable** — no functions, class instances, or Symbols
- Fetch data in Server Components close to where it's used; pass the result down as props

## Protecting Server Code

- Use `import 'server-only'` in any file that contains secrets or server-only logic to get a build-time error if accidentally imported by a Client Component
- Only `NEXT_PUBLIC_*` env vars are included in the client bundle — all others are replaced with empty string

## Caching (Next.js 15 Cache Components)

- Use `'use cache'` directive + `cacheLife()` for data or component-level caching:

```tsx
async function BlogPosts() {
  'use cache'
  cacheLife('hours')
  cacheTag('posts')
  const posts = await db.query.posts.findMany()
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
}
```

- **Do not cache** components that need fresh data on every request — wrap them in `<Suspense>` instead
- Pass runtime values (from `cookies()`, `headers()`) as arguments to cached functions — they become part of the cache key

## Streaming and Suspense

- Wrap components that access runtime APIs (`cookies`, `headers`, `searchParams`) in `<Suspense>`:

```tsx
export default function Page() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <UserGreeting />   {/* reads cookies — must be inside Suspense */}
    </Suspense>
  )
}
```

- Components using `Math.random()`, `Date.now()`, or `crypto.randomUUID()` must either call `connection()` first (for per-request values) or use `'use cache'` (for same-value-for-all)

## Third-Party Components

- If a third-party component uses client-only features but lacks `'use client'`, wrap it:

```tsx
// carousel.tsx
'use client'
export { Carousel } from 'acme-carousel'  // re-export with client boundary
```

## Context Providers

- React context is not supported in Server Components
- Create a Client Component that wraps `children` and provides context, then import it into a Server layout
- Render providers as deep as possible — wrapping only the subtree that needs them, not the entire `<html>`

## React Context

- React context is **not** supported in Server Components
- Wrap context providers in `'use client'` components and render them as deep as possible in the tree
