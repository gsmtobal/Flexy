const https = require('https');
const querystring = require('querystring');

const postData = querystring.stringify({
    'nd': '038421000', // Dummy number for test
    'userCode': '',
    'validerADSL': 'Valider'
});

const options = {
    hostname: 'paiement.at.dz',
    path: '/index.php?p=voucher_internet',
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
        'X-Requested-With': 'dz.algerietelecom.rd.e_paiement',
        'Referer': 'https://paiement.at.dz/index.php?p=voucher_internet'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Headers:', res.headers);
        // If it worked, we should be on the "suite" page (Step 2)
        const isStep2 = data.includes('voucher') || data.includes('rechargement');
        const hasCaptchaError = data.includes('incorrect') || data.includes('Captcha');
        
        console.log('Is Step 2:', isStep2);
        console.log('Has Captcha Error:', hasCaptchaError);
        
        if (isStep2) {
            console.log('✅ SUCCESS! No captcha needed for Step 1.');
        } else {
            console.log('❌ FAILED. Captcha still required or other error.');
            // console.log(data.substring(0, 1000));
        }
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.write(postData);
req.end();
