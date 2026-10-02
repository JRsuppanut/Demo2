/**
 * Module: app.js
 * Description: UI Event handling, Web Serial Auto-Polling, and Anti-collision Logic.
 */

const btnConnect = document.getElementById('btn-connect');
const btnAutoDetect = document.getElementById('btn-autodetect');
const btnWrite = document.getElementById('btn-write');
const inputData = document.getElementById('input-data');
const baudRateSelect = document.getElementById('baud-rate');
const logConsole = document.getElementById('log-console');
const tableBody = document.getElementById('table-body');

let serialPort;
let reader;
let writer;

// State Management Variables
let currentTargetId = null;
let lastDetectedUid = null; // จดจำ UID ล่าสุดเพื่อกันการอ่านรัวๆ
let isAutoScanning = false; // สถานะการทำงานของลูป

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

function toHexStr(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function connectHardware() {
    try {
        if (!('serial' in navigator)) throw new Error("Web Serial API is not supported.");
        const selectedBaudRate = parseInt(baudRateSelect.value);
        
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: selectedBaudRate });

        appendLog(`[Hardware] Connected at ${selectedBaudRate} bps.`);
        
        btnConnect.disabled = true;
        baudRateSelect.disabled = true;
        btnConnect.innerText = "Connected";
        btnAutoDetect.disabled = false;

        // 1. เริ่มลูปรอรับข้อมูลก่อน
        startReadLoop();

        // 2. ส่งคำสั่งปลุกบอร์ด (SAM Configuration) เพื่อเปิดเสาอากาศ
        setTimeout(async () => {
            appendLog("[System] Waking up PN532 (SAM Configuration)...");
            const SAM_WAKEUP = new Uint8Array([
                0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 
                0xFF, 0x03, 0xFD, 0xD4, 0x14, 0x01, 0x17, 0x00
            ]);
            await transmitRaw(SAM_WAKEUP, false);
        }, 500); // หน่วงเวลาเล็กน้อยให้พอร์ตเสถียรก่อนยิงคำสั่ง

    } catch (error) {
        appendLog(`[Error] Connection: ${error.message}`);
    }
}

// เพิ่มพารามิเตอร์ 'silent' เพื่อซ่อน Log เวลาลูปทำงาน จะได้ไม่รกหน้าจอ
async function transmitRaw(payloadUint8Array, silent = false) {
    if (!serialPort || !serialPort.writable) return;
    writer = serialPort.writable.getWriter();
    try {
        await writer.write(payloadUint8Array);
        if (!silent) appendLog(`TX -> ${toHexStr(payloadUint8Array)}`);
    } catch (error) {
        appendLog(`[Error] TX: ${error.message}`);
    } finally {
        writer.releaseLock();
    }
}

async function startReadLoop() {
    if (!serialPort || !serialPort.readable) return;
    reader = serialPort.readable.getReader();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                // หากกำลัง Write ให้โชว์ RX แต่ถ้าลูปค้นหาปกติ ให้ซ่อนไว้เพื่อความสะอาด
                if (!isAutoScanning) appendLog(`RX <- ${toHexStr(value)}`);
                parseNfcResponse(value);
            }
        }
    } catch (error) {
        appendLog(`[Error] RX: ${error.message}`);
    } finally {
        reader.releaseLock();
    }
}

// Logic หลักสำหรับตรวจจับและแยกแยะบัตร
function parseNfcResponse(dataBytes) {
    for (let i = 0; i < dataBytes.length - 5; i++) {
        // เงื่อนไข: ฮาร์ดแวร์ตอบกลับคำสั่งค้นหาบัตรสำเร็จ (0xD5 0x4B)
        if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x4B) {
            const nbTg = dataBytes[i+2]; // จำนวนบัตรที่พบ
            
            if (nbTg > 0) {
                // พบทาร์เก็ต
                let idx = i + 3;
                currentTargetId = dataBytes[idx]; 
                const nfcidLen = dataBytes[idx+4];
                const uidBytes = dataBytes.slice(idx + 5, idx + 5 + nfcidLen);
                const uidStr = Array.from(uidBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');

                // Check State: ถ้า UID ไม่ตรงกับของเดิม (แปลว่าเป็นบัตรใบใหม่ หรือเพิ่งวางลงไป)
                if (uidStr !== lastDetectedUid) {
                    lastDetectedUid = uidStr; // จำเอาไว้ว่าอ่านใบนี้ไปแล้ว
                    
                    tableBody.innerHTML = `<tr>
                        <td style="color: #2563EB; font-weight: bold;">0x0${currentTargetId}</td>
                        <td style="color: #2563EB; font-weight: bold;">${uidStr}</td>
                        <td>Active</td>
                    </tr>`;
                    
                    appendLog(`🔵 [TAP] Tag Detected! UID: ${uidStr}`);
                    
                    inputData.disabled = false;
                    btnWrite.disabled = false;
                }
            } else {
                // nbTg === 0 หมายถึงไม่มีบัตรในรัศมี
                // Check State: ถ้าเคยมีบัตรอยู่ แล้วตอนนี้หายไป ให้ทำการ Reset สถานะ
                if (lastDetectedUid !== null) {
                    appendLog(`⚪ [REMOVE] Tag removed from reader.`);
                    
                    lastDetectedUid = null; // เคลียร์ความจำ เพื่อให้บัตรเดิมแตะซ้ำได้
                    currentTargetId = null;
                    
                    tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #6B7280;">Ready for next tap...</td></tr>`;
                    inputData.disabled = true;
                    btnWrite.disabled = true;
                }
            }
        }
        // เงื่อนไข: เขียนข้อมูลสำเร็จ
        else if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x41 && dataBytes[i+2] === 0x00) {
            appendLog("✅ [SUCCESS] Data written to NTAG successfully.");
        }
    }
}

// Asynchronous Polling Loop (ยิงคำสั่งค้นหาอัตโนมัติ)
async function autoPollLoop() {
    while (isAutoScanning && serialPort && serialPort.writable) {
        const detectFrame = PN532.getDetectFrame();
        await transmitRaw(detectFrame, true); // ส่งแบบ Silent ปิดการโชว์ TX ขยะ
        await new Promise(r => setTimeout(r, 600)); // หน่วงเวลา 600ms (ค้นหา 1.5 รอบ/วินาที)
    }
}

// ควบคุมการเปิด/ปิดโหมด Auto-Scan
function toggleAutoScan() {
    if (isAutoScanning) {
        // กดปิด
        isAutoScanning = false;
        btnAutoDetect.innerText = "Start Auto-Scan";
        btnAutoDetect.classList.remove('btn-stop');
        appendLog("[System] Auto-Scan Paused.");
    } else {
        // กดเปิด
        isAutoScanning = true;
        btnAutoDetect.innerText = "Stop Auto-Scan";
        btnAutoDetect.classList.add('btn-stop');
        appendLog("[System] Auto-Scan Started. You can tap the tag now.");
        
        // เคลียร์ตารางและเริ่มลูป
        tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #6B7280;">Ready for next tap...</td></tr>`;
        autoPollLoop();
    }
}

async function triggerWrite() {
    if (currentTargetId === null) {
        appendLog("[Error] No active tag to write.");
        return;
    }

    let textValue = inputData.value;
    if (textValue.length < 4) textValue = textValue.padEnd(4, ' '); 

    const textEncoder = new TextEncoder();
    const dataBytes = Array.from(textEncoder.encode(textValue));

    appendLog(`[Action] Writing to Page 4: "${textValue}"...`);
    const writeFrame = PN532.getWriteNtagFrame(currentTargetId, 0x04, dataBytes);
    
    // หยุด Auto-Scan ชั่วคราวก่อนเขียน เพื่อไม่ให้คำสั่งชนกัน
    const wasScanning = isAutoScanning;
    if (wasScanning) isAutoScanning = false; 

    await transmitRaw(writeFrame, false); // แสดง TX ตอนเขียน
    
    // กลับมาสแกนต่อหลังจากเขียนเสร็จ
    if (wasScanning) {
        setTimeout(() => {
            isAutoScanning = true;
            autoPollLoop();
        }, 1000);
    }
}

btnConnect.addEventListener('click', connectHardware);
btnAutoDetect.addEventListener('click', toggleAutoScan);
btnWrite.addEventListener('click', triggerWrite);