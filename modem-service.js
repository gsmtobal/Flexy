const SerialPort = require('serialport').SerialPort;
const { ReadlineParser } = require('@serialport/parser-readline');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');

class ModemService {
    constructor(config) {
        this.config = config;
        this.config.ip = config.ip || config.port; 
        this.key = this.config.ip || 'unknown';
        
        this.data = {
            key: this.key,
            ip: this.config.ip,
            operator: config.operator || 'Unknown',
            online: false,
            signal: 0,
            simStatus: 'Checking...',
            networkType: '---',
            balance: '0.00',
            lastUpdate: Date.now(),
            preferredBalance: config.preferredBalance || 'Default'
        };
        this.hilinkCache = { session: '', token: '', isLoggedIn: false, lastFetch: 0 };
        this.ussdInProgress = false;
        this.isSerial = (config.ip && config.ip.toLowerCase().startsWith('com')) || (config.port && config.port.toLowerCase().startsWith('com'));
        this.isZte = config.type === 'zte';
        
        if (this.isSerial) {
            this.config.port = this.config.port || this.config.ip;
            this.initSerial();
        }
    }

    initSerial() {
        try {
            this.port = new SerialPort({ path: this.config.port, baudRate: 115200, autoOpen: true });
            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
            this.port.on('open', () => { this.data.online = true; this.sendCommand('AT+CMEE=2'); });
            this.parser.on('data', (line) => this.handleSerialData(line));
            this.port.on('error', () => { this.data.online = false; });
        } catch (e) { console.error(`❌ [SERIAL][${this.key}] Init Failed:`, e.message); }
    }

    async sendCommand(cmd, timeout = 3000) {
        if (!this.port || !this.port.isOpen) return null;
        return new Promise((resolve) => {
            let response = '';
            const timer = setTimeout(() => resolve(response), timeout);
            const onData = (line) => {
                response += line + '\n';
                if (line.includes('OK') || line.includes('ERROR')) {
                    clearTimeout(timer);
                    this.parser.removeListener('data', onData);
                    resolve(response);
                }
            };
            this.parser.on('data', onData);
            this.port.write(cmd + '\r');
        });
    }

    handleSerialData(line) {
        if (line.includes('+CSQ:')) {
            const match = line.match(/\+CSQ:\s*(\d+)/);
            if (match) this.data.signal = Math.round((parseInt(match[1])/31)*100);
        }
    }

    async getHilinkHeaders() {
        const ip = this.config.ip;
        if (Date.now() - this.hilinkCache.lastFetch < 300000 && this.hilinkCache.isLoggedIn) {
            return { 'Cookie': this.hilinkCache.session, '__RequestVerificationToken': this.hilinkCache.token };
        }

        try {
            this.hilinkCache.isLoggedIn = false;
            let sesTok = null;
            for (let i = 0; i < 3; i++) {
                const res = await fetch(`http://${ip}/api/webserver/SesTokInfo`, { timeout: 3000 }).catch(() => null);
                if (res) {
                    const text = await res.text();
                    if (text.includes('<SesInfo>')) { sesTok = text; break; }
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            
            if (!sesTok) return null;
            const session = sesTok.match(/<SesInfo>(.*?)<\/SesInfo>/)?.[1];
            const token = sesTok.match(/<TokInfo>(.*?)<\/TokInfo>/)?.[1];

            if (session && token) {
                this.hilinkCache = { session, token, isLoggedIn: true, lastFetch: Date.now() };
                return { 'Cookie': session, '__RequestVerificationToken': token };
            }
            return null;
        } catch (e) { return null; }
    }

    async updateStatus() {
        if (this.ussdInProgress || this.apiLock) return; // Prevent interruption
        if (this.isSerial) {
            const res = await this.sendCommand('AT+CSQ;+COPS?');
            if (res) {
                this.data.online = true;
                const csqMatch = res.match(/\+CSQ:\s*(\d+)/);
                if (csqMatch) this.data.signal = Math.round((parseInt(csqMatch[1])/31)*100);
                const copsMatch = res.match(/\+COPS:.*"(.*)"/);
                if (copsMatch) this.data.operator = copsMatch[1];
            }
            return;
        }

        if (this.isZte) {
            try {
                const res = await fetch(`http://${this.config.ip}/goform/goform_get_cmd_process?cmd=network_type,signal_strength&_=${Date.now()}`).then(r => r.json());
                if (res.network_type) {
                    this.data.online = true;
                    this.data.networkType = res.network_type;
                    this.data.signal = parseInt(res.signal_strength || 0) * 20; 
                    this.data.lastUpdate = Date.now();
                }
            } catch (e) { this.data.online = false; }
            return;
        }

        try {
            const headers = await this.getHilinkHeaders();
            const endpoints = ['monitoring/status', 'monitoring/converged-status', 'device/information', 'device/signal'];
            let raw = '';
            for (let ep of endpoints) {
                try {
                    const r = await fetch(`http://${this.config.ip}/api/${ep}`, { timeout: 2000 });
                    raw = await r.text();
                    if (raw.includes('125002')) {
                        const rWithH = await fetch(`http://${this.config.ip}/api/${ep}`, { headers, timeout: 3000 });
                        raw = await rWithH.text();
                    }
                    if (raw.includes('125002')) {
                        this.hilinkCache.isLoggedIn = false;
                        await new Promise(r => setTimeout(r, 5000));
                        break;
                    }
                } catch (err) {}
                if (raw.includes('SignalIcon') || raw.includes('SignalStrength')) break;
            }
            
            if (raw.includes('SignalIcon') || raw.includes('SignalStrength') || raw.includes('rsrp') || raw.includes('rssi')) {
                this.data.online = true;
                
                const iconMatch = raw.match(/<SignalIcon>(\d+)<\/SignalIcon>/);
                const strMatch = raw.match(/<SignalStrength>(\d+)<\/SignalStrength>/);
                const rssiMatch = raw.match(/<rssi>([^<]+)<\/rssi>/i);
                
                if (strMatch) {
                    let val = parseInt(strMatch[1]);
                    this.data.signal = val <= 5 ? val * 20 : val;
                } else if (iconMatch) {
                    this.data.signal = parseInt(iconMatch[1]) * 20;
                } else if (rssiMatch) {
                    // RSSI is typically -113 to -51 dBm. 
                    // Let's roughly convert it to percentage.
                    let val = parseInt(rssiMatch[1]);
                    if (val < 0) {
                        let pct = 2 * (val + 100); 
                        if (pct > 100) pct = 100;
                        if (pct < 0) pct = 0;
                        this.data.signal = pct;
                    } else {
                        this.data.signal = val;
                    }
                }
                
                const netMatch = raw.match(/<CurrentNetworkType>(\d+)<\/CurrentNetworkType>/);
                if (netMatch) this.data.networkType = this.mapNetwork(netMatch[1]);
                this.data.lastUpdate = Date.now();
            } else {
                this.data.online = false;
            }
        } catch (e) { this.data.online = false; }
    }

    mapNetwork(val) {
        const types = { '0': 'No Service', '1': '2G', '2': '3G', '3': '4G', '101': '4G+', '7': '4G' };
        return types[val] || 'Connected';
    }

    async diagnose() {
        const results = { success: false, info: {}, raw: {} };
        if (this.isSerial) {
            try {
                results.raw.ati = await this.sendCommand('ATI');
                results.raw.cimi = await this.sendCommand('AT+CIMI');
                results.raw.cgsn = await this.sendCommand('AT+CGSN');
                results.info = {
                    imei: results.raw.cgsn?.match(/(\d{15})/)?.[1],
                    imsi: results.raw.cimi?.match(/(\d{15})/)?.[1],
                    model: results.raw.ati?.match(/Model:\s*(.*)/)?.[1] || 'Serial Modem'
                };
                results.success = true;
            } catch (e) { results.error = e.message; }
            return results;
        }
        try {
            const headers = await this.getHilinkHeaders();
            const res = await fetch(`http://${this.config.ip}/api/device/information`, { headers }).then(r => r.text());
            results.info = {
                model: res.match(/<DeviceName>(.*)<\/DeviceName>/)?.[1],
                imei: res.match(/<Imei>(.*)<\/Imei>/)?.[1],
                msisdn: res.match(/<Msisdn>(.*)<\/Msisdn>/)?.[1]
            };
            results.success = true;
        } catch (e) { results.error = e.message; }
        return results;
    }

    async reboot() {
        try {
            const headers = await this.getHilinkHeaders();
            const xml = '<?xml version="1.0" encoding="UTF-8"?><request><Control>1</Control></request>';
            await fetch(`http://${this.config.ip}/api/device/reboot`, { method: 'POST', headers, body: xml });
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    }

    encode7bit(str) {
        try {
            let bytes = [];
            let bitBuffer = 0, bitCount = 0;
            for (let i = 0; i < str.length; i++) {
                let charCode = str.charCodeAt(i) & 0x7F;
                bitBuffer |= (charCode << bitCount);
                bitCount += 7;
                if (bitCount >= 8) {
                    bytes.push(bitBuffer & 0xFF);
                    bitBuffer >>= 8;
                    bitCount -= 8;
                }
            }
            if (bitCount > 0) bytes.push(bitBuffer & 0xFF);
            return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
        } catch (e) { return str; }
    }

    toUCS2Hex(text) {
        let hex = "";
        for (let i = 0; i < text.length; i++) {
            hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
        }
        return hex;
    }

    // Simple FIFO queue for USSD requests (balance checks)
    _ussdQueue = [];
    _processingQueue = false;

    async _processQueue() {
        if (this.ussdInProgress) return; // already running
        this.ussdInProgress = true;
        while (this._ussdQueue.length > 0) {
            const item = this._ussdQueue.shift();
            if (item.isQuery) {
                this._executeQueryUssd(item.customCode).then(res => {
                    item.resolve(res);
                    this._processQueue();
                });
            } else if (item.isSequence) {
                this._executeUssdSequence(item.sequence).then(res => {
                    item.resolve(res);
                    this._processQueue();
                });
            } else {
                this._executeCheckBalance(item.customCode).then(() => {
                    item.resolve(this.data.balance);
                    this._processQueue();
                });
            }
            return;
        }
        this.ussdInProgress = false;
    }

    // Internal method that actually performs the USSD request
    async _executeCheckBalance(customCode) {
        let op = this.config.operator.toLowerCase();
        let code = customCode;
        let isMobilisDefault = false;
        if (!code) {
            if (op === 'mobilis') {
                code = `*632*01*${this.config.pin || '00000'}#`;
                isMobilisDefault = true;
            }
            else if (op === 'ooredoo') code = `*200*${this.config.pin || '0000'}#`;
            else if (op === 'sama') code = '*222#';
            else code = '*222#';
        }
        try {
            // same logic as before for sending USSD and parsing
            if (this.isZte) return this.checkBalanceZte(customCode);
            let headers = await this.getHilinkHeaders();
            if (!headers) { return; }
            
            // We only use the Arsselli Dealer code (or the user's custom code)
            let codesToTry = [code];
            let balanceFound = false;
            
            for (let c of codesToTry) {
                console.log(`📡 [${this.key}] Sending USSD: ${c}`);
                const xml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?><request><content>${c}</content><codeType>15</codeType></request>`;
                await fetch(`http://${this.config.ip}/api/ussd/send`, { method: 'POST', headers, body: xml }).catch(() => {});
                
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const res = await fetch(`http://${this.config.ip}/api/ussd/get`, { headers }).then(r => r.text()).catch(() => '');
                    if (res.includes('<content>')) {
                        let content = res.match(/\u003ccontent\u003e([\s\S]*?)\u003c\/content\u003e/)?.[1];
                        if (content) console.log(`🔎 [${this.key}] Raw USSD content: ${content}`);
                        if (content && !res.includes('USSD process')) {
                            console.log(`💰 [${this.key}] Result: ${this.decodeUCS2(content)}`);
                            const balance = this.extractBalance(content, this.data.preferredBalance);
                            if (balance) {
                                this.data.balance = balance;
                                console.log(`✅ [${this.key}] Balance Sync: ${this.data.balance} DA`);
                                balanceFound = true;
                            }
                            break;
                        }
                    }
                }
                
                // Trigger SMS polling for Mobilis since dealer balance comes via SMS
                if (op === 'mobilis') this.pollSms();
                
                if (balanceFound) break; // Optimization: Stop if we already got the balance
            }
        } catch (e) { console.error(`❌ Error: ${e.message}`); }
    }

    async checkBalance(customCode = null) {
        return new Promise(resolve => {
            this._ussdQueue.push({customCode, resolve});
            this._processQueue();
        });
    }

    async queryUssd(customCode) {
        return new Promise(resolve => {
            this._ussdQueue.push({customCode, resolve, isQuery: true});
            this._processQueue();
        });
    }

    async executeUssdSequence(sequence) {
        return new Promise(resolve => {
            this._ussdQueue.push({sequence, resolve, isSequence: true});
            this._processQueue();
        });
    }

    async _executeUssdSequence(sequence) {
        try {
            if (this.isZte) return null; // Interactive sequence not implemented for ZTE yet
            let headers = await this.getHilinkHeaders();
            if (!headers) return null;

            let lastRes = null;
            for (let i = 0; i < sequence.length; i++) {
                const step = sequence[i];
                const codeType = i === 0 ? 15 : 2; // 15 for new session, 2 for reply
                console.log(`📡 [${this.key}] Interactive USSD Step ${i+1}: ${step} (CodeType: ${codeType})`);
                const xml = `<?xml version="1.0" encoding="UTF-8"?><request><content>${step}</content><codeType>${codeType}</codeType></request>`;
                await fetch(`http://${this.config.ip}/api/ussd/send`, { method: 'POST', headers, body: xml }).catch(() => {});
                
                // Wait for response of this step
                for (let j = 0; j < 15; j++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const res = await fetch(`http://${this.config.ip}/api/ussd/get`, { headers }).then(r => r.text()).catch(() => '');
                    if (res.includes('<content>')) {
                        let content = res.match(/\u003ccontent\u003e([\s\S]*?)\u003c\/content\u003e/)?.[1];
                        if (content && !res.includes('USSD process')) {
                            lastRes = this.decodeUCS2(content);
                            console.log(`🔎 [${this.key}] Step ${i+1} Response: ${lastRes.substring(0, 50)}...`);
                            break;
                        }
                    }
                }
                
                // If this is the last step, we don't need to delay before next
                if (i < sequence.length - 1) {
                    await new Promise(r => setTimeout(r, 2000)); // Short delay before next reply
                }
            }
            return lastRes;
        } catch (e) { console.error(`Error in USSD Sequence: ${e.message}`); }
        return null;
    }

    async _executeQueryUssd(customCode) {
        try {
            if (this.isZte) return await this.queryUssdZte(customCode);
            let headers = await this.getHilinkHeaders();
            if (!headers) return null;

            console.log(`📡 [${this.key}] Query USSD: ${customCode}`);
            const xml = `<?xml version="1.0" encoding="UTF-8"?><request><content>${customCode}</content><codeType>15</codeType></request>`;
            await fetch(`http://${this.config.ip}/api/ussd/send`, { method: 'POST', headers, body: xml }).catch(() => {});
            
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const res = await fetch(`http://${this.config.ip}/api/ussd/get`, { headers }).then(r => r.text()).catch(() => '');
                if (res.includes('<content>')) {
                    let content = res.match(/\u003ccontent\u003e([\s\S]*?)\u003c\/content\u003e/)?.[1];
                    if (content && !res.includes('USSD process')) {
                        return this.decodeUCS2(content);
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    async checkBalanceZte(customCode = null) {
        const code = customCode || (this.config.operator.toLowerCase() === 'mobilis' ? `*632*01*${this.config.pin || '0000'}#` : '*222#');
        console.log(`🚀 [ZTE][${this.key}] Checking Balance: ${code}`);
        const res = await this.queryUssdZte(code);
        if (res) {
            const match = res.match(/(\d+([\.,]\d+)?)/);
            if (match) this.data.balance = match[1].replace(',', '.');
            else this.data.balance = res.substring(0, 50);
        }
        this.ussdInProgress = false;
    }

    async queryUssdZte(code) {
        try {
            console.log(`📡 [ZTE][${this.key}] Sending USSD: ${code}`);
            const sendUrl = `http://${this.config.ip}/goform/goform_set_cmd_process`;
            const body = `isAsync=0&goformId=USSD_SEND&ussd_cmd=${encodeURIComponent(code)}`;
            
            const sendRes = await fetch(sendUrl, { 
                method: 'POST', 
                headers: { 'Referer': `http://${this.config.ip}/index.html` },
                body 
            }).then(r => r.json()).catch(() => ({ result: 'fail' }));

            if (sendRes.result === 'success' || sendRes.result === 'OK') {
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 1500));
                    const getUrl = `http://${this.config.ip}/goform/goform_get_cmd_process?cmd=ussd_data_info&isAsync=0&_=${Date.now()}`;
                    const resJson = await fetch(getUrl, { headers: { 'Referer': `http://${this.config.ip}/index.html` } }).then(r => r.json()).catch(() => ({}));
                    
                    if (resJson.ussd_data && resJson.ussd_data !== 'processing') {
                        console.log(`✅ [ZTE][${this.key}] Response: ${resJson.ussd_data}`);
                        return resJson.ussd_data;
                    }
                    process.stdout.write(':');
                }
            } else {
                console.log(`❌ [ZTE][${this.key}] Send Failed:`, sendRes);
            }
        } catch (e) { console.error(`❌ [ZTE][${this.key}] Error:`, e.message); }
        return null;
    }

    decode7Bit(hex) {
        try {
            let out = "";
            let bytes = hex.match(/../g).map(h => parseInt(h, 16));
            let bitBuffer = 0, bitCount = 0;
            for (let b of bytes) {
                bitBuffer |= (b << bitCount);
                bitCount += 8;
                while (bitCount >= 7) {
                    let charCode = bitBuffer & 0x7F;
                    out += String.fromCharCode(charCode);
                    bitBuffer >>= 7;
                    bitCount -= 7;
                }
            }
            return out;
        } catch (e) { return hex; }
    }

    decodeUCS2(text, dcs = null) {
        try {
            if (!text) return "";
            const trimmed = text.trim();
            if (trimmed === 'OK' || trimmed === 'ERROR' || trimmed.includes('^RSSI')) return trimmed;
            
            // If it's already readable, return it
            if (trimmed.length > 5 && /[a-zA-Z\s]/.test(trimmed) && !/^[0-9A-Fa-f]+$/.test(trimmed)) {
                return trimmed;
            }

            let cleanText = trimmed.replace(/FEFF/g, '').replace(/["']/g, '');
            
            // If it looks like UCS2 Hex
            if (/^[0-9A-Fa-f]+$/.test(cleanText) && cleanText.length % 4 === 0) {
                let utf8 = "";
                for (let i = 0; i < cleanText.length; i += 4) {
                    utf8 += String.fromCharCode(parseInt(cleanText.substr(i, 4), 16));
                }
                return utf8;
            }

            // Fallback for mixed or other encodings
            return cleanText.replace(/([0-9A-Fa-f]{4,})/g, (match) => {
                if (match.length % 4 === 0) {
                    let utf8 = "";
                    for (let i = 0; i < match.length; i += 4) {
                        utf8 += String.fromCharCode(parseInt(match.substr(i, 4), 16));
                    }
                    return utf8;
                }
                return match;
            });
        } catch (e) { return text; }
    }

    stripModemNoise(text) {
        return text.replace(/\^(?:RSSI|HCSQ|SMMEMFULL|MODE|DSFLOWRPT|SRVST|PBMREADY|BOOT):[^\r\n]*/g, '').trim();
    }

    extractBalance(text, preferred = null) {
        if (!text) return null;
        let decoded = this.decodeUCS2(text);
        console.log(`🔍 [EXTRACT] Analyzing: "${decoded}"`);
        
        let clean = decoded;

        // Pattern 1: Mobilis/Ooredoo/Sama formats with Solde, Balance, Credit, etc
        const patterns = [
            /(?:solde|balance|credit|crédit|compte|montant|رصيدك|رصيد)(?:\s*(?:stormcredit))?(?:\s*(?:est\s*de|est|is|هو))?\s*:?\s*(\d+[\d.,\s]*)/i,
            /(?:gts|assilou)(?:\s*(?:est\s*de|est|is))?\s*:?\s*(\d+[\d.,\s]*)/i,
            /(?:restant|actuel)\s*:?\s*(\d+[\d.,\s]*)/i
        ];

        for (let p of patterns) {
            const match = clean.match(p);
            if (match) {
                let val = match[1].trim().replace(/\s/g, ''); // Remove spaces
                
                if (val.includes('.') && val.includes(',')) {
                    val = val.replace(/\./g, '').replace(',', '.');
                } else if (val.includes(',')) {
                    val = val.replace(',', '.');
                }
                
                const num = parseFloat(val);
                // Require a valid number. We don't restrict to >0 because 0.00 is a valid balance.
                if (!isNaN(num)) return num.toFixed(2);
            }
        }

        return null;
    }

    async pollSms(isSilent = false) {
        if (this.isZte) return; 
        if (this.smsPolling) return; // Concurrency lock
        if (!this.processedSmsIds) this.processedSmsIds = new Set();
        this.smsPolling = true;

        try {
            let headers = await this.getHilinkHeaders();
            if (!headers) { this.smsPolling = false; return; }
            
            const xmlBody = `<?xml version="1.0" encoding="UTF-8"?><request><PageIndex>1</PageIndex><ReadCount>10</ReadCount><BoxType>1</BoxType><SortType>0</SortType><Ascending>0</Ascending><UnreadPreferred>0</UnreadPreferred></request>`;
            const res = await fetch(`http://${this.config.ip}/api/sms/sms-list`, {
                method: 'POST', headers, body: xmlBody
            }).then(r => r.text());
            
            if (res.includes('<Message>')) {
                const messages = res.match(/<Message>([\s\S]*?)<\/Message>/g);
                if (messages) {
                    for (let m of messages) {
                        const date = m.match(/<Date>(.*?)<\/Date>/)?.[1] || '';
                        let content = m.match(/<Content>([\s\S]*?)<\/Content>/)?.[1] || '';
                        const phone = m.match(/<Phone>(.*?)<\/Phone>/)?.[1] || 'Unknown';
                        
                        // Robust fingerprint: phone + date + first part of content
                        const fingerprint = `${phone}_${date}_${content.substring(0, 30)}`;

                        if (!this.processedSmsIds.has(fingerprint)) {
                            this.processedSmsIds.add(fingerprint);
                            
                            // Decode content if it looks like Hex
                            if (/^[0-9A-F]+$/i.test(content) && content.length > 4) {
                                content = this.decodeUCS2(content);
                            }
                            content = content.replace(/\uFEFF/g, '').trim();

                            if (content && !isSilent) {
                                console.log(`📩 [${this.key}] New SMS from ${phone}: ${content.substring(0, 60)}...`);
                                
                            // Parse balance
                                const balance = this.extractBalance(content, this.data.preferredBalance);
                                if (balance && balance !== '0.00') {
                                    this.data.balance = balance;
                                    console.log(`💰 [${this.key}] Balance Sync: ${this.data.balance} DA`);
                                }

                                this.data.lastSms = { 
                                    from: phone, text: content.substring(0, 150), 
                                    time: new Date().toLocaleTimeString(), timestamp: Date.now() 
                                };
                            }
                        }
                    }
                    if (this.processedSmsIds.size > 200) {
                        const items = Array.from(this.processedSmsIds);
                        this.processedSmsIds = new Set(items.slice(-100)); // Keep last 100
                    }
                }
            }
        } catch (e) { if (!isSilent) console.error(`❌ [${this.key}] SMS Poll Error:`, e.message); }
        this.smsPolling = false;
    }
}

module.exports = ModemService;
