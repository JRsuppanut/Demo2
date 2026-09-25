/**
 * NFC Web Application Interface Logic
 * Handles Web Serial API connection, PN532 UART communication, and Data Frame Processing.
 */

let serialPort;
let reader;
let writer;
let isReading = false;
let currentTargetId = null;

const UI = {
    btnConnect: document.getElementById('btnConnect'),
    btnRead: document.getElementById('btnRead'),
    btnWrite: document.getElementById('btnWrite'),
    inputData: document.getElementById('inputData'),
    tagTableBody: document.getElementById('tagTableBody'),
    logConsole: document.getElementById('logConsole')
};

/**
 * Appends a formatted message to the system log console.
 * @param {string} message 
 */
function appendLog(message) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    UI.logConsole.innerHTML += `[${time}] ${message}<br>`;
    UI.logConsole.scrollTop = UI.logConsole.scrollHeight;
}

/**
 * Calculates the Data Checksum (DCS) for PN532 frames.
 * @param {Array<number>} dataPayload 
 * @returns {number} The calculated checksum byte.
 */
function calculateChecksum(dataPayload) {
    let sum = 0;
    for (let i = 0; i < dataPayload.length; i++) {
        sum += dataPayload[i];
    }
    return (~sum + 1) & 0xFF;
}

/**
 * Constructs a complete PN532 host-to-controller frame.
 * @param {Array<number>} commandPayload 
 * @returns {Uint8Array} The ready-to-transmit byte array.
 */
function buildFrame(commandPayload) {
    const length = commandPayload.length;
    const lcs = (~length + 1) & 0xFF;
    const dcs = calculateChecksum(commandPayload);

    const frame = [
        0x00, 0x00, 0xFF,       // Preamble and Start Code
        length, lcs,            // Packet Length and Length Checksum
        ...commandPayload,      // Data Payload
        dcs,                    // Data Checksum
        0x00                    // Postamble
    ];
    return new Uint8Array(frame);
}

/**
 * Converts a Uint8Array into a readable hexadecimal string representation.
 * @param {Uint8Array} buffer 
 * @returns {string} Space-separated hex string.
 */
function toHexString(buffer) {
    return Array.from(buffer)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}

/**
 * Transmits a raw frame to the serial port.
 * @param {Uint8Array} frame 
 */
async function transmitFrame(frame) {
    if (!serialPort || !serialPort.writable) {
        appendLog("Error: Serial port is not writable.");
        return;
    }
    writer = serialPort.writable.getWriter();
    appendLog(`TX: ${toHexString(frame)}`);
    await writer.write(frame);
    writer.releaseLock();
}

/**
 * Serial Port Connection Event
 */
UI.btnConnect.addEventListener('click', async () => {
    try {
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 115200 });
        appendLog("Serial port connected successfully at 115200 bps.");
        
        UI.btnConnect.disabled = true;
        UI.btnRead.disabled = false;
        
        isReading = true;
        startReadLoop();
    } catch (error) {
        appendLog(`Connection Error: ${error.message}`);
    }
});

/**
 * Continuous background loop for receiving data from the serial port.
 */
async function startReadLoop() {
    while (serialPort.readable && isReading) {
        reader = serialPort.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    appendLog(`RX: ${toHexString(value)}`);
                    parseResponseBuffer(value);
                }
            }
        } catch (error) {
            appendLog(`Read Error: ${error.message}`);
        } finally {
            reader.releaseLock();
        }
    }
}

/**
 * Parses the incoming byte buffer from PN532.
 * Identifies ACK frames and extracts data from Response frames.
 * @param {Uint8Array} buffer 
 */
function parseResponseBuffer(buffer) {
    // Check for standard ACK frame (00 00 FF 00 FF 00)
    if (buffer.length >= 6 && buffer[3] === 0x00 && buffer[4] === 0xFF) {
        appendLog("System: ACK received from PN532.");
        return;
    }

    // Locate the start of the information frame (00 00 FF)
    let headerIndex = -1;
    for (let i = 0; i < buffer.length - 2; i++) {
        if (buffer[i] === 0x00 && buffer[i+1] === 0x00 && buffer[i+2] === 0xFF) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) return;

    const frameLength = buffer[headerIndex + 3];
    if (frameLength >= 5) {
        const responseCode = buffer[headerIndex + 6];
        
        // 0x4B: Response for InListPassiveTarget (Read)
        if (responseCode === 0x4B) {
            const numTagsDetected = buffer[headerIndex + 7];
            if (numTagsDetected > 0) {
                currentTargetId = buffer[headerIndex + 8];
                const uidLength = buffer[headerIndex + 12];
                const uidBytes = buffer.slice(headerIndex + 13, headerIndex + 13 + uidLength);
                const uidString = toHexString(uidBytes);

                updateTable(currentTargetId, uidString, "Detected");
                UI.btnWrite.disabled = false;
                appendLog(`Success: Tag detected. UID = ${uidString}`);
            } else {
                appendLog("System: No tag found in RF field.");
            }
        } 
        // 0x41: Response for InDataExchange (Write)
        else if (responseCode === 0x41) {
            const statusCode = buffer[headerIndex + 7];
            if (statusCode === 0x00) {
                appendLog("Success: Data written to NFC tag successfully.");
                updateTable(currentTargetId, "-", "Write Confirmed");
            } else {
                appendLog(`Error: Write operation failed. Status code: ${statusCode.toString(16).toUpperCase()}`);
            }
        }
    }
}

/**
 * Updates the HTML table with current tag information.
 * @param {number} targetId 
 * @param {string} uid 
 * @param {string} status 
 */
function updateTable(targetId, uid, status) {
    UI.tagTableBody.innerHTML = `
        <tr>
            <td>0x0${targetId}</td>
            <td>${uid}</td>
            <td style="font-weight: bold; color: green;">${status}</td>
        </tr>
    `;
}

/**
 * Read Button Event: Sends the InListPassiveTarget command to detect a tag.
 */
UI.btnRead.addEventListener('click', async () => {
    if (!serialPort) return;
    
    // Command 0x4A: InListPassiveTarget, 0x01: Max 1 tag, 0x00: Baud rate 106 kbps (ISO14443 Type A)
    const commandPayload = [0xD4, 0x4A, 0x01, 0x00];
    const frame = buildFrame(commandPayload);
    
    appendLog("System: Initiating Tag Detection (InListPassiveTarget)...");
    await transmitFrame(frame);
});

/**
 * Write Button Event: Sends the InDataExchange command to write 4 bytes to an NTAG.
 */
UI.btnWrite.addEventListener('click', async () => {
    if (!serialPort || currentTargetId === null) {
        appendLog("Error: Missing Target ID. Please detect a tag first.");
        return;
    }

    let textValue = UI.inputData.value;
    if (textValue.length < 4) {
        textValue = textValue.padEnd(4, ' ');
        UI.inputData.value = textValue;
        appendLog("Warning: Input data padded to meet 4-byte requirement.");
    }

    const textEncoder = new TextEncoder();
    const dataBytes = Array.from(textEncoder.encode(textValue));

    // Command 0x40: InDataExchange, TargetID, 0xA2: Write Page, 0x04: Memory Page 4
    const writePageAddress = 0x04;
    const commandPayload = [0xD4, 0x40, currentTargetId, 0xA2, writePageAddress, ...dataBytes];
    const frame = buildFrame(commandPayload);
    
    appendLog(`System: Initiating Memory Write to Page ${writePageAddress}...`);
    await transmitFrame(frame);
});