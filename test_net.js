const https = require('https');
https.get('https://google.com', (res) => {
    console.log('Google Status:', res.statusCode);
}).on('error', (e) => {
    console.error('Google Error:', e.message);
});

https.get('https://api.anycaptcha.com', (res) => {
    console.log('AnyCaptcha Status:', res.statusCode);
}).on('error', (e) => {
    console.error('AnyCaptcha Error:', e.message);
});
