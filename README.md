# Visitor Tracker

A comprehensive visitor tracking system combining Arduino hardware with a web-based dashboard for real-time monitoring and analytics.

## Overview

This project provides a smart visitor tracking solution that uses Arduino-based sensors to detect visitors and a web interface to view analytics and statistics.

## Features

- Real-time visitor detection and counting
- Web-based dashboard for monitoring
- Data analytics and historical tracking
- Arduino-based sensor integration
- Responsive web interface

## Project Structure

```
visitor_tracker/
├── visitor_tracker.ino     # Arduino firmware for sensor integration
├── index.html              # Main web dashboard
├── app.js                  # Backend/Frontend logic
├── style.css               # Dashboard styling
└── README.md               # This file
```

## Requirements

### Hardware
- Arduino microcontroller (ESP32, Arduino Uno, or compatible)
- Motion/Door sensors (PIR sensor recommended)
- WiFi module (if using WiFi connectivity)
- USB cable for Arduino programming

### Software
- Arduino IDE (for programming the Arduino)
- Web browser (Chrome, Firefox, Safari, or Edge)
- Node.js and npm (optional, if running a local server)
- Git (for version control)

## Installation & Setup

### 1. Arduino Setup

#### Prerequisites
- Install [Arduino IDE](https://www.arduino.cc/en/software)

#### Steps
1. Connect your Arduino to your computer via USB
2. Open Arduino IDE
3. Go to `File > Open` and select `visitor_tracker.ino`
4. Configure the board:
   - `Tools > Board` → Select your board type
   - `Tools > Port` → Select the COM port with your Arduino
5. Click **Upload** (or press Ctrl+U) to upload the firmware

### 2. Web Dashboard Setup

#### Option A: Direct File Access
1. Open `index.html` directly in your web browser
2. The dashboard should load automatically

#### Option B: Run with Local Server (Recommended)
1. Install [Node.js](https://nodejs.org/) if not already installed
2. Open terminal/command prompt and navigate to the project folder:
   ```bash
   cd "d:\Thynx\College Projects\visitor_tracker"
   ```
3. Install a simple HTTP server:
   ```bash
   npm install -g http-server
   ```
4. Start the server:
   ```bash
   http-server
   ```
5. Open your browser and go to `http://localhost:8080` (or the address shown in terminal)

## Hardware Connections

### Motion Sensor (PIR) to Arduino
- **VCC** → Arduino 5V
- **GND** → Arduino GND
- **OUT** → Arduino Pin (configured in .ino file)

### WiFi Module (if applicable)
Refer to your specific module's documentation for pin connections.

## Usage

### Arduino
- The Arduino monitors sensors and transmits data
- Data is sent via serial communication or WiFi
- Check serial monitor for debug information: `Tools > Serial Monitor`

### Web Dashboard
- View visitor counts in real-time
- Check historical data and analytics
- The dashboard updates automatically when new visitor data arrives
- Use your browser's developer tools (F12) to check for any errors

## Configuration

### Arduino Code
Edit `visitor_tracker.ino` to configure:
- Pin assignments for sensors
- Sensor sensitivity thresholds
- WiFi credentials (if applicable)
- Data transmission intervals

### Web Interface
Edit `app.js` to configure:
- Serial port settings
- Data processing logic
- Dashboard update intervals

## Troubleshooting

### Arduino Upload Issues
- Verify correct board and port are selected
- Install board drivers if not recognized
- Try different USB cables

### Web Dashboard Not Loading
- Check browser console for errors (F12)
- Ensure Arduino is properly connected
- Try accessing from a different browser
- Clear browser cache (Ctrl+Shift+Delete)

### No Data Appearing
- Check Arduino serial monitor for sensor readings
- Verify sensor connections are secure
- Ensure proper data format is being transmitted

## File Descriptions

| File | Purpose |
|------|---------|
| `visitor_tracker.ino` | Arduino firmware for hardware control and sensor reading |
| `index.html` | Main HTML structure for the web dashboard |
| `app.js` | JavaScript logic for data handling and dashboard functionality |
| `style.css` | CSS styling for the web interface |

## Future Enhancements

- Cloud data storage and backup
- Mobile app integration
- Advanced analytics and reporting
- Multiple sensor support
- Email/SMS notifications
- Database integration

## License

This project is licensed under the MIT License. See LICENSE file for details.

## Support

For issues or questions, please check the troubleshooting section or refer to the Arduino documentation.

---

**Last Updated:** March 14, 2026
