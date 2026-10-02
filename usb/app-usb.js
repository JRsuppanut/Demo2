/**
 * Module: app-usb.js
 * Description: Experimental WebUSB API connection for CH340 (Proof of Concept)
 */

const btnConnect = document.getElementById('btn-connect');
const logConsole = document.getElementById('log-console');

let usbDevice;

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

// ---------------------------------------------------------
// Experimental WebUSB Connection
// ---------------------------------------------------------
async function connectWebUSB() {
    try {
        appendLog("[SYSTEM] Initiating WebUSB Connection...");
        
        // ขอสิทธิ์เชื่อมต่อ USB โดยระบุ Vendor ID ของชิป CH340 (0x1A86)
        usbDevice = await navigator.usb.requestDevice({
            filters: [{ vendorId: 0x1A86 }] 
        });

        appendLog(`[HARDWARE] Selected Device: ${usbDevice.productName}`);

        // ขั้นตอนที่ 1: เปิดพอร์ต
        await usbDevice.open();
        appendLog("[SYSTEM] USB Device opened.");

        // ขั้นตอนที่ 2: เลือก Configuration
        if (usbDevice.configuration === null) {
            await usbDevice.selectConfiguration(1);
        }

        // ขั้นตอนที่ 3: จองสิทธิ์ Interface (Claim Interface)
        await usbDevice.claimInterface(0);
        appendLog("[SYSTEM] USB Interface claimed successfully.");

        // ⚠️ จุดนี้คือ Engineering Limitation สำหรับ CH340
        appendLog("[WARNING] CH340 requires custom Control Transfers to set Baud Rate.");
        appendLog("[WARNING] Attempting to bypass standard COM drivers...");

        // การเซ็ต Baud Rate 115200 บน CH340 ผ่าน USB ตรงๆ ต้องยิง Hex เฉพาะของยี่ห้อนี้
        await usbDevice.controlTransferOut({
            requestType: 'vendor', recipient: 'device',
            request: 0xA1, value: 0xC3, index: 0x009C
        });
        
        appendLog("[SUCCESS] WebUSB connection established (PoC Mode).");
        btnConnect.innerText = "Connected (USB Mode)";
        btnConnect.disabled = true;

    } catch (error) {
        // ดักจับ Error ที่เป็นประเด็นสำคัญของการพรีเซนต์
        appendLog(`[ERROR] WebUSB Connection Failed: ${error.message}`);
        if (error.message.includes("Access denied")) {
            appendLog("<span style='color: #EF4444;'>[ANALYSIS] OS is blocking WebUSB because standard CH340 Serial Driver is holding the port.</span>");
        }
    }
}

btnConnect.addEventListener('click', connectWebUSB);