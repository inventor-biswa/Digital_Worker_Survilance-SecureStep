#include <ArduinoJson.h>
#include "WiFi.h"
#include "Adafruit_VL53L0X.h"
#include <Wire.h>
#include <TinyGPS++.h>
#include <SoftwareSerial.h>
#include <WiFiClient.h>
#include <PubSubClient.h>

// ─── WiFi Credentials ───────────────────────────────────────────────────────
const char* ssid     = "Airtel_Tech";
const char* password = "Tech@2025";

// ─── MQTT Details ────────────────────────────────────────────────────────────
const char* broker       = "98.130.28.156";
const char* mqttUsername = "moambulance";
const char* mqttPassword = "P@$sw0rd2001";

String mqtt_topic_gps = "SECURE_STEP";

// ─── Device Identity ─────────────────────────────────────────────────────────
String mac     = "visitor";
String OwnerId = "UG_PROJECT";

// ─── MQTT Retry ──────────────────────────────────────────────────────────────
unsigned long lastRetryTime = 0;
const unsigned long retryInterval = 2000;
int mqttAttempts = 0;

// ─── MQTT / WiFi Clients ─────────────────────────────────────────────────────
WiFiClient   espClient;
PubSubClient mqtt(espClient);

// ─── GPS UART Pins ───────────────────────────────────────────────────────────
#define RXD2 17
#define TXD2 16
static const uint32_t GPSBaud = 9600;
SoftwareSerial gpsData(RXD2, TXD2);
TinyGPSPlus    gps;

// ─── VL53L0X LiDAR (second I2C bus) ─────────────────────────────────────────
#define I2C_SDA_2 21
#define I2C_SCL_2 22
TwoWire          I2CVLX = TwoWire(1);
Adafruit_VL53L0X lox    = Adafruit_VL53L0X();

#define HELMET_DISTANCE_THRESHOLD 100   // mm
bool helmetWorn      = false;
bool lidarInitialized = false;

// ─── Geofencing ──────────────────────────────────────────────────────────────
const double BOILER_AREA_LAT       = 20.253580;
const double BOILER_AREA_LNG       = 85.842148;
const double RESTRICTED_ZONE_RADIUS = 100.0;   // meters
bool   inRestrictedZone  = false;
double distanceToBoiler  = 0;
String zoneStatus        = "Safe Zone";

// ─── SOS ─────────────────────────────────────────────────────────────────────
#define SOS_BUTTON_PIN 14
volatile int  sosStatus  = 0;
volatile unsigned long lastSosPress = 0;
const unsigned long debounceDelay   = 500;

bool sosActive = false;
unsigned long sosActivatedTime = 0;
const unsigned long SOS_ACTIVE_DURATION = 30000;

// ─── GPS State ───────────────────────────────────────────────────────────────
double  latitude = 0, longitude = 0;
float   speed = 0, altitude = 0;
uint16_t year  = 0;
uint8_t  month = 0, day = 0, hour = 0, minute = 0, second = 0;
char formattedTime[10];
char formattedDate[12];
uint8_t localTimezoneOffsetHours = 5;
uint8_t localTimezoneOffsetMin   = 30;

unsigned long preTimeGps         = 0;
uint32_t      lastReconnectAttempt = 0;

// ─── Forward Declarations ────────────────────────────────────────────────────
void publishDataGps(char* date, char* time, double lat, double lng,
                    double spd, double alt, int sos, bool helmet);
bool checkHelmetWorn();
void checkRestrictedZone();
double calculateDistance(double lat1, double lon1, double lat2, double lon2);

// ─── ISR ─────────────────────────────────────────────────────────────────────
void IRAM_ATTR sosButtonISR() {
  unsigned long now = millis();
  if (now - lastSosPress > debounceDelay) {
    sosStatus  = 1;
    lastSosPress = now;
  }
}

// ─── WiFi Connect ────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.print(ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" FAILED. Restarting...");
    ESP.restart();
  }
}

// ─── MQTT Connect ────────────────────────────────────────────────────────────
boolean mqttConnect() {
  Serial.print("Connecting to MQTT broker ");
  Serial.print(broker);
  boolean status = mqtt.connect("ESP32_Visitor_Emp1", mqttUsername, mqttPassword);
  if (!status) {
    Serial.println(" — failed");
    return false;
  }
  Serial.println(" — success");
  return true;
}

// ─── Haversine Distance ──────────────────────────────────────────────────────
double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;
  double lat1R  = lat1 * PI / 180.0;
  double lat2R  = lat2 * PI / 180.0;
  double dLat   = (lat2 - lat1) * PI / 180.0;
  double dLon   = (lon2 - lon1) * PI / 180.0;
  double a = sin(dLat/2)*sin(dLat/2) +
             cos(lat1R)*cos(lat2R)*sin(dLon/2)*sin(dLon/2);
  return R * 2 * atan2(sqrt(a), sqrt(1-a));
}

// ─── Zone Check ──────────────────────────────────────────────────────────────
void checkRestrictedZone() {
  double checkLat = (latitude  == 0) ? 20.862858 : latitude;
  double checkLng = (longitude == 0) ? 85.275186 : longitude;

  distanceToBoiler = calculateDistance(checkLat, checkLng,
                                       BOILER_AREA_LAT, BOILER_AREA_LNG);
  if (distanceToBoiler <= RESTRICTED_ZONE_RADIUS) {
    inRestrictedZone = true;
    zoneStatus = "Restricted Area Boiler";
    Serial.printf("!!! RESTRICTED ZONE - Distance: %.2f m !!!\n", distanceToBoiler);
  } else {
    inRestrictedZone = false;
    zoneStatus = "Safe Zone";
    Serial.printf("Safe Zone - Restricted Area: %.2f m\n", distanceToBoiler);
  }
}

// ─── Helmet Check ────────────────────────────────────────────────────────────
bool checkHelmetWorn() {
  if (!lidarInitialized) return false;
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);
  if (measure.RangeStatus != 4) {
    Serial.printf("LiDAR: %d mm\n", measure.RangeMilliMeter);
    return (measure.RangeMilliMeter < HELMET_DISTANCE_THRESHOLD);
  }
  Serial.println("LiDAR out of range");
  return false;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(10);

  // SOS button
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(SOS_BUTTON_PIN), sosButtonISR, FALLING);
  Serial.println("SOS Button initialized on GPIO 14");

  // VL53L0X on second I2C bus
  I2CVLX.begin(I2C_SDA_2, I2C_SCL_2, 400000);
  Serial.println("Initializing VL53L0X...");
  if (!lox.begin(VL53L0X_I2C_ADDR, false, &I2CVLX)) {
    Serial.println("VL53L0X FAILED - helmet detection disabled");
    lidarInitialized = false;
  } else {
    Serial.println("VL53L0X OK");
    lidarInitialized = true;
  }

  // GPS
  gpsData.begin(GPSBaud);
  delay(500);

  // WiFi
  connectWiFi();

  // MQTT
  mqtt.setServer(broker, 1883);
  mqtt.setBufferSize(512);
}

// ─── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  // Ensure WiFi is up
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost — reconnecting...");
    connectWiFi();
  }

  // Helmet check every 2 s
  static unsigned long lastHelmetCheck = 0;
  if (millis() - lastHelmetCheck > 2000) {
    lastHelmetCheck = millis();
    helmetWorn = checkHelmetWorn();
  }

  // Zone check every 10 s
  static unsigned long lastZoneCheck = 0;
  if (millis() - lastZoneCheck > 10000) {
    lastZoneCheck = millis();
    checkRestrictedZone();
  }

  // SOS trigger
  if (sosStatus == 1) {
    Serial.println("!!! SOS TRIGGERED - active for 60 s !!!");
    sosActive        = true;
    sosActivatedTime = millis();
    sosStatus        = 0;
    if (mqtt.connected())
      publishDataGps(formattedDate, formattedTime, latitude, longitude,
                     speed, altitude, 1, helmetWorn);
  }

  // SOS expiry
  if (sosActive && (millis() - sosActivatedTime >= SOS_ACTIVE_DURATION)) {
    Serial.println("SOS expired — back to normal");
    sosActive = false;
  }

  // MQTT reconnect
  if (!mqtt.connected()) {
    Serial.println("=== MQTT NOT CONNECTED ===");
    uint32_t t = millis();
    if (t - lastReconnectAttempt > 10000L) {
      lastReconnectAttempt = t;
      if (mqttConnect()) lastReconnectAttempt = 0;
    }
    delay(100);
    return;
  }

  // Read GPS
  while (gpsData.available() > 0) {
    if (gps.encode(gpsData.read())) {
      if (gps.location.isValid()) {
        latitude  = round(gps.location.lat() * 1000000.0) / 1000000.0;
        longitude = round(gps.location.lng() * 1000000.0) / 1000000.0;
      }
      if (gps.speed.isValid())    speed    = gps.speed.kmph();
      if (gps.altitude.isValid()) altitude = round(gps.altitude.meters());
      if (gps.date.isValid()) {
        year = gps.date.year(); month = gps.date.month(); day = gps.date.day();
        sprintf(formattedDate, "%02d-%02d-%04d", day, month, year);
      }
      if (gps.time.isValid()) {
        hour   = gps.time.hour()   + localTimezoneOffsetHours;
        minute = gps.time.minute() + localTimezoneOffsetMin;
        second = gps.time.second();
        if (minute >= 60) { minute -= 60; hour++; }
        if (hour   >= 24) { hour   -= 24; }
        sprintf(formattedTime, "%02d:%02d:%02d", hour, minute, second);
      }
    }
  }

  // Publish every 5 s
  unsigned long timestamp = millis() / 1000;
  if (timestamp % 5 == 0 && timestamp != preTimeGps) {
    preTimeGps = timestamp;
    if (mqtt.connected()) {
      int currentSos = sosActive ? 1 : 0;
      publishDataGps(formattedDate, formattedTime, latitude, longitude,
                     speed, altitude, currentSos, helmetWorn);
    }
  }

  mqtt.loop();
}

// ─── Publish ─────────────────────────────────────────────────────────────────
void publishDataGps(char* date, char* time, double lat, double lng,
                    double spd, double alt, int sos, bool helmet) {
  StaticJsonDocument<512> doc;

  doc["V-Id"]     = "SECURE_STEP-001";
  doc["date_ist"] = date;
  doc["time_ist"] = time;

  if (lat == 0 && lng == 0) {
    doc["latitude"]  = 20.253580;
    doc["longitude"] = 85.842148;
  } else {
    doc["latitude"]  = lat;
    doc["longitude"] = lng;
  }

  doc["speed_kmph"]          = spd;
  doc["altitude_m"]          = alt;
  doc["sos"]                 = sos;
  doc["helmetWorn"]          = helmet ? "Helmet Worn" : "Helmet Not Worn";
  doc["zoneStatus"]          = zoneStatus;
  doc["distance_To_Restricted_Area_m"]  = round(distanceToBoiler * 100) / 100.0;

  String payload;
  serializeJson(doc, payload);
  Serial.print("Publishing: ");
  Serial.println(payload);

  if (mqtt.publish(mqtt_topic_gps.c_str(), payload.c_str())) {
    Serial.println("Message sent OK");
    lastRetryTime = 0;
  } else {
    unsigned long now = millis();
    if (now - lastRetryTime >= retryInterval) {
      Serial.println("Publish FAILED — retrying...");
      lastRetryTime = now;
    }
  }
}