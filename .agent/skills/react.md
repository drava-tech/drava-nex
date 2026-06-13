# React 19 — Best Practices

Source: react.dev/learn + react.dev/reference/rules, fetched June 2026. Applies to React 19.

Used in: `apps/cms`, `apps/screens`, `packages/ui`.

---

## The Rules of React

These are enforced rules, not guidelines. Violations cause subtle bugs that Strict Mode and the ESLint plugin will surface.

### Purity

- **Components must be idempotent** — same props + state + context must always produce the same JSX output
- **Never mutate props or state directly** — always return new objects/arrays
- **Side effects belong outside render** — put them in `useEffect`, event handlers, or Server Actions; never run them during the render phase
- **Return values and Hook arguments are immutable** — do not modify values you received from Hooks or passed to them

```tsx
// Bad: mutating props
function BadList({ items }) {
  items.push({ id: 99 })   // mutates prop — never do this
  return <ul>{items.map(...)}</ul>
}

// Good: derive new value
function GoodList({ items }) {
  const all = [...items, { id: 99 }]
  return <ul>{all.map(...)}</ul>
}
```

### Rules of Hooks

- **Only call Hooks at the top level** — never inside loops, conditions, or nested functions
- **Only call Hooks from React functions** — components or custom Hooks; never from plain JS functions

```tsx
// Bad
function Bad({ show }) {
  if (show) {
    const [count, setCount] = useState(0)  // Hook inside condition
  }
}

// Good
function Good({ show }) {
  const [count, setCount] = useState(0)   // always at top level
  if (!show) return null
}
```

### Component Invocation

- **Never call component functions directly** — always use them as JSX (`<MyComponent />`)
- **Never pass Hooks as regular values** — they can only be called inside React functions

---

## State Management

### What is state?

Only data that changes over time and causes a re-render. Apply this filter:

1. Does it remain unchanged over time? → Not state (use a constant)
2. Is it passed down via props? → Not state (read it from props)
3. Can it be computed from existing state or props? → Not state (derive it during render)

```tsx
// Bad: storing derived data as state
const [filteredItems, setFilteredItems] = useState(items.filter(...))

// Good: compute on every render (React is fast)
const filteredItems = items.filter(item => item.name.includes(filterText))
```

### Where to put state?

- State lives in the **closest common parent** of all components that need to read it
- If no existing component fits, create a wrapper component solely for state management
- Pass setter functions down as props to allow children to trigger updates (inverse data flow)

### Building order

1. Build the static version first — use only props, no state or event handlers
2. Identify the minimal state needed for interactivity
3. Wire up event handlers that call state setters (pass setters down as props if needed)

---

## Performance

- Memoize expensive computations with `useMemo` — only when you've measured a real performance problem
- Use `useCallback` to stabilize function references passed as props to memoized children
- Prefer many small, focused components over large ones — easier to memoize and reason about
- Avoid creating new objects/arrays in JSX props — they are new references on every render

---

## React 19 Additions

- **Server Actions** — async functions marked `'use server'` can be called from Client Components and passed as `action` props to forms
- **`use()` API** — read a Promise or Context inside a component (can be called conditionally, unlike Hooks)
- **`useOptimistic()`** — show an optimistic UI update immediately while a server action is in flight
- **`useActionState()`** — manage form submission state (pending, result, error) tied to a Server Action
