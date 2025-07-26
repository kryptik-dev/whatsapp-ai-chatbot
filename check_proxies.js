const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');
const { SocksProxyAgent } = require('socks-proxy-agent');
const path = require('path');

const PROXY_LIST_URL = 'https://free-proxy-list.net/en/socks-proxy.html';

async function fetchProxies() {
  const res = await axios.get(PROXY_LIST_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    }
  });
  const $ = cheerio.load(res.data);
  const proxies = [];
  $('.fpl-list table tbody tr').each((i, row) => {
    const cols = $(row).find('td');
    const ip = $(cols[0]).text();
    const port = $(cols[1]).text();
    const version = $(cols[4]).text().toLowerCase();
    if (ip && port && version === 'socks4') {
      proxies.push(`socks4://${ip}:${port}`);
    }
  });
  return proxies;
}

async function isProxyAlive(proxy) {
  try {
    const agent = new SocksProxyAgent(proxy);
    await axios.get('https://httpbin.org/ip', {
      httpsAgent: agent,
      proxy: false,
      timeout: 5000,
    });
    return proxy;
  } catch {
    return null;
  }
}

(async () => {
  console.log('Fetching proxies from free-proxy-list.net...');
  const proxies = await fetchProxies();
  console.log(`Checking ${proxies.length} proxies...`);
  const working = [];
  for (const proxy of proxies) {
    const result = await isProxyAlive(proxy);
    if (result) {
      console.log(`[LIVE] ${proxy}`);
      working.push(proxy);
    } else {
      console.log(`[DEAD] ${proxy}`);
    }
  }
  const outPath = path.join(__dirname, 'proxies.txt');
  console.log('Writing to:', outPath);
  fs.writeFileSync(outPath, working.join('\n'), 'utf8');
  console.log(`Done! ${working.length} working proxies saved to proxies.txt`);
})();