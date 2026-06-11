# Networking, Ports & Routing Architecture

This document maps the network ports and proxy configurations utilized for routing requests across the monorepo services.

---

## 1. Network Ports Registry

| Service | Port | Layer | Context |
|---|---|---|---|
| **NGINX Reverse Proxy** | `80` | Web Routing | Listens to all inbound web queries and routes them to apps. |
| **Next.js CMS Dashboard** | `3000` | Frontend App | Admin controller dashboard. |
| **Next.js Screen Player** | `3001` | Edge App | Displays playlists on screens. |
| **Hono API Server** | `4000` | Backend App | Processes HTTP REST endpoints and WS connections. |
| **PostgreSQL Server** | `5432` | Data Service | SQL database storage service. |
| **Mosquitto Broker** | `1883` | IoT Service | MQTT protocol channel. |
| **Mosquitto WebSocket** | `9001` | IoT Service | WebSocket-based MQTT client channel. |

---

## 2. Infrastructure Services (Docker Compose)
Backing services run isolated inside Docker containers managed via `infra/docker/docker-compose.yml`:
* **postgres-db**: Spins up a PostgreSQL server mapped to port `5432`.
* **mosquitto-broker**: Runs Mosquitto MQTT broker on ports `1883` and `9001`.
* **nginx-proxy**: Binds to standard port `80` to route local domains.

---

## 3. Reverse Proxy Routing (NGINX)
Nginx intercepts traffic at port `80` and distributes it to the Node.js application servers according to the hostname:

* `http://cms.platform.local` ──► Proxies requests to Next.js CMS (`localhost:3000`)
* `http://screens.platform.local` ──► Proxies requests to Next.js Screen Player (`localhost:3001`)
* `http://api.platform.local` ──► Proxies requests to Hono API Gateway (`localhost:4000`)
