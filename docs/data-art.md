# Data Art

Data Art turns live data into a moving 4K art piece on a screen. You pick **the data** (flights, weather or attendance) and **the art** (one of the garden video renders). The data then drives the art: the colour shifts with temperature, the speed follows the wind, and butterflies fly in as flights arrive.

In the code it's the `flight-simulation` template. The CMS shows it as **Data Art**.

> Not to be confused with **Drava Mosaic's "Data Art Studio"**. That is a separate embedded app with its own sync (`SET_DATA_ART_VIEW`).

## Data × art

Two independent choices, stored on the portfolio item:

| Choice | Options | Stored as |
|---|---|---|
| **Data source** | Flight · Weather · Attendance | `dataSource` |
| **Art render** | ART 1 – ART 6 | `artId` |

Any data source can be shown on any art render.

## The three data sources

All three check their feed every **5 minutes**.

### 1. Flight Garden: butterflies are flights
- **Butterflies are flights.** Each one is a flight in its airline's colour. It flies in, lands at a terminal, and departs.
  - T1 is domestic.
  - T2 is international.
- **Wind sets the pace.** Calm air plays the garden at normal speed. 18–38 km/h nudges it up to 1.1×.
- **HUD (heads-up display):**
  - **Tower:** the airport name and a live-feed dot.
  - **Counters:** Arrivals, Departures, Landed, Active.
  - **Carriers in Garden:** a colour key of the airlines.
  - **Flight Detail:** hover or tap a butterfly to see its flight number, airline, route, status, terminal, zone and altitude. Click it to pin it.
- **Airports:** BLR, DEL, BOM, MAA, HYD and LHR, with a picker on the HUD.
- **Airlines:** Air India, IndiGo, Vistara, Emirates, Qatar, Lufthansa and British Airways.
- **The flight board is simulated.** The API generates a realistic schedule, which stays the same for each minute. It is not a live aviation feed, but the data format is ready for a real provider to be swapped in.

### 2. Weather Garden: temperature colours the garden
- **Temperature recolours the render** smoothly across 9 bands:

  | Band | Temperature | Colour |
  |---|---|---|
  | Freezing | ≤4 °C | deep blue |
  | Chilly | 5–9 °C | light blue |
  | Cool | 10–14 °C | mint |
  | Mild | 15–19 °C | green |
  | Warm | 20–24 °C | pale yellow |
  | Summer | 25–29 °C | soft orange |
  | Hot | 30–34 °C | dark orange |
  | Very Hot | 35–39 °C | red |
  | Extreme Heat | 40 °C+ | magenta |

- **Wind sets the pace**, the same way as in the Flight Garden.
- **Locations** (picker on the HUD): Bengaluru, Reykjavik, Oslo, London, New York, Tokyo, Dubai, Cairo, Sydney and Rio de Janeiro.
- **Manual override:**
  - Type a temperature (−10 to 40 °C) and a wind speed (0 to 60 km/h) to demo any weather.
  - **Realtime** goes back to the live feed.
- **Source:** WeatherAPI.

### 3. Attendance Art: presence colours the garden
- Today's **Present / Absent / Late** counts paint the garden with green, red and orange patches, each sized by its share of the total.
- The HUD shows the three counts and calls out "Mostly Present", "Mostly Late" or "Mostly Absent".
- **Source:** the trava-app attendance API.

## The art renders

| Art | Description | Status |
|---|---|---|
| ART 1 (`flight-garden`) | Original Flight Garden 4K render, the default | Live |
| ART 2 (`weather-warm`) | Thermal warm render | Live |
| ART 3 – ART 6 (`art-3` … `art-6`) | New garden renders | Reserved: greyed out as "Not uploaded" until the video is in the bucket |

- **Storage.** Each render is roughly 1 GB of 4K video in a **private Cloudflare R2 bucket**. The API hands the screen a signed link that lasts 6 hours. The bucket stays private and the keys stay on the server.
- **Availability check.** The CMS asks R2 whether each render really exists. The answer is cached for 60 seconds, so a new upload shows up on the next page load without a redeploy.
- **Colour correction.** Each render records its own base colour. Weather and attendance colours therefore land correctly even on a render that isn't red.

## Setting it up (editor)

**Portfolio → item → Edit content** opens a full-screen editor with a live preview of the real scene.

| Field | What it does | Default |
|---|---|---|
| Airport | The airport the garden opens on (list comes from the API) | BLR |
| Tower label | Replaces the HUD title; leave blank to use the airport's own name | blank |
| Show HUD | Tower, counters, legend and flight detail. Turn off for an ambient wall | on |
| Allow airport switching | Shows the airport picker. Turn off for unattended screens | on |
| Simulation speed | How busy the airspace feels: 0.5× to 2× | 1× |
| Flight data refresh | How often to pull a new flight board, in seconds (0 turns it off) | 60 |

Saving re-pushes the item to every screen currently showing it.

## Live control panel

On a screen's live control page, a **DATA ART Control Panel** appears whenever that screen is showing Data Art. It's at Our Story → publish → live, or Screens → Control.

1. **Select DATA Source:** Flight Garden, Weather Garden or Attendance Art.
2. **Video Preview:** a looping preview of the chosen render.
3. **Select ART Style:** ART 1 – ART 6. Renders that haven't been uploaded are greyed out.

- **Every pick goes to the wall immediately.**
- **Generate** saves the current data + art pair as the item's default, so a reboot comes back to it. It keeps everything else set in the editor (airport, label, HUD, speed).

## How the wall and the CMS stay in sync
- **What syncs.** One message, `SET_FLIGHT_VIEW`, carries the whole HUD state: data source, art, airport, weather location and any manual temperature or wind.
- **It works both ways.** A change made on the control panel, on a CMS mirror, or by someone touching the wall's own HUD shows up on every other client of that screen.
- **Reconnects.** A TV that reconnects, or a mirror that reopens, gets the last view replayed, even before the 3D engine has finished loading.
- **No loops.** The message always carries the full view, never a change. The echo the server sends back is therefore harmless.

## Pushing and scheduling
- **Pushing.** Data Art is pushed like any portfolio item: the publish board, the push-to-screen dialog, or a screen's assignment picker.
- **Scheduling.** It **can't** be put in a schedule or a motion trigger. Those only play images and videos. To show it at set times, push it manually.

## Built never to go blank
- **No loading screen.** The garden renders straight away from built-in airport and airline tables, then switches to live data when it arrives.
- **Flight board fallback.** If the board can't be fetched, or comes back empty, the garden runs on locally generated traffic. The HUD's live dot shows `connecting`, `live` or `simulated`. Retries back off from 5 s to 60 s.
- **Video fallback.** If a render fails to load, it falls back to ART 1. If that fails too, a still garden image (`garden.png`) is shown.
- **Feed fallback.** If the weather or attendance provider is down, the scene keeps rendering without the live reading instead of going blank.
- **Smooth scene switches.** Changing scene fades through a short veil. The other scenes' videos are pre-loaded in the background, so switching back is instant.
- **Signage-friendly rendering.** Pixel density is capped at 2× so weak GPUs on 4K TVs keep a smooth frame rate. Viewers who have turned on reduced motion get a calmer version.

## API (`/api/flight-simulation/*`, public, used by the TV)

| Endpoint | Returns |
|---|---|
| `GET /airports` | Airports, airlines, city names, domestic route codes |
| `GET /flights?airport=BLR&limit=24&seed=` | A generated flight board (stable per minute unless `seed` is given) |
| `GET /arts` | The art catalogue with a real `available` flag per render |
| `GET /wind?location=<id>` | Wind (km/h), temperature (°C) and conditions from WeatherAPI. Only listed locations are accepted |
| `GET /attendance` | Present / absent / late counts from trava-app |
| `GET /garden-video?id=<artId>` | A 302 redirect to a signed R2 link. Only known art IDs are signed |

Provider keys never reach the browser: the API calls the providers on the screen's behalf.

## Configuration (API environment)

| Variable | Needed for |
|---|---|
| `WEATHERAPI_KEY` | Wind and temperature (all scenes' pace; the Weather Garden's colour) |
| `TRAVA_ATTENDANCE_API_URL`, `TRAVA_ATTENDANCE_WORKSPACE_ID`, `TRAVA_ATTENDANCE_API_KEY` | Attendance Art |
| `FLIGHT_R2_ACCESS_KEY_ID`, `FLIGHT_R2_SECRET_ACCESS_KEY`, `FLIGHT_R2_BUCKET`, `FLIGHT_R2_ENDPOINT`, `FLIGHT_R2_REGION` (optional, default `auto`) | The video renders |

**R2 CORS: the bucket must allow the display's origin.** Otherwise the screen can't use the video, and it quietly falls back to the still image.

## Adding a new scene or render
- **New scene:** copy the `template` block at the bottom of `SCENES` in `flight-garden.js`. Point it at a data endpoint, and proxy any keyed API through `routes/flight-simulation.ts`.
- **New render:** add its ID to `VIDEO_KEYS` in `apps/api/src/services/flight-video.ts`, which is the list of allowed IDs, and to `ART_CATALOG` in `packages/types/src/flight-art.ts`. Then upload the MP4 to the bucket.

## Files

| Area | Path |
|---|---|
| Content shape and defaults | `packages/ui/src/templates/flight-simulation/content.ts` |
| Art catalogue, data sources | `packages/types/src/flight-art.ts` |
| Flight data types | `packages/types/src/flight-simulation.ts` |
| 3D engine, scenes, HUD | `packages/ui/src/templates/flight-simulation/engine/` (`flight-garden.js`, `dom.ts`, `types.ts`) |
| React wrapper and data hook | `flight-simulation-renderer.tsx`, `flight-simulation-canvas.tsx`, `use-flight-data.ts` |
| Editor | `apps/cms/src/templates/flight-simulation/editor-workspace.tsx` |
| Live control panel | `apps/cms/src/components/data-art-control-panel.tsx` |
| API routes | `apps/api/src/routes/flight-simulation.ts` |
| R2 signing and allowed render IDs | `apps/api/src/services/flight-video.ts` |
| Airports, flights, locations | `apps/api/src/services/flight-catalog.ts`, `flight-generator.ts`, `flight-locations.ts` |
| 3D assets | `apps/cms/public/media/flight-garden/` |
| Tests | `apps/api/test/flight-simulation.test.ts`, `flight-scene-feeds.test.ts`, `packages/ui/test/flight-garden-dom.test.ts`, `flight-simulation-content.test.ts` |

## Not done yet
- **Art thumbnails.** The catalogue points at `/media/flight-garden/art/*.jpg`, but those images aren't in the repo. The panel shows text tiles.
- **ART 3 – ART 6 videos.** Not uploaded; the IDs are reserved.
- **A toggle back to the screen mirror from the panel.** Listed as open in `docs/data-art-control-panel-plan.md`.
- **Real flight data.** The board is generated. A real aviation provider can replace the generator without changing the screen.
