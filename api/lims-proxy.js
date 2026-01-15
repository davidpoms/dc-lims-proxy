export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { endpoint, method = 'GET', body } = req.method === 'POST' ? req.body : req.query;

  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint parameter required' });
  }

  const API_BASE = 'https://lims.dccouncil.gov/api/v2/PublicData';
  const url = `${API_BASE}${endpoint}`;

  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from LIMS API', details: error.message });
  }
}
