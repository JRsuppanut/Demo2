/**
 * Module: app.js
 * Description: UI Event handling, Web Serial Auto-Polling, and Time-based Anti-collision Logic.
 */

const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnAutoDetect = document.getElementById('btn-autodetect');
const btnWrite = document.getElementById('btn-write');
const inputData = document.getElementById('input-data');
const baudRateSelect = document.getElementById('baud-rate');
const logConsole = document.getElementById('log-console');
const tableBody = document.getElementById('table-body');

let serialPort;
let reader;
let writer;

// State Management
let currentTargetId = null;
let lastDetectedUid = null; 
let isAutoScanning = false; 
let lastTagTime = 0; 

// Web Audio API for Hardware Beep Sound
function playBeepSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 1200; // Frequency in Hz (High pitch beep)
        
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volume (10%)
        
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1); // Duration (0.1 seconds)
    } catch (e) {
        console.warn("Web Audio API not supported or blocked.", e);
    }
}

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

function toHexStr(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// ---------------------------------------------------------
// 1. Connection & Hardware Configuration
// ---------------------------------------------------------
async function connectHardware() {
    try {
        if (!('serial' in navigator)) throw new Error("Web Serial API is not supported.");
        const selectedBaudRate = parseInt(baudRateSelect.value);
        
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: selectedBaudRate });

        appendLog(`[HARDWARE] Connected at ${selectedBaudRate} bps.`);
        
        btnConnect.disabled = true;
        baudRateSelect.disabled = true;
        btnConnect.innerText = "Connected";
        btnDisconnect.disabled = false;

        startReadLoop();

        appendLog("[SYSTEM] Waking up PN532 (SAM Configuration)...");
        const SAM_WAKEUP = new Uint8Array([
            0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0x03, 0xFD, 0xD4, 0x14, 0x01, 0x17, 0x00
        ]);
        await transmitRaw(SAM_WAKEUP, false);

        await new Promise(r => setTimeout(r, 800));

        appendLog("[SYSTEM] Configuring RF (Setting MaxRetries to 0)...");
        const RF_CONFIG = PN532.buildFrame([0xD4, 0x32, 0x05, 0xFF, 0x01, 0x00]);
        await transmitRaw(RF_CONFIG, false);

        await new Promise(r => setTimeout(r, 500));
        btnAutoDetect.disabled = false;

    } catch (error) {
        appendLog(`[ERROR] Connection: ${error.message}`);
    }
}

// ---------------------------------------------------------
// 2. Disconnect Feature
// ---------------------------------------------------------
async function disconnectHardware() {
    try {
        if (isAutoScanning) {
            toggleAutoScan();
        }

        if (reader) {
            await reader.cancel(); 
        }

        if (serialPort) {
            await serialPort.close();
            serialPort = null;
        }

        appendLog("[SYSTEM] Hardware disconnected.");

        btnConnect.disabled = false;
        baudRateSelect.disabled = false;
        btnConnect.innerText = "Connect Reader";
        btnDisconnect.disabled = true;
        btnAutoDetect.disabled = true;
        btnWrite.disabled = true;
        inputData.disabled = true;

        tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #6B7280;">Awaiting connection...</td></tr>`;

        currentTargetId = null;
        lastDetectedUid = null;
        lastTagTime = 0;

    } catch (error) {
        appendLog(`[ERROR] Disconnect: ${error.message}`);
    }
}

// ---------------------------------------------------------
// 3. Data Transmission & Parsing
// ---------------------------------------------------------
async function transmitRaw(payloadUint8Array, silent = false) {
    if (!serialPort || !serialPort.writable) return;
    writer = serialPort.writable.getWriter();
    try {
        await writer.write(payloadUint8Array);
        if (!silent) appendLog(`TX -> ${toHexStr(payloadUint8Array)}`);
    } catch (error) {
        appendLog(`[ERROR] TX: ${error.message}`);
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
                if (!isAutoScanning) appendLog(`RX <- ${toHexStr(value)}`);
                parseNfcResponse(value);
            }
        }
    } catch (error) {
        appendLog(`[ERROR] RX: ${error.message}`);
    } finally {
        reader.releaseLock();
    }
}

function parseNfcResponse(dataBytes) {
    for (let i = 0; i < dataBytes.length - 5; i++) {
        if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x15) {
            appendLog("[SYSTEM] PN532 is AWAKE and Ready.");
        }
        else if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x33) {
            appendLog("[SYSTEM] RF Settings Optimized (Fast Polling).");
        }
        else if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x4B) {
            const nbTg = dataBytes[i+2]; 
            
            if (nbTg > 0) {
                let idx = i + 3;
                currentTargetId = dataBytes[idx]; 
                const nfcidLen = dataBytes[idx+4];
                const uidBytes = dataBytes.slice(idx + 5, idx + 5 + nfcidLen);
                const uidStr = Array.from(uidBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');

                const currentTime = Date.now();
                
                if (uidStr !== lastDetectedUid || (currentTime - lastTagTime > 2000)) {
                    lastDetectedUid = uidStr; 
                    
                    playBeepSound(); 

                    tableBody.innerHTML = `<tr>
                        <td style="color: #2563EB; font-weight: bold;">0x0${currentTargetId}</td>
                        <td style="color: #2563EB; font-weight: bold;">${uidStr}</td>
                        <td>Active</td>
                    </tr>`;
                    appendLog(`[TAP] Tag Detected! UID: ${uidStr}`);
                    inputData.disabled = false;
                    btnWrite.disabled = false;
                }
                
                lastTagTime = currentTime; 
                
            } else {
                if (lastDetectedUid !== null) {
                    appendLog(`[REMOVE] Tag removed from reader.`);
                    lastDetectedUid = null; 
                    currentTargetId = null;
                    tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #6B7280;">Ready for next tap...</td></tr>`;
                    inputData.disabled = true;
                    btnWrite.disabled = true;
                }
            }
        }
        else if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x41 && dataBytes[i+2] === 0x00) {
            appendLog("[SUCCESS] Data written successfully.");
        }
    }
}

// ---------------------------------------------------------
// 4. Polling Loop & Actions
// ---------------------------------------------------------
async function autoPollLoop() {
    while (isAutoScanning && serialPort && serialPort.writable) {
        const detectFrame = PN532.getDetectFrame();
        await transmitRaw(detectFrame, true); 
        await new Promise(r => setTimeout(r, 800)); 
    }
}

function toggleAutoScan() {
    if (isAutoScanning) {
        isAutoScanning = false;
        btnAutoDetect.innerText = "Start Auto-Scan";
        btnAutoDetect.classList.remove('btn-stop');
        appendLog("[SYSTEM] Auto-Scan Paused.");
    } else {
        isAutoScanning = true;
        btnAutoDetect.innerText = "Stop Auto-Scan";
        btnAutoDetect.classList.add('btn-stop');
        appendLog("[SYSTEM] Auto-Scan Started. You can tap the tag now.");
        
        tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #6B7280;">Ready for next tap...</td></tr>`;
        autoPollLoop();
    }
}

async function triggerWrite() {
    if (currentTargetId === null) return;
    let textValue = inputData.value;
    if (textValue.length < 4) textValue = textValue.padEnd(4, ' '); 
    const textEncoder = new TextEncoder();
    const dataBytes = Array.from(textEncoder.encode(textValue));
    appendLog(`[ACTION] Writing to Page 4: "${textValue}"...`);
    
    const writeFrame = PN532.getWriteNtagFrame(currentTargetId, 0x04, dataBytes);
    
    const wasScanning = isAutoScanning;
    if (wasScanning) isAutoScanning = false; 
    
    await transmitRaw(writeFrame, false); 
    
    if (wasScanning) {
        setTimeout(() => {
            isAutoScanning = true;
            autoPollLoop();
        }, 1000);
    }
}

// ---------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------
btnConnect.addEventListener('click', connectHardware);
btnDisconnect.addEventListener('click', disconnectHardware);
btnAutoDetect.addEventListener('click', toggleAutoScan);
btnWrite.addEventListener('click', triggerWrite);