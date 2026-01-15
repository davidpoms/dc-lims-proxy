export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { limit = 20 } = req.query;
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ 
      success: false,
      error: 'ScrapingBee API key not configured' 
    });
  }

  try {
    // Use ScrapingBee to render JavaScript
    const targetUrl = 'https://www.dcregs.dc.gov/Common/DCR/IssueList.aspx';
    const scrapingBeeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render_js=true&wait=2000`;
    
    const response = await fetch(scrapingBeeUrl);
    
    if (!response.ok) {
      throw new Error(`ScrapingBee error: ${response.status}`);
    }
    
    const html = await response.text();
    const regulations = parseRegulations(html);

    return res.status(200).json({ 
      success: true,
      count: regulations.length,
      regulations: regulations.slice(0, parseInt(limit)),
      metadata: {
        scrapedAt: new Date().toISOString(),
        source: 'DC Register via ScrapingBee'
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to scrape DC Register', 
      details: error.message
    });
  }
}

function parseRegulations(html) {
  const regulations = [];
  
  // Look for issue links in the rendered HTML
  const issuePattern = /<a[^>]*href="([^"]*IssueDetailPage[^"]*)"[^>]*>([^<]*Volume[^<]*)<\/a>/gi;
  let match;
  
  while ((match = issuePattern.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].trim();
    
    // Extract volume, issue, and date
    const volMatch = text.match(/Volume\s+(\d+)/i);
    const issueMatch = text.match(/Issue\s+(\d+)/i);
    const dateMatch = text.match(/(\w+\s+\d+,\s+\d{4})/);
    
    if (volMatch && issueMatch) {
      regulations.push({
        id: `VOL${volMatch[1]}-ISS${issueMatch[1]}`,
        title: text,
        agency: 'Office of Documents and Administrative Issuances',
        category: 'DC Register Issue',
        status: 'Published',
        registerIssue: `${volMatch[1]}/${issueMatch[1]}`,
        date: dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString().split('T')[0],
        detailLink: url.startsWith('http') ? url : `https://www.dcregs.dc.gov/Common/DCR/Issues/${url}`,
        source: 'Municipal Register',
        isNew: dateMatch ? isWithinDays(parseDate(dateMatch[1]), 7) : false
      });
    }
  }
  
  // Also look for notice entries in table format
  const noticePattern = /<tr[^>]*>[\s\S]*?<a[^>]*NoticeId=(N\d+)[^>]*>[\s\S]*?lblSubject[^>]*>([^<]+)<\/span>[\s\S]*?<\/tr>/gi;
  
  while ((match = noticePattern.exec(html)) !== null) {
    const noticeId = match[1];
    const subject = match[2].trim();
    
    regulations.push({
      id: noticeId,
      title: subject,
      agency: extractAgency(subject),
      category: 'Rulemaking',
      status: 'Published',
      date: new Date().toISOString().split('T')[0],
      detailLink: `https://dcregs.dc.gov/Common/NoticeDetail.aspx?NoticeId=${noticeId}`,
      source: 'Municipal Register',
      isNew: true
    });
  }
  
  return regulations;
}

function parseDate(dateString) {
  try {
    return new Date(dateString).toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function extractAgency(text) {
  const agencies = [
    'Alcoholic Beverage and Cannabis Administration',
    'Department of Health',
    'Department of Transportation',
    'Department of Energy and Environment',
    'Department of Housing and Community Development'
  ];
  
  for (const agency of agencies) {
    if (text.includes(agency)) return agency;
  }
  
  const match = text.match(/^([^-]+)/);
  return match ? match[1].trim() : 'DC Government';
}

function isWithinDays(dateString, days) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = (now - date) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  } catch (e) {
    return false;
  }
}
