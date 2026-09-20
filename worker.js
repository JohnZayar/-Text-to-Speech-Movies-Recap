// Cloudflare Worker — သီဟ/နီလာ အသံ Relay (Chrome/APK အတွက်)
// Microsoft Edge "Read Aloud" ကို Chrome က တိုက်ရိုက်မချိတ်နိုင်လို့ ကြားခံအဖြစ် သုံးပါတယ်။

const ALLOWED_ORIGIN = 'https://johnzayar.github.io';   // ဒီဆိုက်ကပဲ သုံးခွင့်ရှိ
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VERSION = '143.0.3650.75';
const VOICES = ['my-MM-ThihaNeural', 'my-MM-NilarNeural'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin'
};

function hex32() { return crypto.randomUUID().replaceAll('-', ''); }

async function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600;
  ticks -= ticks % 300;
  const data = new TextEncoder().encode(String(ticks) + '0000000' + TOKEN);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function dateString() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + p(d.getUTCDate()) + ' ' + d.getUTCFullYear() + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' GMT+0000 (Coordinated Universal Time)';
}

function escapeXml(t) {
  return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function synth(text, voice, rate, pitch) {
  const gec = await secMsGec();
  const url = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
    '?TrustedClientToken=' + TOKEN + '&ConnectionId=' + hex32() +
    '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=1-' + VERSION;

  const resp = await fetch(url, {
    headers: {
      'Upgrade': 'websocket',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': UA,
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'muid=' + hex32().toUpperCase() + ';'
    }
  });
  const ws = resp.webSocket;
  if (!ws) throw new Error('Microsoft ဘက်က လက်မခံပါ (HTTP ' + resp.status + ')');
  ws.accept();

  return await new Promise((resolve, reject) => {
    const parts = [];
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      if (err) reject(err); else resolve(parts);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 25000);

    ws.addEventListener('message', (ev) => {
      const d = ev.data;
      if (typeof d === 'string') {
        if (d.includes('Path:turn.end')) finish(parts.length ? null : new Error('no-audio'));
      } else {
        const buf = new Uint8Array(d);
        if (buf.length < 2) return;
        const headerLen = (buf[0] << 8) | buf[1];
        const headers = new TextDecoder().decode(buf.subarray(2, 2 + headerLen));
        if (headers.includes('Path:audio') && buf.length > 2 + headerLen) {
          parts.push(buf.slice(2 + headerLen));
        }
      }
    });
    ws.addEventListener('error', () => finish(new Error('ws-error')));
    ws.addEventListener('close', () => finish(parts.length ? null : new Error('ws-closed')));

    const stamp = dateString();
    ws.send('X-Timestamp:' + stamp + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
    const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
      "<voice name='" + voice + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='+0%'>" +
      escapeXml(text) + '</prosody></voice></speak>';
    ws.send('X-RequestId:' + hex32() + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + stamp + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response('forbidden origin', { status: 403 });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Myanmar TTS relay is running ✔', { status: 200, headers: CORS });
    }

    try {
      const body = await request.json();
      const text = String(body.text || '').trim();
      const voice = VOICES.includes(body.voice) ? body.voice : VOICES[0];
      const rate = /^[+-]\d{1,3}%$/.test(body.rate || '') ? body.rate : '+0%';
      const pitch = /^[+-]\d{1,3}Hz$/.test(body.pitch || '') ? body.pitch : '+0Hz';
      if (!text) return new Response('empty text', { status: 400, headers: CORS });
      if (text.length > 1500) return new Response('text too long', { status: 400, headers: CORS });

      const parts = await synth(text, voice, rate, pitch);
      let total = 0;
      parts.forEach(p => { total += p.length; });
      const out = new Uint8Array(total);
      let off = 0;
      parts.forEach(p => { out.set(p, off); off += p.length; });

      return new Response(out, { headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
    } catch (err) {
      return new Response(String(err && err.message ? err.message : err), { status: 502, headers: CORS });
    }
  }
};
