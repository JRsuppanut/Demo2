/**
 * Module: app-usb.js
 * Description: Working WebUSB API implementation via WinUSB Driver Override
 */

const btnConnect = document.getElementById('btn-connect');
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

async function connectWebUSB() {
    try {
        appendLog("[SYSTEM] Initiating WebUSB Connection...");
        
        // 1. ขอสิทธิ์เชื่อมต่อ CH340
        usbDevice = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1A86 }] });
        appendLog(`[HARDWARE] Selected Device: ${usbDevice.productName}`);

        // 2. เปิดอุปกรณ์
        await usbDevice.open();
        
        // 3. เลือก Configuration
        if (usbDevice.configuration === null) {
            await usbDevice.selectConfiguration(1);
        }

        // 4. จองสิทธิ์ Interface
        await usbDevice.claimInterface(0);
        appendLog("[SYSTEM] USB Interface claimed successfully (Bypassed OS Driver!).");

        // 5. ค้นหา Endpoints (ขาเข้า IN และขาออก OUT)
        const interfaces = usbDevice.configuration.interfaces[0].alternate.endpoints;
        interfaces.forEach(ep => {
            if (ep.direction === "in") endpointIn = ep.endpointNumber;
            if (ep.direction === "out") endpointOut = ep.endpointNumber;
        });
        
        appendLog(`[SYSTEM] Endpoints Found -> IN: ${endpointIn}, OUT: ${endpointOut}`);

        // 6. ตั้งค่า Baud Rate 115200 ผ่าน Control Transfer (CH340 Specific Protocol)
        await usbDevice.controlTransferOut({
            requestType: 'vendor', recipient: 'device',
            request: 0xA1, value: 0xC3, index: 0x009C
        });
        
        appendLog("<span style='color: #10B981;'>[SUCCESS] WebUSB connection fully established.</span>");
        btnConnect.innerText = "Connected (WinUSB)";
        btnConnect.disabled = true;

        // ลองยิงคำสั่งปลุกบอร์ด (SAM Configuration) ผ่าน USB Transfer
        const SAM_WAKEUP = new Uint8Array([
            0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0x03, 0xFD, 0xD4, 0x14, 0x01, 0x17, 0x00
        ]);
        
        appendLog(`TX -> ${toHexStr(SAM_WAKEUP.buffer)}`);
        await usbDevice.transferOut(endpointOut, SAM_WAKEUP);

        // เริ่มลูปรับข้อมูลกลับ (Read Loop)
        startUsbReadLoop();

    } catch (error) {
        appendLog(`[ERROR] WebUSB Failed: ${error.message}`);
        if (error.message.includes("Access denied")) {
            appendLog("<span style='color: #EF4444;'>[ANALYSIS] OS is blocking WebUSB. You must use Zadig to replace CH340 driver with WinUSB.</span>");
        }
    }
}

async function startUsbReadLoop() {
    appendLog("[SYSTEM] WebUSB Read Loop Started...");
    while (usbDevice && usbDevice.opened) {
        try {
            // รอรับข้อมูลจาก Endpoint IN (ขนาดบัฟเฟอร์ 64 bytes)
            const result = await usbDevice.transferIn(endpointIn, 64);
            if (result.data && result.data.byteLength > 0) {
                appendLog(`RX <- ${toHexStr(result.data.buffer)}`);
            }
        } catch (e) {
            appendLog(`[ERROR] Read Loop: ${e.message}`);
            break;
        }
    }
}

btnConnect.addEventListener('click', connectWebUSB);