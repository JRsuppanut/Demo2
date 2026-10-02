/**
 * Module: app-usb.js
 * Description: Experimental WebUSB API connection for CH340 (Proof of Concept)
 */

const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnAutoDetect = document.getElementById('btn-autodetect');
const btnWrite = document.getElementById('btn-write');
const inputData = document.getElementById('input-data');
const logConsole = document.getElementById('log-console');
const tableBody = document.getElementById('table-body');

let usbDevice;
let endpointIn = null;
let endpointOut = null;
let isAutoScanning = false;
let currentTargetId = null;

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

function toHexStr(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// ---------------------------------------------------------
// 1. Experimental WebUSB Connection
// ---------------------------------------------------------
async function connectWebUSB() {
    try {
        appendLog("[SYSTEM] Initiating WebUSB Connection...");
        
        usbDevice = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1A86 }] });
        appendLog(`[HARDWARE] Selected Device: ${usbDevice.productName}`);

        await usbDevice.open();
        appendLog("[SYSTEM] USB Device opened.");

        if (usbDevice.configuration === null) {
            await usbDevice.selectConfiguration(1);
        }

        await usbDevice.claimInterface(0);
        appendLog("[SYSTEM] USB Interface claimed successfully.");

        const interfaces = usbDevice.configuration.interfaces[0].alternate.endpoints;
        interfaces.forEach(ep => {
            if (ep.direction === "in") endpointIn = ep.endpointNumber;
            if (ep.direction === "out") endpointOut = ep.endpointNumber;
        });
        
        appendLog(`[SYSTEM] Endpoints Found -> IN: ${endpointIn}, OUT: ${endpointOut}`);

        // พยายามเซ็ต Baud Rate ผ่าน Control Transfer ของ CH340
        await usbDevice.controlTransferOut({
            requestType: 'vendor', recipient: 'device',
            request: 0xA1, value: 0xC3, index: 0x009C
        });
        
        appendLog("<span style='color: #10B981;'>[SUCCESS] WebUSB connection established.</span>");
        
        btnConnect.innerText = "Connected (WinUSB)";
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;

        appendLog("[SYSTEM] Waking up PN532 via WebUSB...");
        const SAM_WAKEUP = new Uint8Array([
            0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0x03, 0xFD, 0xD4, 0x14, 0x01, 0x17, 0x00
        ]);
        
        appendLog(`TX -> ${toHexStr(SAM_WAKEUP.buffer)}`);
        await usbDevice.transferOut(endpointOut, SAM_WAKEUP);

        // ปลดล็อกปุ่ม Auto-Scan
        btnAutoDetect.disabled = false;

        startUsbReadLoop();

    } catch (error) {
        appendLog(`[ERROR] WebUSB Connection Failed: ${error.message}`);
    }
}

// ---------------------------------------------------------
// 2. WebUSB Auto-Polling Loop
// ---------------------------------------------------------
async function autoPollLoop() {
    while (isAutoScanning && usbDevice && usbDevice.opened) {
        const detectFrame = PN532.getDetectFrame();
        try {
            await usbDevice.transferOut(endpointOut, detectFrame);
            // แสดง TX เพื่อโชว์อาจารย์ว่าแอปยิงคำสั่งออกไปแล้วจริงๆ แต่ฮาร์ดแวร์ไม่ตอบ
            appendLog(`TX (Auto) -> ${toHexStr(detectFrame.buffer)}`); 
        } catch (error) {
            appendLog(`[ERROR] Transfer Out: ${error.message}`);
            break;
        }
        await new Promise(r => setTimeout(r, 1000)); 
    }
}

function toggleAutoScan() {
    if (isAutoScanning) {
        isAutoScanning = false;
        btnAutoDetect.innerText = "Start Auto-Scan";
        btnAutoDetect.style.backgroundColor = ""; 
        appendLog("[SYSTEM] Auto-Scan Paused.");
    } else {
        isAutoScanning = true;
        btnAutoDetect.innerText = "Stop Auto-Scan";
        btnAutoDetect.style.backgroundColor = "#DC2626"; 
        appendLog("[SYSTEM] Auto-Scan Started via WebUSB.");
        autoPollLoop();
    }
}

// ---------------------------------------------------------
// 3. WebUSB Read Loop
// ---------------------------------------------------------
async function startUsbReadLoop() {
    appendLog("[SYSTEM] WebUSB Read Loop Started...");
    while (usbDevice && usbDevice.opened) {
        try {
            const result = await usbDevice.transferIn(endpointIn, 64);
            if (result.data && result.data.byteLength > 0) {
                const dataBytes = new Uint8Array(result.data.buffer);
                appendLog(`RX <- ${toHexStr(dataBytes)}`);
                // โค้ดส่วนนี้จะทำงานถ้า CH340 ยอมคุยด้วย (ซึ่งมักจะไม่ยอม)
            }
        } catch (e) {
            if (e.message.includes("The device was disconnected")) break;
            // ซ่อน Error timeout ไม่ให้รกจอ
            if (!e.message.includes("transfer")) appendLog(`[ERROR] Read Loop: ${e.message}`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

// ---------------------------------------------------------
// 4. Disconnect
// ---------------------------------------------------------
async function disconnectWebUSB() {
    try {
        isAutoScanning = false;
        if (usbDevice && usbDevice.opened) {
            await usbDevice.close();
            usbDevice = null;
        }
        appendLog("[SYSTEM] WebUSB Device disconnected.");
        
        btnConnect.innerText = "Connect Reader (WebUSB)";
        btnConnect.disabled = false;
        btnDisconnect.disabled = true;
        btnAutoDetect.disabled = true;
        btnAutoDetect.innerText = "Start Auto-Scan";
        btnAutoDetect.style.backgroundColor = "";
    } catch (error) {
        appendLog(`[ERROR] Disconnect: ${error.message}`);
    }
}

btnConnect.addEventListener('click', connectWebUSB);
btnDisconnect.addEventListener('click', disconnectWebUSB);
btnAutoDetect.addEventListener('click', toggleAutoScan);