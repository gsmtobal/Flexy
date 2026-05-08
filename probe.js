// Diagnostic Probe

async function probe() {
    const ip = '192.168.50.1';
    console.log(`🔍 Probing ${ip}...`);
    
    try {
        const sesTokRes = await fetch(`http://${ip}/api/webserver/SesTokInfo`);
        const sesTok = await sesTokRes.text();
        console.log('--- SesTokInfo ---');
        console.log(sesTok);
        
        const session = sesTok.match(/<SesInfo>(.*?)<\/SesInfo>/)?.[1];
        const token = sesTok.match(/<TokInfo>(.*?)<\/TokInfo>/)?.[1];
        
        const statusRes = await fetch(`http://${ip}/api/ussd/status`, {
            headers: {
                'Cookie': `SessionID=${session}`,
                '__RequestVerificationToken': token,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const status = await statusRes.text();
        console.log('--- USSD Status ---');
        console.log(status);

        const netRes = await fetch(`http://${ip}/api/monitoring/status`, {
            headers: {
                'Cookie': `SessionID=${session}`,
                '__RequestVerificationToken': token,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        console.log('--- Monitoring Status ---');
        console.log(await netRes.text());

    } catch (e) {
        console.error('Error:', e.message);
    }
}

probe();
