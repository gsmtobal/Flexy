async function probeModem(ip) {
    const endpoints = [
        '/api/device/information',
        '/api/webserver/SesTokInfo',
        '/api/monitoring/status',
        '/api/ussd/status'
    ];
    
    console.log(`--- PROBING MODEM [${ip}] ---`);
    for (let ep of endpoints) {
        try {
            const res = await fetch(`http://${ip}${ep}`).then(r => r.text());
            console.log(`\n[${ep}]:\n${res}`);
        } catch (e) {
            console.log(`\n[${ep}]: FAILED - ${e.message}`);
        }
    }
}

probeModem('192.168.50.1');
