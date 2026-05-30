# infra/ — Infrastructure Directory

> **Contains:** Configuration for all backing services — NOT application code.
> **What runs here:** Docker containers (Postgres, Mosquitto, Nginx)
> **What doesn't run here:** Node.js apps (those live in apps/)

---

## What Lives Here

```
infra/                     ← YOU ARE HERE
├── docker/                → Docker Compose stack (spins up all services)
├── nginx/                 → Nginx reverse proxy config
├── mosquitto/             → Eclipse Mosquitto MQTT broker config
└── scripts/               → bootstrap and utility shell scripts
```

---

## The Relationship Between infra/ and apps/

```
infra/ provides the FOUNDATION that apps/ runs on top of:

infra/docker → starts PostgreSQL :5432
                       │
                       └── apps/api uses DATABASE_URL to connect

infra/docker → starts Mosquitto :1883 + :9001
                       │
                       └── apps/api → @platform/iot connects to :1883
                           browser → subscribes to :9001 (WebSocket MQTT)

infra/docker → starts Nginx :80
                       │
                       ├── cms.platform.local → apps/cms :3000
                       ├── screens.platform.local → apps/screens :3001
                       └── api.platform.local → apps/api :4000
```

---

## Start Order

```
1. docker compose up -d          (starts all infra services)
   ├── postgres starts first     (no deps)
   ├── mosquitto starts          (no deps)
   └── nginx starts              (after postgres + mosquitto)

2. pnpm dev                      (starts all Node.js apps)
   ├── @platform/api :4000  connects to postgres + mosquitto
   ├── @platform/cms :3000  connects to api :4000
   └── @platform/screens :3001 connects to api :4000 + :4000/ws
```

---

## Go Deeper

- [`docker/structure.md`](./docker/structure.md)
- [`nginx/structure.md`](./nginx/structure.md)
- [`mosquitto/structure.md`](./mosquitto/structure.md)
- [`scripts/structure.md`](./scripts/structure.md)
