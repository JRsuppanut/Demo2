/**
 * Module: pn532-lib.js
 * Description: Custom library for PN532 Frame Construction and Checksum Calculation.
 */

const PN532 = {
    CMD_HOST_TO_PN532: 0xD4,
    CMD_IN_LIST_PASSIVE_TARGET: 0x4A,
    CMD_IN_DATA_EXCHANGE: 0x40,
    CMD_NTAG_WRITE: 0xA2,

    calculateChecksum: function(dataPayload) {
        let sum = 0;
        for (let i = 0; i < dataPayload.length; i++) {
            sum += dataPayload[i];
        }
        return (~sum + 1) & 0xFF; 
    },

    buildFrame: function(commandPayload) {
        const length = commandPayload.length;
        const lcs = (~length + 1) & 0xFF; 
        const dcs = this.calculateChecksum(commandPayload);

        const frame = [
            0x00, 0x00, 0xFF,       
            length, lcs,            
            ...commandPayload,      
            dcs,                    
            0x00                    
        ];
        
        return new Uint8Array(frame);
    },

    getDetectFrame: function() {
        const payload = [this.CMD_HOST_TO_PN532, this.CMD_IN_LIST_PASSIVE_TARGET, 0x01, 0x00];
        return this.buildFrame(payload);
    },

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