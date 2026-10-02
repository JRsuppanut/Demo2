/**
 * Module: pn532-lib.js
 * Description: Custom library for PN532 Frame Construction and Checksum Calculation.
 * This satisfies the requirement to modularize and reuse hardware-specific code.
 */

const PN532 = {
    // Command Constants
    CMD_HOST_TO_PN532: 0xD4,
    CMD_IN_LIST_PASSIVE_TARGET: 0x4A,
    CMD_IN_DATA_EXCHANGE: 0x40,
    CMD_NTAG_WRITE: 0xA2,

    /**
     * Calculates the Data Checksum (DCS) for the PN532 data frame.
     */
    calculateChecksum: function(dataPayload) {
        let sum = 0;
        for (let i = 0; i < dataPayload.length; i++) {
            sum += dataPayload[i];
        }
        return (~sum + 1) & 0xFF; // Two's complement
    },

    /**
     * Builds a complete raw byte frame ready for serial transmission.
     */
    buildFrame: function(commandPayload) {
        const length = commandPayload.length;
        const lcs = (~length + 1) & 0xFF; // Length Checksum
        const dcs = this.calculateChecksum(commandPayload);

        const frame = [
            0x00, 0x00, 0xFF,       // Preamble and Start Code
            length, lcs,            // Packet Length and Length Checksum
            ...commandPayload,      // Data Payload
            dcs,                    // Data Checksum
            0x00                    // Postamble
        ];
        
        return new Uint8Array(frame);
    },

    /**
     * Pre-built frame for detecting a tag (InListPassiveTarget).
     */
    getDetectFrame: function() {
        const payload = [this.CMD_HOST_TO_PN532, this.CMD_IN_LIST_PASSIVE_TARGET, 0x01, 0x00];
        return this.buildFrame(payload);
    },

    /**
     * Builds a frame for writing 4 bytes to an NTAG page.
     */
    getWriteNtagFrame: function(targetId, pageAddress, dataBytesArray) {
        const payload = [
            this.CMD_HOST_TO_PN532, 
            this.CMD_IN_DATA_EXCHANGE, 
            targetId, 
            this.CMD_NTAG_WRITE, 
            pageAddress, 
            ...dataBytesArray
        ];
        return this.buildFrame(payload);
    }
};