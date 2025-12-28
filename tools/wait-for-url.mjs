import http from 'http';

const url = process.argv[2];
const timeoutMs = Number(process.argv[3] || 60000);

if (!url) {
  console.error('Usage: node tools/wait-for-url.mjs <url> [timeoutMs]');
  process.exit(1);
}

const start = Date.now();

function ping() {
  http
    .get(url, (res) => {
      res.resume();
      console.log('Preview ready:', url);
      process.exit(0);
    })
    .on('error', () => {
      if (Date.now() - start > timeoutMs) {
        console.error('Preview not ready:', url);
        process.exit(1);
      }
      setTimeout(ping, 1000);
    });
}

ping();
