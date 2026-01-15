export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { limit = 20, debug = 'false' } = req.query;
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ 
      success: false,
      error: 'ScrapingBee API key not configured. Add SCRAPINGBEE_API_KEY to Vercel environment variables.' 
    });
  }

  try {
    // Use ScrapingBee to render the DC Register issue list with JavaScript
    const targetUrl = 'https://www.dcregs.dc.gov/Common/DCR/IssueList.aspx';
    const scrapingBeeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render_js=true&wait=3000&premium_proxy=true`;
    
    console.log('Fetching from ScrapingBee...');
    const response = await fetch(scrapingBeeUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ScrapingBee error: ${response.status} - ${errorText}`);
    }
    
    const html = await response.text();
    
    // Debug mode
    if (debug === 'true') {
      return res.status(200).json({
        success: true,
        debug: true,
        htmlSample: html.substring(0, 5000),
        htmlLength: html.length
      });
    }
    
    const regulations = parseRegulations(html);

    return res.status(200).json({ 
      success: true,
      count: regulations.length,
      regulations: regulations.slice(0, parseInt(limit)),
      metadata: {
        scrapedAt: new Date().toISOString(),
        source: 'DC Register via ScrapingBee',
        creditsUsed: 1
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
  
  // Strategy 1: Look for issue table rows
  const issueRowPattern = /<tr[^>]*>[\s\S]*?IssueDetailPage\.aspx\?issueID=(\d+)[^>]*>([^<]+)<\/a>[\s\S]*?<\/tr>/gi;
  let match;
  
  while ((match = issueRowPattern.exec(html)) !== null) {
    const issueId = match[1];
    const issueText = match[2].trim();
    
    // Parse "Volume 73, Issue 2 - January 09, 2026"
    const volMatch = issueText.match(/Volume\s+(\d+)/i);
    const issMatch = issueText.match(/Issue\s+(\d+)/i);
    const dateMatch = issueText.match(/([A-Z][a-z]+\s+\d+,\s+\d{4})/i);
    
    if (volMatch && issMatch) {
      regulations.push({
        id: `ISSUE-${issueId}`,
        title: `DC Register ${issueText}`,
        agency: 'Office of Documents and Administrative Issuances',
        category: 'DC Register Issue',
        status: 'Published',
        registerIssue: `${volMatch[1]}/${issMatch[1]}`,
        date: dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString().split('T')[0],
        detailLink: `https://www.dcregs.dc.gov/Common/DCR/Issues/IssueDetailPage.aspx?issueID=${issueId}`,
        source: 'Municipal Register',
        isNew: dateMatch ? isWithinDays(parseDate(dateMatch[1]), 7) : false
      });
    }
  }
  
  // Strategy 2: Look for individual notice entries
  const noticePattern = /<a[^>]*NoticeId=(N\d+)[^>]*>N\d+<\/a>[\s\S]{0,1000}?lblSubject[^>]*>([^<]+)<\/span>/gi;
  
  while ((match = noticePattern.exec(html)) !== null) {
    const noticeId = match[1];
    const subject = match[2].trim();
    
    if (subject.length > 10) { // Only add meaningful titles
      regulations.push({
        id: noticeId,
        title: subject,
        agency: extractAgency(subject),
        category: 'Rulemaking Notice',
        status: 'Published',
        date: new Date().toISOString().split('T')[0],
        detailLink: `https://www.dcregs.dc.gov/Common/NoticeDetail.aspx?NoticeId=${noticeId}`,
        source: 'Municipal Register',
        isNew: true
      });
    }
  }
  
  // Strategy 3: Simple text extraction for volume/issue mentions
  if (regulations.length === 0) {
    const simplePattern = /Volume\s+(\d+),?\s*Issue\s+(\d+)\s*-\s*([^<\n]+)/gi;
    
    while ((match = simplePattern.exec(html)) !== null) {
      regulations.push({
        id: `VOL${match[1]}-ISS${match[2]}`,
        title: `DC Register Volume ${match[1]}, Issue ${match[2]} - ${match[3].trim()}`,
        agency: 'Office of Documents and Administrative Issuances',
        category: 'DC Register Issue',
        status: 'Published',
        registerIssue: `${match[1]}/${match[2]}`,
        date: parseDate(match[3]),
        detailLink: `https://www.dcregs.dc.gov/Common/DCR/IssueList.aspx`,
        source: 'Municipal Register',
        isNew: isWithinDays(parseDate(match[3]), 7)
      });
    }
  }
  
  return regulations;
}

function parseDate(dateString) {
  if (!dateString) return new Date().toISOString().split('T')[0];
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return new Date().toISOString().split('T')[0];
    }
    return date.toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function extractAgency(text) {
  if (!text) return 'DC Government';
  
  const agencies = [
    'Alcoholic Beverage and Cannabis Administration',
    'Department of Health',
    'Department of Transportation',
    'Department of Energy and Environment',
    'Department of Housing and Community Development',
    'Office of the Chief Financial Officer',
    'Metropolitan Police Department',
    'Fire and Emergency Medical Services Department',
    'Department of Consumer and Regulatory Affairs',
    'Office of Planning'
  ];
  
  for (const agency of agencies) {
    if (text.toLowerCase().includes(agency.toLowerCase())) return agency;
  }
  
  // Extract first part before " - "
  const dashMatch = text.match(/^([^-]+)/);
  return dashMatch ? dashMatch[1].trim() : 'DC Government';
}

function isWithinDays(dateString, days) {
  if (!dateString) return false;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return false;
    
    const now = new Date();
    const diffDays = (now - date) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  } catch (e) {
    return false;
  }
}
