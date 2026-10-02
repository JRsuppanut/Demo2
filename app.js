/**
 * Module: app.js
 * Description: UI Event handling, Web Serial stream management, and Data Parsing.
 */

const btnConnect = document.getElementById('btn-connect');
const btnDetect = document.getElementById('btn-detect');
const btnWrite = document.getElementById('btn-write');
const inputData = document.getElementById('input-data');
const baudRateSelect = document.getElementById('baud-rate');
const logConsole = document.getElementById('log-console');
const tableBody = document.getElementById('table-body');

let serialPort;
let reader;
let writer;
let currentTargetId = null;

function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    logConsole.innerHTML += `[${timestamp}] ${message}<br>`;
    logConsole.scrollTop = logConsole.scrollHeight;
}

function toHexStr(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// 1. Updated Connection with dynamic Baud Rate
async function connectHardware() {
    try {
        if (!('serial' in navigator)) throw new Error("Web Serial API is not supported.");

        const selectedBaudRate = parseInt(baudRateSelect.value);
        
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: selectedBaudRate });

        appendLog(`Hardware connected. Port opened at ${selectedBaudRate} bps.`);
        
        btnConnect.disabled = true;
        baudRateSelect.disabled = true;
        btnConnect.innerText = "Connected";
        btnDetect.disabled = false;

        startReadLoop();
    } catch (error) {
        appendLog(`Connection Error: ${error.message}`);
    }
}

async function transmitRaw(payloadUint8Array) {
    if (!serialPort || !serialPort.writable) return;
    writer = serialPort.writable.getWriter();
    try {
        await writer.write(payloadUint8Array);
        appendLog(`TX -> ${toHexStr(payloadUint8Array)}`);
    } catch (error) {
        appendLog(`TX Error: ${error.message}`);
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
                appendLog(`RX <- ${toHexStr(value)}`);
                parseNfcResponse(value);
            }
        }
    } catch (error) {
        appendLog(`RX Error: ${error.message}`);
    } finally {
        reader.releaseLock();
    }
}

// 2. Parsed response handling
function parseNfcResponse(dataBytes) {
    for (let i = 0; i < dataBytes.length - 5; i++) {
        // Detect 'InListPassiveTarget' Success Response (0xD5 0x4B)
        if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x4B) {
            if (dataBytes[i+2] > 0) {
                let idx = i + 3;
                currentTargetId = dataBytes[idx]; // Store Target ID for writing
                const nfcidLen = dataBytes[idx+4];
                const uidBytes = dataBytes.slice(idx + 5, idx + 5 + nfcidLen);
                const uidStr = Array.from(uidBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');

                tableBody.innerHTML = `<tr><td>0x0${currentTargetId}</td><td>${uidStr}</td><td>ISO 14443-A</td></tr>`;
                appendLog(`Detected Tag UID: ${uidStr}`);
                
                // Enable Write UI
                inputData.disabled = false;
                btnWrite.disabled = false;
            }
        }
        // Detect 'InDataExchange' Write Success Response (0xD5 0x41 0x00)
        else if (dataBytes[i] === 0xD5 && dataBytes[i+1] === 0x41 && dataBytes[i+2] === 0x00) {
            appendLog("Success: Data written to NTAG successfully.");
        }
    }
}

// 3. Updated Trigger using Library
async function triggerDetection() {
    appendLog("Executing InListPassiveTarget command...");
    const detectFrame = PN532.getDetectFrame(); // Use Library
    await transmitRaw(detectFrame);
}

// 4. New Write Feature
async function triggerWrite() {
    if (currentTargetId === null) {
        appendLog("Error: No tag detected. Please detect a tag first.");
        return;
    }

    let textValue = inputData.value;
    if (textValue.length < 4) textValue = textValue.padEnd(4, ' '); // Pad with spaces if less than 4 chars

    const textEncoder = new TextEncoder();
    const dataBytes = Array.from(textEncoder.encode(textValue)); // Convert text to byte array

    appendLog(`Executing Write command to Page 4 with data: "${textValue}"...`);
    const writeFrame = PN532.getWriteNtagFrame(currentTargetId, 0x04, dataBytes); // Use Library
    await transmitRaw(writeFrame);
}

btnConnect.addEventListener('click', connectHardware);
btnDetect.addEventListener('click', triggerDetection);
btnWrite.addEventListener('click', triggerWrite);