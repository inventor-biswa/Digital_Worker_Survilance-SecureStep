# SecureStep – Digital Worker Surveillance

A real-time field worker surveillance dashboard built for a final-year engineering project. Monitors live GPS location, helmet status (via VL53L0X LiDAR), and SOS alerts from an ESP32 device — all streamed over MQTT and displayed in a browser dashboard.

---

## 📁 Project Files

```
visitor_tracker/
├── index.html            # Single-page dashboard (HTML structure)
├── style.css             # Dark glassmorphism UI design
├── app.js                # All frontend logic (MQTT, maps, zones, alerts)
└── visitor_tracker.ino   # ESP32 firmware (upload to the hardware device)
```

---

## 🖥️ How to Run the Dashboard (Web UI)

The dashboard is a **static HTML/JS app** — no Node.js, no database, no build step required. It just needs to be served over HTTP (not opened as a file) because of MQTT WebSocket restrictions.

### Option A — Python (Quickest, already installed on most machines)

```bash
# Navigate to the project folder
cd "d:\Thynx\College Projects\visitor_tracker"

# Start a local HTTP server on port 8765
python -m http.server 8765
```

Then open your browser and go to:
```
http://localhost:8765
```

### Option B — Node.js

```bash
# Install a one-line server globally
npm install -g http-server

# Run from the project folder
http-server -p 8765
```

Then open: `http://localhost:8765`

### Option C — VS Code Live Server Extension

1. Install the **Live Server** extension in VS Code
2. Right-click `index.html` → **Open with Live Server**

---

## 📡 MQTT Broker Configuration

The dashboard connects to an MQTT broker over **WebSocket** to receive live telemetry from the ESP32.

Edit the settings at the **top of `app.js`**:

```js
const CFG = {
  mqttBroker : 'ws://98.130.28.156:8084',   // WebSocket URL of your broker
  mqttUser   : 'moambulance',               // MQTT username
  mqttPass   : 'P@$sw0rd2001',              // MQTT password
  topic      : 'SECURE_STEP',               // Topic the ESP32 publishes to
  ...
};
```

> ⚠️ The browser must be able to reach the broker over the network (same LAN or internet). The broker must have **WebSocket support enabled on port 8084**.

---

## 🔧 ESP32 Firmware Setup

1. Open **Arduino IDE** and install the ESP32 board support.
2. Install required libraries from Library Manager:
   - `PubSubClient` (MQTT)
   - `TinyGPS++` (GPS parsing)
   - `ArduinoJson`
   - `Adafruit_VL53L0X` (helmet LiDAR sensor)
3. Open `visitor_tracker.ino` and update your credentials:
   ```cpp
   const char* ssid         = "YourWiFiName";
   const char* password     = "YourWiFiPassword";
   const char* broker       = "98.130.28.156";     // your MQTT broker IP
   const char* mqttUsername = "moambulance";
   const char* mqttPassword = "P@$sw0rd2001";
   ```
4. Select board: **ESP32 Dev Module** (or your variant)
5. Select the correct COM port → **Upload**

---

## 🗺️ Setting Up Zones (Admin Panel)

Once the dashboard is open in your browser:

1. Click **Zone Admin** in the left sidebar
2. Add **Working Areas** (green, 50m radius): enter a name, latitude, and longitude → click **Add Working Area**
3. Add **Restricted Areas** (red, 100m radius): same process → click **Add Restricted Area**

> Zones are saved to the browser's **`localStorage`** — they persist across page refreshes automatically.

### Pre-configured zone from the `.ino`:
| Zone | Type | Latitude | Longitude |
|---|---|---|---|
| Boiler Room | Restricted | 20.253580 | 85.842148 |

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard shows "Disconnected" | Check broker URL/port in `app.js`. Ensure broker allows WebSocket connections. |
| "Not authorized" error in console | Verify username/password in `app.js` CFG match your broker settings. |
| Map not loading | You need internet access for OpenStreetMap tiles. Check your connection. |
| No data on cards | Confirm ESP32 is publishing to topic `SECURE_STEP` and broker is reachable. |
| Zones disappear after refresh | This should not happen — zones use `localStorage`. Try a different browser. |
| Opening `index.html` directly fails | You **must** use a local server (Python/Node). Do not open as `file://`. |

---

## 🧪 Testing Without Hardware

Open the browser console (F12 → Console) on the dashboard page and paste:

```js
// Simulate a normal GPS packet
simulatePayload()

// Simulate SOS alert
simulatePayload({ sos: 1 })

// Simulate helmet not worn
simulatePayload({ helmetWorn: "Helmet Not Worn" })

// Simulate worker entering restricted zone
simulatePayload({ latitude: 20.25358, longitude: 85.842148 })
```

---

## 📦 Tech Stack

| Component | Technology |
|---|---|
| UI | HTML5 + Vanilla CSS (glassmorphism) |
| Maps | [Leaflet.js](https://leafletjs.com/) v1.9.4 |
| MQTT | [mqtt.js](https://github.com/mqttjs/MQTT.js) v5.3.4 |
| Charts | [Chart.js](https://www.chartjs.org/) v4.4.2 |
| Icons | [Lucide](https://lucide.dev/) |
| Fonts | Inter + JetBrains Mono (Google Fonts) |
| Hardware | ESP32 + NEO-6M GPS + VL53L0X LiDAR |

---

## 📋 MQTT Payload Format

The ESP32 publishes JSON to the `SECURE_STEP` topic every 5 seconds:

```json
{
  "V-Id": "SECURE_STEP-001",
  "date_ist": "13-03-2026",
  "time_ist": "17:15:00",
  "latitude": 20.25358,
  "longitude": 85.842148,
  "speed_kmph": 0,
  "altitude_m": 36,
  "sos": 0,
  "helmetWorn": "Helmet Worn",
  "zoneStatus": "Safe Zone",
  "distance_To_Restricted_Area_m": 89856.45
}
```

---

**Project:** SecureStep – Digital Worker Surveillance  
**Course:** B.Tech Final Year Project  
**Last Updated:** March 2026
