const https = require('https');

const options = {
    hostname: 'paiement.at.dz',
    path: '/index.php?p=voucher_internet',
    method: 'GET',
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
        'X-Requested-With': 'dz.algerietelecom.rd.e_paiement'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const hasCaptcha = data.includes('captcha') || data.includes('userCode');
        console.log('Status:', res.statusCode);
        console.log('Has Captcha:', hasCaptcha);
        if (!hasCaptcha) {
            console.log('--- HTML SNIPPET ---');
            console.log(data.substring(0, 500));
        } else {
            // Count occurrences
            const count = (data.match(/captcha/g) || []).length;
            console.log('Captcha occurrences:', count);
        }
    });
});

req.on('error', (e) => {
    console.error(e);
});
req.end();
