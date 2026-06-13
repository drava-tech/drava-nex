# Hono 4 — Best Practices

Source: hono.dev/docs/guides/best-practices (official, fetched June 2026) + secondsky/claude-skills community skill.

Used in: `apps/api` (port 4000). Runtime: Node.js via `@hono/node-server`.

---

## Handler Organization

- **Write handlers inline** after path definitions — do not create separate controller files

```ts
// Bad: separate controller (breaks type inference for path params)
import { screensController } from './controllers/screens'
app.get('/screens/:id', screensController.getById)

// Good: inline handler
app.get('/screens/:id', (c) => {
  const id = c.req.param('id')  // fully typed
  return c.json({ id })
})
```

- When you must extract handlers for organization, use `factory.createHandlers()` from `hono/factory` to preserve type inference:

```ts
import { createFactory } from 'hono/factory'
const factory = createFactory()

const getScreen = factory.createHandlers((c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

app.get('/screens/:id', ...getScreen)
```

## Composing Large Applications

- Use `app.route()` to split endpoints into separate Hono instances, then mount them:

```ts
// screens.ts
const screens = new Hono()
screens.get('/', (c) => c.json({ screens: [] }))
screens.get('/:id', (c) => c.json({ id: c.req.param('id') }))
export default screens

// index.ts
import screens from './screens'
app.route('/api/screens', screens)
```

## RPC Type Safety

- Always export the app type for end-to-end type safety:

```ts
const app = new Hono()
  .get('/api/screens', (c) => c.json({ screens: [] }))

export type AppType = typeof app  // export this for hc() client
export default app
```

- On the client: `const client = hc<AppType>('http://localhost:4000')`

## Middleware

- **Always `await next()`** in middleware — omitting it silently breaks the rest of the chain:

```ts
app.use('*', async (c, next) => {
  console.log('before')
  await next()              // required
  console.log('after')
})
```

- **Throw `HTTPException`** from middleware instead of returning a response directly:

```ts
import { HTTPException } from 'hono/http-exception'

app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token) throw new HTTPException(401, { message: 'Unauthorized' })
  await next()
})
```

## Validation

- Use **validation middleware** (with Zod or Valibot via `@hono/zod-validator`) — not hooks — for request validation:

```ts
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

app.post('/screens', zValidator('json', z.object({ name: z.string() })), (c) => {
  const { name } = c.req.valid('json')  // fully typed, validated
  return c.json({ name }, 201)
})
```

## Typed Context Variables

- Define a `Variables` type to avoid untyped `c.get()`:

```ts
type Variables = { userId: string }
const app = new Hono<{ Variables: Variables }>()

app.use('*', async (c, next) => {
  c.set('userId', 'abc123')
  await next()
})

app.get('/me', (c) => {
  const userId = c.get('userId')  // string, not unknown
  return c.json({ userId })
})
```

## HEAD Requests

- Hono automatically converts HEAD requests to GET and strips the response body — never create dedicated HEAD route handlers
- Do not use `app.on('HEAD', ...)` — the framework intercepts HEAD before route matching

## Error Handling

- Register a global error handler with `app.onError()` for consistent error responses:

```ts
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  return c.json({ error: 'Internal Server Error' }, 500)
})
```

- Register a 404 handler with `app.notFound()`:

```ts
app.notFound((c) => c.json({ error: 'Not Found' }, 404))
```
