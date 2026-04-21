# 🌿 FloraCraft – Smart Greenhouse IoT Dashboard

A **hybrid web + mobile** dashboard for monitoring and controlling an Arduino-based smart greenhouse via Bluetooth and Supabase cloud sync.

---

## 📁 Repository Structure

```
arduinoprojectsem2/
├── arduino/
│   ├── floracraft_auto/          # Primary AUTO firmware (floracraft_auto.ino)
│   └── floracraft_test/          # Testing / calibration firmware (floracraft_test.ino)
│
├── src/
│   ├── app.html                  # ★ Main hybrid app (open in Chrome to run)
│   ├── bluetooth.js              # Web Bluetooth serial service (ZS-040/HC-05)
│   └── supabase.js               # Supabase real-time sync service
│
├── ui/
│   ├── screens/
│   │   ├── mobile/               # Stitch-generated mobile screen designs
│   │   │   ├── onboarding.html
│   │   │   ├── dashboard.html
│   │   │   ├── raw_stream.html
│   │   │   ├── plant_profiles.html
│   │   │   ├── testing_mode.html
│   │   │   └── settings.html
│   │   └── web/                  # Stitch-generated web/desktop screen designs
│   │       ├── dashboard.html
│   │       ├── raw_stream.html
│   │       ├── plant_profiles.html
│   │       ├── testing_mode.html
│   │       └── settings.html
│   └── assets/
│       ├── screenshots/          # Design reference screenshots (PNG)
│       └── design/DESIGN.md      # FloraCraft Industrial design system tokens
│
└── stitch_floracraft_iot_dashboard.zip   # Original Stitch UI export
```

---

## 🚀 Quick Start – Web App (no hardware needed for testing)

### Prerequisites
- **Google Chrome** (required for Web Bluetooth API)
- Node.js (optional – only for `npx serve`)

### Run locally

```bash
# Option A – serve with npx (recommended)
# Run from the REPO ROOT so vercel.json rewrites work (/ → /src/app.html)
npx serve .
# Then open: http://localhost:3000

# Option B – Python built-in server
python3 -m http.server 8080
# Then open: http://localhost:8080/src/app.html
```

> ⚠️ **Do not open `app.html` as a `file://` URL** – the Web Bluetooth API and
> absolute script paths (`/src/bluetooth.js`, `/src/supabase.js`) require an HTTP context.

### Deploy to Vercel

The repo includes a `vercel.json` that rewrites the root URL (`/`) to
`src/app.html`, so visiting `https://<your-project>.vercel.app/` loads the
app directly. No build step is required – it is a fully static single-page
app served from CDN assets.

---

## 🔧 Arduino Setup

### 1. Install dependencies

In the **Arduino IDE Library Manager**, install:
- **DHT sensor library** by Adafruit

### 2. Choose a firmware

| Sketch | When to use |
|--------|-------------|
| `arduino/floracraft_auto/floracraft_auto.ino` | Normal operation with full automation |
| `arduino/floracraft_test/floracraft_test.ino` | Commissioning / hardware testing |

### 3. Upload

> ⚠️ **Disconnect the ZS-040 TX/RX wires before uploading** – they share the
> hardware Serial port used for programming.

1. Open the `.ino` file in Arduino IDE
2. Select your board (`Arduino Uno` or `Nano`) and COM port
3. Click **Upload**
4. Reconnect the ZS-040 module after upload completes

---

## 📡 Connecting Bluetooth

The ZS-040 (HC-05 / HC-06) module communicates at **9600 baud** over the
Arduino's hardware Serial port (the same port used for uploading – hence the
disconnect-before-upload requirement above).

### Pairing
1. Power on the Arduino (the ZS-040's LED will blink rapidly)
2. On your phone/laptop, open Bluetooth settings and pair with the module
   - Default name: `HC-05`, `HC-06`, or `ZS-040`
   - Default PIN: **1234** or **0000**

### Connecting in the app
1. Open `http://localhost:3000/src/app.html` in Chrome
2. Tap **Connect** (top-right on mobile, sidebar badge on desktop)
3. The browser device picker will appear – select your HC-05/ZS-040
4. The status dot turns green when connected

> **Note:** Web Bluetooth works best with BLE modules. For classic Bluetooth
> HC-05/HC-06, you may need to use the [Web Serial API](https://developer.chrome.com/docs/capabilities/serial)
> instead. See `src/bluetooth.js` for the commented-out Web Serial alternative.

---

## 🌱 Plant Profiles

| Profile | TEMP_HIGH_ON | SOIL_DRY_ON | Serial command |
|---------|-------------|-------------|----------------|
| **Silvercock** | 35 °C | 55 % | `S` |
| **Shia** | 30 °C | 35 % | `H` |

Switch profiles from the **Plant Profiles** tab. The app sends a single
character (`S` or `H`) to the Arduino, which updates its threshold variables
at runtime without reflashing.

---

## 🧪 Testing Mode

1. Navigate to the **Testing** tab
2. Switch to **TEST** mode (sends `'m'` to Arduino)
3. Use the **Test Pump / Fan / Heater / Open Lid / Close Lid** buttons
4. Adjust **Pump Duration** and **Lid Transition Time** sliders, then tap
   **Send Timers to Arduino** to apply at runtime
5. Use **Stop All** (sends `'0'`) for an emergency shutdown
6. Switch back to **AUTO** (sends `'a'`) to restore automation

---

## ☁️ Supabase Cloud Sync (Gateway Integration)

The FloraCraft web app connects to the same Supabase project used by the
**FloraCraft Gateway** (the Node.js Bluetooth-to-cloud bridge).  The gateway
writes readings from the Arduino to `public.readings`; the web app reads them
in real-time and lets you send commands back via `public.commands`.

### 1 · Create the tables

Open the **SQL Editor** in your Supabase project and run:

```sql
-- ── Device registry ──────────────────────────────────────────────────────
create table if not exists public.devices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

-- ── Sensor readings (written by the gateway every ~2 s) ──────────────────
create table if not exists public.readings (
  id         bigserial primary key,
  device_id  uuid references public.devices(id),
  raw_data   text,
  temp_c     float,
  soil_pct   int,
  rain_pct   int,
  pump_on    boolean default false,
  fan_on     boolean default false,
  heater_on  boolean default false,
  lid_state  text,
  mode       text default 'AUTO',
  profile    text,
  ts         timestamptz default now()
);

-- ── Commands (queued by the web app, consumed by the gateway) ────────────
create table if not exists public.commands (
  id           bigserial primary key,
  device_id    uuid references public.devices(id),
  command      text not null,
  status       text default 'queued',
  response     text,
  sent_at      timestamptz,
  applied_at   timestamptz,
  requested_by text,
  ts           timestamptz default now()
);
```

### 2 · Enable Row Level Security (RLS) + allow anonymous access

```sql
-- readings
alter table public.readings enable row level security;
create policy "anon select readings" on public.readings for select to anon using (true);
create policy "anon insert readings" on public.readings for insert to anon with check (true);

-- commands
alter table public.commands enable row level security;
create policy "anon insert commands" on public.commands for insert to anon with check (true);
create policy "anon select commands" on public.commands for select to anon using (true);

-- devices
alter table public.devices enable row level security;
create policy "anon select devices" on public.devices for select to anon using (true);
```

> **Security note:** The policies above allow any visitor to read readings and
> queue commands.  This is fine for a home greenhouse.  For a production
> deployment add Supabase Auth and tighten the `using` / `with check` clauses.

### 3 · Enable Realtime for `readings`

In the Supabase Dashboard:
1. Go to **Database → Replication**
2. Find the `readings` table and enable the **INSERT** event

This lets the web app receive live updates via WebSocket instead of polling.

### 4 · Add your device to the `devices` table

```sql
insert into public.devices (name) values ('FloraCraft-01')
returning id;  -- note the UUID
```

Or use the **Table Editor** UI.  Copy the `id` UUID – you will need it in Step 6.

### 5 · Configure the gateway

In `FloraCraftGateway/.env` set:
```env
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=<your-anon-or-service-key>
DEVICE_ID=<the UUID from Step 4>
SERIAL_PORT=COM3   # or whichever COM port the HC-05 uses
BAUD_RATE=9600
```

Start the gateway:
```bat
node gateway.js
```

You should see `[ARDUINO] DATA,…` lines and rows appearing in the `readings`
table in Supabase.

### 6 · Configure the web app

Open the app (`http://localhost:3000`) and go to **Settings**:

| Field | Value |
|-------|-------|
| **Supabase Project URL** | `https://<your-project>.supabase.co` |
| **Supabase Anon Key** | your `anon`/`publishable` key |
| **Device UUID** | the UUID from Step 4 (must match the gateway's `DEVICE_ID`) |
| **Device Name** | human-readable label (display only) |

Click **Save Configuration**.  The dashboard will immediately load the latest
reading and then update live.

---

## 📱 Mobile PWA (Add to Home Screen)

`app.html` includes `apple-mobile-web-app-capable` and `theme-color` meta tags.
Serve it over HTTPS (e.g. deploy to Vercel/Netlify) and:
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: Menu → Add to Home Screen / Install App

---

## 🔌 Wiring Next Steps (for contributors)

| Task | File | Search for |
|------|------|-----------|
| Switch to Web Serial API (classic BT) | `src/bluetooth.js` | `// ── TODO (wiring): If using classic BT` |
| Replace polling with Supabase Realtime | `src/supabase.js` | `// ── TODO (wiring): Include the Supabase JS SDK` |
| Add Chart.js real gauge (semicircle) | `src/app.html` | `gauge-arc` |
| Load historical data on startup | `src/app.html` | `startSupabaseSubscription` |

---

## 🧩 UI Asset Instructions

The `ui/screens/mobile/` and `ui/screens/web/` folders contain the original
Stitch-generated standalone HTML files. They are **design references** – each
can be opened independently in a browser to preview the intended layout.

The integrated, functional app lives in `src/app.html`. All Stitch screen
designs have been adapted and merged into that single file.

Design tokens (colors, typography, spacing) are documented in
`ui/assets/design/DESIGN.md` and mirrored in the Tailwind config inside
`src/app.html`.

---

## 🏗️ Arduino Serial Protocol Reference

### Output (Arduino → App, every ~2 s)

```
--- STATUS ---
TEMP: 24.5C | SOIL: 65% | WET: 12%
PUMP:[OFF] FAN:[ON] HEATER:[OFF] LID:OPEN
DATA,24.5,65,12,OFF,ON,OFF,OPEN
```

The `DATA,…` line is the machine-readable format the Dashboard parses.

### Input (App → Arduino)

| Command | Action |
|---------|--------|
| `a` | Switch to AUTO mode |
| `m` | Switch to MANUAL/TEST mode |
| `1` | Toggle Water Pump |
| `2` | Toggle Cooling Fan |
| `3` | Toggle Heater/Bulb |
| `4` | Open Lid (if CLOSED) |
| `5` | Close Lid (if OPEN) |
| `0` | Emergency stop |
| `S` | Apply Silvercock profile |
| `H` | Apply Shia profile |
| `T<ms>\n` | Set PUMP_RUN_TIME |
| `L<ms>\n` | Set LID open/close time |

---

## 📜 License

MIT © 2026 Abdullah Ayman Gamal Ahmed

