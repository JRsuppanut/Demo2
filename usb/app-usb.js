/**
 * Module: app-usb.js
 * Description: Experimental WebUSB API connection for CH340 (Proof of Concept)
 */

const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const logConsole = document.getElementById('log-console');

let usbDevice;
let endpointIn = null;
let endpointOut = null;

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

function toHexStr(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// ---------------------------------------------------------
// Experimental WebUSB Connection
// ---------------------------------------------------------
async function connectWebUSB() {
    try {
        appendLog("[SYSTEM] Initiating WebUSB Connection...");
        
        // 1. ขอสิทธิ์เชื่อมต่อ CH340 ผ่าน WebUSB (Vendor ID: 0x1A86)
        usbDevice = await navigator.usb.requestDevice({
            filters: [{ vendorId: 0x1A86 }] 
        });

        appendLog(`[HARDWARE] Selected Device: ${usbDevice.productName}`);

        // 2. เปิดพอร์ตการสื่อสาร
        await usbDevice.open();
        appendLog("[SYSTEM] USB Device opened.");

        // 3. เลือก Configuration ของ USB
        if (usbDevice.configuration === null) {
            await usbDevice.selectConfiguration(1);
        }

        // 4. จองสิทธิ์ Interface (Claim Interface)
        await usbDevice.claimInterface(0);
        appendLog("[SYSTEM] USB Interface claimed successfully.");

        // 5. ค้นหาช่องทางส่งข้อมูล (Endpoints) ขาเข้าและขาออก
        const interfaces = usbDevice.configuration.interfaces[0].alternate.endpoints;
        interfaces.forEach(ep => {
            if (ep.direction === "in") endpointIn = ep.endpointNumber;
            if (ep.direction === "out") endpointOut = ep.endpointNumber;
        });
        
        appendLog(`[SYSTEM] Endpoints Found -> IN: ${endpointIn}, OUT: ${endpointOut}`);

        // 6. ตั้งค่า Baud Rate (115200) แบบดิบๆ ผ่าน Control Transfer เฉพาะของชิป CH340
        await usbDevice.controlTransferOut({
            requestType: 'vendor', recipient: 'device',
            request: 0xA1, value: 0xC3, index: 0x009C
        });
        
        appendLog("<span style='color: #10B981;'>[SUCCESS] WebUSB connection established.</span>");
        
        // อัปเดตปุ่ม
        btnConnect.innerText = "Connected (WinUSB)";
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;

        // 7. ทดลองยิงคำสั่งปลุกบอร์ด (SAM Configuration) ผ่าน TransferOut
        appendLog("[SYSTEM] Waking up PN532 via WebUSB...");
        const SAM_WAKEUP = new Uint8Array([
            0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0x03, 0xFD, 0xD4, 0x14, 0x01, 0x17, 0x00
        ]);
        
        appendLog(`TX -> ${toHexStr(SAM_WAKEUP.buffer)}`);
        await usbDevice.transferOut(endpointOut, SAM_WAKEUP);

        // 8. เริ่มลูปรับข้อมูลกลับ (Read Loop)
        startUsbReadLoop();

    } catch (error) {
        appendLog(`[ERROR] WebUSB Connection Failed: ${error.message}`);
        if (error.message.includes("Access denied")) {
            appendLog("<span style='color: #EF4444;'>[ANALYSIS] OS is blocking WebUSB because standard COM Driver is holding the port.</span>");
        }
    }
}

// ---------------------------------------------------------
// Disconnect Feature
// ---------------------------------------------------------
async function disconnectWebUSB() {
    try {
        if (usbDevice && usbDevice.opened) {
            await usbDevice.close();
            usbDevice = null;
        }
        appendLog("[SYSTEM] WebUSB Device disconnected.");
        
        btnConnect.innerText = "Connect Reader (WebUSB)";
        btnConnect.disabled = false;
        btnDisconnect.disabled = true;
    } catch (error) {
        appendLog(`[ERROR] Disconnect: ${error.message}`);
    }
}

// ---------------------------------------------------------
// Read Loop (WebUSB Data Buffer)
// ---------------------------------------------------------
async function startUsbReadLoop() {
    appendLog("[SYSTEM] WebUSB Read Loop Started...");
    while (usbDevice && usbDevice.opened) {
        try {
            // รอรับข้อมูลจาก Endpoint IN
            const result = await usbDevice.transferIn(endpointIn, 64);
            if (result.data && result.data.byteLength > 0) {
                const dataBytes = new Uint8Array(result.data.buffer);
                appendLog(`RX <- ${toHexStr(dataBytes)}`);
                
                // ตรวจสอบ ACK ว่าบอร์ดตื่นหรือไม่
                for (let i = 0; i < dataBytes.length - 1; i++) {
                    if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x15) {
                        appendLog("<span style='color: #10B981;'>[SUCCESS] PN532 is AWAKE (WebUSB PoC Complete!)</span>");
                    }
                }
            }
        } catch (e) {
            if (e.message.includes("The device was disconnected")) {
                break;
            }
            appendLog(`[ERROR] Read Loop: ${e.message}`);
            break;
        }
    }
}

btnConnect.addEventListener('click', connectWebUSB);
btnDisconnect.addEventListener('click', disconnectWebUSB);