async function diag(ip) {
    const endpoints = [
        '/api/webserver/SesTokInfo',
        '/api/monitoring/status',
        '/api/pin/status',
        '/api/device/information',
        '/api/net/current-plmn',
        '/api/net/net-mode'
    ];
    
    console.log(`--- HILINK DIAGNOSTIC [${ip}] ---`);
    
    for (let ep of endpoints) {
        try {
            const res = await fetch(`http://${ip}${ep}`).then(r => r.text());
            console.log(`\n[${ep}]:`);
            console.log(res.replace(/<[^>]*>/g, (m) => `\n${m}`).trim());
        } catch (e) {
            console.log(`\n[${ep}]: FAILED - ${e.message}`);
        }
    }
}

diag('192.168.50.1');
