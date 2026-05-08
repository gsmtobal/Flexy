const https = require('https');

const postData = JSON.stringify({
    nd: '044866880',
    voucher: '1030759506391305'
});

const options = {
    hostname: 'ecp.at.dz',
    path: '/api/v1/voucher-recharge',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Algérie Télécom/1.0 (dz.algerietelecom.rd.e_paiement; build:1; Android 11; API 30)',
        'X-Requested-With': 'dz.algerietelecom.rd.e_paiement'
    }
};

const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
        console.log('Response:', data);
    });
});

req.on('error', (e) => { console.error(e); });
req.write(postData);
req.end();
