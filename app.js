/**
 * Module: app.js
 * Description: Handles Web Serial API connection, transmission of PN532 frames,
 *              and parsing of incoming serial data streams into readable tables.
 */

const btnConnect = document.getElementById('btn-connect');
const btnDetect = document.getElementById('btn-detect');
const logConsole = document.getElementById('log-console');
const tableBody = document.getElementById('table-body');

let serialPort;
let reader;
let writer;

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

async function connectHardware() {
    try {
        if (!('serial' in navigator)) {
            throw new Error("Web Serial API is not supported in this environment.");
        }

        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 115200 });

        appendLog("Hardware connected successfully. Port opened at 115200 bps.");
        btnConnect.disabled = true;
        btnConnect.innerText = "Connected";
        btnDetect.disabled = false;

        startReadLoop();
    } catch (error) {
        appendLog(`Connection Error: ${error.message}`);
    }
}

async function transmitFrame(hexArray) {
    if (!serialPort || !serialPort.writable) {
        appendLog("Error: Serial port is not writable.");
        return;
    }
    
    writer = serialPort.writable.getWriter();
    const payload = new Uint8Array(hexArray);
    
    try {
        await writer.write(payload);
        const hexDump = Array.from(payload).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        appendLog(`TX -> ${hexDump}`);
    } catch (error) {
        appendLog(`Transmission Error: ${error.message}`);
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
            if (done) {
                appendLog("Read stream closed by the hardware.");
                break;
            }
            if (value) {
                const hexDump = Array.from(value).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                appendLog(`RX <- ${hexDump}`);
                
                parseNfcResponse(value);
            }
        }
    } catch (error) {
        appendLog(`Stream Error: ${error.message}`);
    } finally {
        reader.releaseLock();
    }
}

function parseNfcResponse(dataBytes) {
    for (let i = 0; i < dataBytes.length - 5; i++) {
        if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x4B) {
            const nbTg = dataBytes[i+2];
            if (nbTg > 0) {
                let idx = i + 3;
                const targetId = dataBytes[idx];
                const nfcidLen = dataBytes[idx+4];
                
                const uidBytes = dataBytes.slice(idx + 5, idx + 5 + nfcidLen);
                const uidStr = Array.from(uidBytes)
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join('');

                tableBody.innerHTML = `
                    <tr>
                        <td>${targetId}</td>
                        <td>${uidStr}</td>
                        <td>ISO/IEC 14443-A</td>
                    </tr>
                `;
                appendLog(`Successfully Parsed Tag UID: ${uidStr}`);
            }
        }
    }
}

async function triggerDetection() {
    appendLog("Executing InListPassiveTarget command...");
    const inListPassiveTargetFrame = [
        0x00, 0x00, 0xFF, 0x04, 0xFC, 0xD4, 0x4A, 0x01, 0x00, 0xE1, 0x00
    ];
    await transmitFrame(inListPassiveTargetFrame);
}

btnConnect.addEventListener('click', connectHardware);
btnDetect.addEventListener('click', triggerDetection);