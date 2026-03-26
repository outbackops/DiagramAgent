const http = require('http');

const data = JSON.stringify({
  code: 'x -> y'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/render',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    body += chunk; 
  });
  res.on('end', () => {
    console.log('Response length:', body.length);
    if(body.length < 500) console.log(body);
  });
});

req.on('error', (e) => {
  console.error(`problem with request 3000: ${e.message}`);
  // Try 3001
  options.port = 3001;
  const req2 = http.request(options, (res) => {
      console.log(`STATUS 3001: ${res.statusCode}`);
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => console.log('Response 3001 length:', body.length));
  });
  req2.on('error', e2 => console.error('prob 3001', e2));
  req2.write(data);
  req2.end();
});

req.write(data);
req.end();
