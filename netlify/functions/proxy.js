// netlify/functions/proxy.js
// Proxy aman: API key tersimpan di server, tidak pernah terlihat pengunjung.
// Node 18+ diperlukan (native fetch). Lihat netlify.toml untuk konfigurasi runtime.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

exports.handler = async function (event) {

  // 1. Handle CORS preflight — WAJIB ada, tanpa ini browser blokir semua request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 2. Hanya izinkan POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // 3. Pastikan API key sudah diset di Netlify environment
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[proxy] ANTHROPIC_API_KEY belum diset di environment Netlify.');
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Konfigurasi server tidak lengkap.' }),
    };
  }

  // 4. Pastikan body tidak kosong
  if (!event.body) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Request body kosong.' }),
    };
  }

  // 5. Parse JSON body — tangkap error parsing secara terpisah
  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Body bukan JSON valid.' }),
    };
  }

  // 6. Validasi field wajib
  if (!parsedBody.model || !Array.isArray(parsedBody.messages)) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Field model dan messages wajib ada.' }),
    };
  }

  // 7. Teruskan ke Anthropic API
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(parsedBody),
    });

    const responseText = await upstream.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      return {
        statusCode: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Respons tidak valid dari Anthropic API.' }),
      };
    }

    // 8. Tangani error HTTP dari Anthropic dengan pesan yang jelas
    if (!upstream.ok) {
      const s = upstream.status;
      let msg = `Error Anthropic API (${s})`;
      if (s === 401) msg = 'API key tidak valid. Periksa konfigurasi Netlify.';
      else if (s === 429) msg = 'Rate limit tercapai. Tunggu beberapa detik lalu refresh.';
      else if (s === 529 || s >= 500) msg = 'Anthropic API sedang gangguan. Coba lagi nanti.';
      return {
        statusCode: s,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: msg }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(responseData),
    };

  } catch (err) {
    console.error('[proxy] Network error:', err.message);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Gagal menghubungi Anthropic: ' + err.message }),
    };
  }
};
