// Using native fetch

async function getHilinkHeaders(ip) {
    try {
        const res = await fetch(`http://${ip}/api/webserver/SesTokInfo`).then(r => r.text());
        const ses = res.match(/<SesInfo>(.*)<\/SesInfo>/)?.[1];
        const tok = res.match(/<TokInfo>(.*)<\/TokInfo>/)?.[1];
        return {
            'Cookie': ses ? `SessionID=${ses}` : '',
            '__RequestVerificationToken': tok || '',
            'Content-Type': 'application/xml'
        };
    } catch (e) { return null; }
}

async function set3GOnly(ip) {
    const headers = await getHilinkHeaders(ip);
    if (!headers) { console.log("Failed to get tokens"); return; }

    const xml = `<?xml version="1.0" encoding="UTF-8"?><request><NetworkMode>02</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7FFFFFFFFFFFFFFF</LTEBand></request>`;
    
    console.log("Setting to 3G Only...");
    const res = await fetch(`http://${ip}/api/net/net-mode`, {
        method: 'POST',
        headers,
        body: xml
    }).then(r => r.text());
    
    console.log("Response:", res);
}

set3GOnly('192.168.50.1');
