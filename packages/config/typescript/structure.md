# packages/config/typescript — TypeScript Configuration

> **Contains:** Shared TypeScript compiler options for the entire monorepo.

---

## What Lives Here

```
packages/config/typescript/  ← YOU ARE HERE
└── base.json                → shared TypeScript compiler options
```

---

## File: `base.json`

The complete strict TypeScript configuration applied across all packages and apps.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## Every Option Explained

| Option | What it prevents / enables |
|---|---|
| `target: "ES2022"` | Outputs modern JS — async/await, optional chaining, nullish coalescing are native |
| `lib: ["DOM", "ES2022"]` | Makes browser APIs (document, fetch) + ES2022 globals available |
| `module: "NodeNext"` | Uses Node.js ESM resolution (`.js` extensions required in imports) |
| `moduleResolution: "NodeNext"` | TypeScript understands `package.json` `exports` field |
| `resolveJsonModule: true` | Can `import data from './data.json'` directly |
| `allowJs: true` | `.js` files are allowed alongside `.ts` |
| `checkJs: false` | Doesn't type-check `.js` files (only `.ts`) |
| `strict: true` | Master switch — enables the 8 strict options below |
| `noImplicitAny` | `function f(x)` without a type → error (must be `f(x: string)`) |
| `strictNullChecks` | `null` and `undefined` are distinct types — must handle them |
| `strictFunctionTypes` | Function types are checked strictly for param contravariance |
| `noImplicitThis` | `this` in a function without a type annotation → error |
| `alwaysStrict` | Emits `"use strict"` in all output files |
| `noUnusedLocals` | Declared variable never used → compile error |
| `noUnusedParameters` | Declared function param never used → compile error |
| `noImplicitReturns` | A function that sometimes returns T and sometimes returns nothing → error |
| `noFallthroughCasesInSwitch` | `case 'a': doThing()` without `break` → error |
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined` — must null-check before use |
| `esModuleInterop` | Allows `import fs from 'fs'` (default import for CommonJS modules) |
| `skipLibCheck` | Skips type-checking `.d.ts` files in `node_modules` — much faster builds |
| `forceConsistentCasingInFileNames` | `import './MyFile'` and `import './myfile'` are the same file on Windows — error |
| `declaration: true` | Generates `.d.ts` type definition files alongside compiled JS |
| `declarationMap: true` | Maps `.d.ts` back to source `.ts` — "go to definition" in IDE shows source |
| `sourceMap: true` | Maps compiled `.js` back to source `.ts` — debugger shows TypeScript lines |

---

## How Each Package Uses This

Every `tsconfig.json` in the monorepo starts with:
```json
{
  "extends": "../../tsconfig.base.json"
}
```

Then adds only what's specific to that package:
```json
// packages/iot/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",    ← where compiled JS goes
    "rootDir": "./src"     ← where source TS lives
  },
  "include": ["src/**/*"]
}
```

```json
// apps/cms/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,                 ← Next.js compiles, not tsc
    "moduleResolution": "bundler",  ← overrides base for Next.js
    "jsx": "preserve"               ← Next.js handles JSX transform
  }
}
```
