# .agent/

This folder is a persistent briefing pack for any Claude Code session working in this repository. It answers the question: "What do I need to know to work effectively in this codebase right now?"

## How to use it

Read in this order:

1. **[context.md](context.md)** — Project identity, apps, ports, packages, and key commands. Start here every session.
2. **[skills.md](skills.md)** — Which Claude Code built-in skills (`/run`, `/verify`, etc.) are relevant and how to invoke them in this project.
3. **[workflows.md](workflows.md)** — Five named task patterns covering the most common dev tasks, with which skills to reach for.
4. **[skills/](skills/)** — Open-source best practice skill files for each technology in the stack. Reference when writing or reviewing code in that layer.

## Skill files in `skills/`

| File | Technology |
|---|---|
| [skills/nextjs.md](skills/nextjs.md) | Next.js 15 App Router |
| [skills/react.md](skills/react.md) | React 19 |
| [skills/hono.md](skills/hono.md) | Hono 4 API |
| [skills/drizzle.md](skills/drizzle.md) | Drizzle ORM |
| [skills/tailwind.md](skills/tailwind.md) | Tailwind CSS 4 |
| [skills/turborepo.md](skills/turborepo.md) | Turborepo + pnpm workspaces |
| [skills/typescript.md](skills/typescript.md) | TypeScript strict mode |

## What is NOT here

- Detailed tech docs — see `.doc/`
- Folder/file structure — see `structure.md` files per app/package
- Git history and change rationale — see `git log`
