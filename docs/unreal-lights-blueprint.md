# Controlling the lights from Unreal Engine (Blueprints)

Unreal talks to the CMS backend over plain HTTP, using the same API the CMS Lights page uses.
**No backend changes are needed.** Unreal logs in with a CMS account, gets a token, and sends
that token with every light command.

```
Unreal ──POST /api/auth/sign-in/email──►  CMS backend  ──► returns { token }
Unreal ──POST /api/devices/lights/<id>/state  (Authorization: Bearer <token>) ──► light changes
```

---

## 0. Before you start

| Requirement | How to check |
|---|---|
| The Unreal PC is on the office LAN | Open `http://192.168.1.250/health` in a browser on that PC. It should show `"status":"ok"` |
| The CMS account is an **ADMIN** | Log into the CMS with it. If you can open the **Lights** page, the account is fine |
| Account used | `experience@thewhitetusker.com` |

---

## 1. One-time project setup

### 1.1 Install the VaRest plugin (HTTP and JSON for Blueprints)
1. Find **VaRest** on Fab (it's free) and click **Install to Engine**.
2. In your project, go to **Edit → Plugins**, search for `VaRest`, tick **Enabled**, and restart the editor.

> VaRest node names differ slightly between versions: *Construct Json Request* is called
> *Construct Va Rest Request* in some. If a node below doesn't show up, right-click and search for `request` or `json`.

### 1.2 Create the Game Instance
The Game Instance lives for the whole game, so the token survives level changes.

1. In the Content Browser, **right-click → Blueprint Class → All Classes → GameInstance**.
2. Name it `BP_CmsGameInstance`.
3. Go to **Project Settings → Maps & Modes → Game Instance Class** and select `BP_CmsGameInstance`.

### 1.3 Add these variables to `BP_CmsGameInstance`

| Variable | Type | Default value |
|---|---|---|
| `BaseUrl` | String | `http://192.168.1.250` |
| `Email` | String | `experience@thewhitetusker.com` |
| `Password` | String | *(the account password; see section 6)* |
| `Token` | String | *(empty)* |
| `Lights` | VaRest Json Object, **Array** | *(empty)* |
| `Scenes` | VaRest Json Object, **Array** | *(empty)* |
| `RetryPending` | Boolean | false |
| `LastLightId` | String | *(empty)* |
| `LastOn` | Boolean | false |
| `LastBrightness` | Integer | 100 |

Build everything below inside `BP_CmsGameInstance`.

---

## 2. Step 1: Log in when the game starts

### 2.1 Custom Event `Login`

```
Event Init ─────────────────────────────► Login

Custom Event "Login"
  │
  ├─ Construct Json Object                          → promote to local: Body
  │    ├─ Set String Field   Field "email"      Value = Email
  │    └─ Set String Field   Field "password"   Value = Password
  │
  ├─ Construct Json Request (VaRest Subsystem)      → promote to local: Req
  ├─ Req → Set Verb            = POST
  ├─ Req → Set Content Type    = Json
  ├─ Req → Set Request Object  = Body
  ├─ Req → Bind Event to On Request Complete  ──►  OnLoginDone
  └─ Req → Process URL         URL = Append(BaseUrl, "/api/auth/sign-in/email")
```

### 2.2 Custom Event `OnLoginDone` (input: Request)

```
Custom Event "OnLoginDone" (Request)
  └─ Branch ( Request → Get Response Code == 200 )
       True:
         ├─ Request → Get Response Object → Get String Field "token" → SET Token
         ├─ Print String "CMS login OK"
         ├─ LoadDevices                                (step 2)
         └─ Branch (RetryPending)                      (step 3)
              True → SET RetryPending = false
                   → SetLight(LastLightId, LastOn, LastBrightness)
       False:
         └─ Print String  Append("CMS login FAILED: ", Response Code)
```

**Response on success:** `{ "token": "abc123...", "user": { ... } }`

---

## 3. Step 2: Send the token with every call

Every request after login needs this header:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <Token>`, built with `Append("Bearer ", Token)` (note the space after `Bearer`) |
| `Content-Type` | JSON (set with **Set Content Type = Json** on requests that have a body) |

### 3.1 Custom Event `LoadDevices`: get the light and scene IDs

```
Custom Event "LoadDevices"
  ├─ Construct Json Request                         → Req
  ├─ Req → Set Verb    = GET
  ├─ Req → Set Header  Name "Authorization"  Value = Append("Bearer ", Token)
  ├─ Req → Bind Event to On Request Complete  ──►  OnDevicesLoaded
  └─ Req → Process URL   Append(BaseUrl, "/api/devices")

Custom Event "OnDevicesLoaded" (Request)
  └─ Switch on Int ( Request → Get Response Code )
       200:
         ├─ Clear Lights, Clear Scenes
         └─ Get Response Object → Get Object Array Field "data" → For Each Loop
              ├─ Get String Field "type"
              ├─ == "light" → Add to Lights
              ├─ == "scene" → Add to Scenes
              └─ Print String  Append(type, " | ", Get String Field "name", " | ", Get String Field "id")
       401:  → Login
       Default: Print String Append("LoadDevices failed: ", code)
```

**The response looks like this:**
```json
{
  "success": true,
  "data": [
    { "id": "7f3c...", "deviceId": "casambi-light-23", "type": "light", "name": "Strip Light",
      "state": { "on": true, "brightness": 80 } },
    { "id": "a91e...", "deviceId": "scene-...", "type": "scene", "name": "Welcome" }
  ]
}
```

> Always use the **`id`** field in URLs, **not** `deviceId`.
> Run the game once, read the printed list, and copy the IDs you need.

### 3.2 Custom Event `SetLight`: on, off, brightness and colour

**Inputs:** `LightId` (String), `On` (Boolean), `Brightness` (Integer, 0–100)

```
Custom Event "SetLight" (LightId, On, Brightness)
  ├─ SET LastLightId = LightId, LastOn = On, LastBrightness = Brightness   (for retry)
  │
  ├─ Construct Json Object                          → Body
  │    ├─ Set Bool Field     "on"          = On
  │    └─ Set Number Field   "brightness"  = Brightness
  │    (optional) Set String Field "color" = "#FF8800"
  │
  ├─ Construct Json Request                         → Req
  ├─ Req → Set Verb            = POST
  ├─ Req → Set Content Type    = Json
  ├─ Req → Set Header          "Authorization" = Append("Bearer ", Token)
  ├─ Req → Set Request Object  = Body
  ├─ Req → Bind Event to On Request Complete  ──►  OnSetLightDone
  └─ Req → Process URL   Append(BaseUrl, "/api/devices/lights/", LightId, "/state")
```

**Body that gets sent:** `{ "on": true, "brightness": 80 }`

### 3.3 Custom Event `TriggerScene`: apply a saved light preset

**Input:** `SceneId` (String). Use an `id` from the `Scenes` list.

```
Custom Event "TriggerScene" (SceneId)
  ├─ Construct Json Request → Req
  ├─ Set Verb = POST
  ├─ Set Header "Authorization" = Append("Bearer ", Token)
  ├─ Bind Event to On Request Complete ──► OnSimpleDone
  └─ Process URL  Append(BaseUrl, "/api/devices/scenes/", SceneId, "/trigger")
```

### 3.4 Custom Event `TriggerCasambiScene`: recall a scene saved in the Casambi app

**Input:** `SceneNumber` (Integer, 1–255)

```
Custom Event "TriggerCasambiScene" (SceneNumber)
  ├─ Construct Json Object → Body → Set Number Field "scene" = SceneNumber
  ├─ Construct Json Request → Req
  ├─ Set Verb = POST,  Set Content Type = Json
  ├─ Set Header "Authorization" = Append("Bearer ", Token)
  ├─ Set Request Object = Body
  ├─ Bind Event to On Request Complete ──► OnSimpleDone
  └─ Process URL  Append(BaseUrl, "/api/devices/lights/casambi-scene")
```

---

## 4. Step 3: Log in again automatically when the token expires

A token lasts **7 days** and each use pushes that out. Unreal must still handle a `401`
(expired token, password changed, backend restarted with a new secret) without getting stuck.

```
Custom Event "OnSetLightDone" (Request)
  └─ Switch on Int ( Request → Get Response Code )
       200:     Print String "Light OK"
       401:     SET RetryPending = true  →  Login
       Default: Print String Append("SetLight failed: ", code)

Custom Event "OnSimpleDone" (Request)
  └─ Switch on Int ( Get Response Code )
       200:     Print String "OK"
       401:     Login
       Default: Print String Append("Failed: ", code)
```

`OnLoginDone` (section 2.2) sees `RetryPending = true` and replays the last `SetLight`, so a
light command is never lost to an expired token.

---

## 5. Using it from any level or actor

```
Get Game Instance → Cast To BP_CmsGameInstance → SetLight ( "7f3c...", true, 80 )
Get Game Instance → Cast To BP_CmsGameInstance → TriggerScene ( "a91e..." )
```

Example: a trigger box that turns a light on when the player walks in:

```
OnActorBeginOverlap → Get Game Instance → Cast To BP_CmsGameInstance
                   → SetLight ( "7f3c...", true, 100 )
OnActorEndOverlap   → ... → SetLight ( "7f3c...", false, 0 )
```

---

## 6. Keep the password out of the Blueprint (packaged builds)

Anyone who has the game build can read a password stored as a Blueprint default value.
For shipped builds, put it in a config file instead:

1. Create `Config/DefaultGame.ini` in the project (or edit the existing one) and add:
   ```ini
   [CmsSettings]
   Email=experience@thewhitetusker.com
   Password=your-password-here
   ```
2. In `Event Init`, before `Login`, read the values with **Get Config String**
   (in some versions this comes from a small config plugin; if it's missing, keep the variables for now).

> If you change the password of `experience@thewhitetusker.com` in the CMS, **update it here too**.
> Otherwise Unreal gets `401` on every login.

---

## 7. API reference

Base URL: `http://192.168.1.250`

| Action | Method | URL | Body |
|---|---|---|---|
| Log in | POST | `/api/auth/sign-in/email` | `{ "email": "...", "password": "..." }` |
| List devices | GET | `/api/devices` | none |
| One device's status | GET | `/api/devices/<id>/status` | none |
| Set a light | POST | `/api/devices/lights/<id>/state` | `{ "on": true, "brightness": 0-100, "color": "#RRGGBB" }` (`brightness` and `color` optional) |
| Flash a light (identify) | POST | `/api/devices/lights/<id>/identify` | none |
| Trigger a saved preset | POST | `/api/devices/scenes/<id>/trigger` | none |
| Recall a Casambi scene | POST | `/api/devices/lights/casambi-scene` | `{ "scene": 1-255, "level": 0-255 }` (`level` optional) |

Every call except login needs `Authorization: Bearer <token>`.

---

## 8. Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `401` | Not logged in, or the token expired | Step 3 handles it. If login itself fails, check the email and password |
| `403` on login | The body wasn't sent as JSON | Set **Content Type = Json** on the login request |
| `403` on light calls | The account isn't ADMIN | Change the role in CMS → Users |
| `404 Device not found` | Wrong ID | Use `id` from `LoadDevices`, not `deviceId` |
| `400 VALIDATION` | Bad body | `on` must be a bool, `brightness` a number from 0 to 100 |
| No response / code `0` | The PC can't reach the server | Open `http://192.168.1.250/health` in a browser on that PC |
| `200` but the light doesn't change | Hardware or MQTT bridge problem, not Unreal | Try the same light from the CMS Lights page |

You can test the API without Unreal from a terminal:
```bash
curl -i -X POST http://192.168.1.250/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"experience@thewhitetusker.com","password":"..."}'
# copy "token" from the response, then:
curl http://192.168.1.250/api/devices -H "Authorization: Bearer <token>"
```
