const { io } = require("socket.io-client");
const { SerialPort } = require("serialport");
const axios = require("axios");

// --- CONFIGURATION ---
const SERVER_URL = "http://YOUR_SERVER_IP:3000"; // Replace with your server's public/VPN IP
const STATION_ID = "STATION_" + Math.random().toString(36).substr(2, 5);

console.log(`🚀 Starting Station Client: ${STATION_ID}`);

const socket = io(SERVER_URL);

socket.on("connect", () => {
    console.log("✅ Connected to Central Server");
    register();
});

async function register() {
    // Scan for modems (Example: Local COM ports)
    const ports = await SerialPort.list();
    const modems = ports.map(p => ({
        port: p.path,
        operator: "Mobilis", // You can add auto-detection here
        type: "com",
        online: true
    }));

    socket.emit("register_station", {
        stationId: STATION_ID,
        modems: modems
    });
}

socket.on("ussd_command", async (data) => {
    const { port, code } = data;
    console.log(`📨 Executing USSD [${port}]: ${code}`);
    
    const serial = new SerialPort({ path: port, baudRate: 115200 });
    serial.on('open', () => {
        serial.write(`AT+CUSD=1,"${code}",15\r\n`);
        // Add logic to read result and emit "ussd_result"
    });
});

socket.on("transfer_command", async (data) => {
    console.log("💸 Received Transfer Request:", data);
    // Execute transfer AT commands...
});

socket.on("disconnect", () => console.log("❌ Disconnected from Server"));
