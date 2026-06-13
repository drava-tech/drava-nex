# Tailwind CSS 4 — Best Practices

Source: tailwindcss.com docs (official, fetched June 2026) + blencorp/claude-code-kit community skill.

Used in: `packages/ui` (shared component library). Tailwind 4 is in use — no `tailwind.config.js`.

---

## Core Principle

Use utility classes directly in JSX. Do not write custom CSS unless the design token system genuinely cannot express it.

## Tailwind 4 Changes

- **No `tailwind.config.js`** — design tokens are defined in CSS using `@theme`:

```css
/* packages/ui/src/globals.css */
@import "tailwindcss";

@theme {
  --color-brand: #2563eb;
  --spacing-card: 1.5rem;
}
```

- Use CSS custom properties for dynamic theming; `@theme` values generate utility classes automatically
- `@variant` replaces some plugin patterns from v3

## Class Composition (already set up in `@platform/ui`)

Use the utilities already in the shared package — do not install duplicates in apps:

- **`clsx`** — merge conditional class strings:
  ```ts
  clsx('base-class', condition && 'conditional-class', { 'other': flag })
  ```
- **`tailwind-merge` (`twMerge`)** — resolve conflicting Tailwind classes (last wins):
  ```ts
  twMerge('px-4 py-2', 'px-8')  // → 'py-2 px-8'
  ```
- **`class-variance-authority` (CVA)** — define component variants:
  ```ts
  const button = cva('base px-4 py-2 rounded', {
    variants: {
      intent: { primary: 'bg-blue-600 text-white', secondary: 'bg-gray-200' },
      size: { sm: 'text-sm', lg: 'text-lg px-6 py-3' },
    },
    defaultVariants: { intent: 'primary', size: 'sm' },
  })
  ```

## Class Organization

Group classes in this order for readability:
1. Layout: `flex`, `grid`, `block`, `hidden`, `relative`, `absolute`
2. Sizing: `w-*`, `h-*`, `min-*`, `max-*`
3. Spacing: `p-*`, `m-*`, `gap-*`
4. Typography: `text-*`, `font-*`, `leading-*`, `tracking-*`
5. Color: `bg-*`, `text-*`, `border-*`
6. Interactive: `hover:*`, `focus:*`, `active:*`, `disabled:*`
7. Responsive: `sm:*`, `md:*`, `lg:*`

Install `prettier-plugin-tailwindcss` to auto-sort classes on save.

## Arbitrary Values

- Avoid `w-[347px]` and similar arbitrary values — prefer design token classes
- Use arbitrary values only for genuine one-offs that should not become tokens
- If you use an arbitrary value more than twice, promote it to `@theme`

## Where Styles Live

- **Component-level styles** → in the component file (`packages/ui/src/components/`)
- **Global/base styles** → `packages/ui/src/globals.css` only (resets, `@theme`, `@layer base`)
- **App-level overrides** → avoid; instead, extend the shared UI or use CVA variants
- Do not duplicate `globals.css` content in individual app CSS files

## IDE Setup

- Install **Tailwind CSS IntelliSense** (VS Code extension `bradlc.vscode-tailwindcss`) for:
  - Autocomplete for all utility classes including custom `@theme` tokens
  - Hover to see the generated CSS
  - Linting for invalid class names

## Responsive Design

- Mobile-first: write base styles for mobile, then add `sm:`, `md:`, `lg:` overrides
- The screen player (`apps/screens`) targets fixed display resolutions — use `w-screen h-screen` and avoid fluid/responsive breakpoints there

## Dark Mode

- Use `dark:` variant if dark mode is needed
- Wire dark mode via a class on `<html>` (class strategy) rather than media query for operator-controlled theming
