export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { limit = 20 } = req.query;

  try {
    // Step 1: Get the initial page to extract ViewState and other form data
    const initialResponse = await fetch('https://www.dcregs.dc.gov/Common/DCR/Issues/IssueCategoryList.aspx', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const initialHtml = await initialResponse.text();
    
    // Extract ViewState and other ASP.NET form fields
    const viewState = extractFormField(initialHtml, '__VIEWSTATE');
    const viewStateGenerator = extractFormField(initialHtml, '__VIEWSTATEGENERATOR');
    const eventValidation = extractFormField(initialHtml, '__EVENTVALIDATION');
    
    // Try to get the latest issue directly
    // Look for the most recent issue in the DC Register
    const issueListResponse = await fetch('https://www.dcregs.dc.gov/Common/DCR/IssueList.aspx', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const issueListHtml = await issueListResponse.text();
    const regulations = parseIssueList(issueListHtml);

    return res.status(200).json({ 
      success: true,
      count: regulations.length,
      regulations: regulations.slice(0, parseInt(limit)),
      metadata: {
        scrapedAt: new Date().toISOString(),
        source: 'DC Register Issue List'
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

function extractFormField(html, fieldName) {
  const pattern = new RegExp(`<input[^>]*name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
  const match = html.match(pattern);
  return match ? match[1] : '';
}

function parseIssueList(html) {
  const regulations = [];
  
  // Look for issue links - format like "Volume 73, Issue 2 - January 09, 2026"
  const issuePattern = /Volume\s+(\d+),\s+Issue\s+(\d+)\s+-\s+([^<\n]+)/gi;
  let match;
  
  const issues = [];
  while ((match = issuePattern.exec(html)) !== null) {
    issues.push({
      volume: match[1],
      issue: match[2],
      date: match[3].trim()
    });
  }
  
  // Look for links to issue detail pages
  const linkPattern = /<a[^>]*href="([^"]*IssueDetailPage[^"]*issueID=(\d+)[^"]*)"/gi;
  const issueLinks = [];
  
  while ((match = linkPattern.exec(html)) !== null) {
    issueLinks.push({
      url: match[1],
      issueId: match[2]
    });
  }
  
  // For each recent issue, create a regulation entry
  for (let i = 0; i < Math.min(issues.length, 5); i++) {
    const issue = issues[i];
    const link = issueLinks[i];
    
    regulations.push({
      id: `ISSUE-${issue.volume}-${issue.issue}`,
      title: `DC Register Volume ${issue.volume}, Issue ${issue.issue}`,
      agency: 'Office of Documents and Administrative Issuances',
      category: 'DC Register Issue',
      status: 'Published',
      registerIssue: `${issue.volume}/${issue.issue}`,
      date: parseDate(issue.date),
      detailLink: link ? `https://www.dcregs.dc.gov/Common/DCR/Issues/${link.url}` : null,
      source: 'Municipal Register',
      isNew: isWithinDays(parseDate(issue.date), 7)
    });
  }
  
  // Also try to find individual notice references
  const noticePattern = /<a[^>]*href="[^"]*NoticeId=(N\d+)[^"]*"[^>]*>([^<]*)<\/a>/gi;
  while ((match = noticePattern.exec(html)) !== null) {
    const noticeId = match[1];
    const title = match[2].trim() || 'Regulation Notice';
    
    if (title.length > 10) { // Only add if we have a meaningful title
      regulations.push({
        id: noticeId,
        title: title,
        agency: extractAgency(title),
        category: 'Rulemaking',
        status: 'Published',
        date: new Date().toISOString().split('T')[0],
        detailLink: `https://dcregs.dc.gov/Common/NoticeDetail.aspx?NoticeId=${noticeId}`,
        source: 'Municipal Register',
        isNew: true
      });
    }
  }
  
  return regulations;
}

function parseDate(dateString) {
  if (!dateString) return new Date().toISOString().split('T')[0];
  
  try {
    // Handle formats like "January 09, 2026"
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function extractAgency(text) {
  if (!text) return 'Unknown Agency';
  
  const agencies = [
    'Alcoholic Beverage and Cannabis Administration',
    'Department of Health',
    'Department of Transportation',
    'Department of Energy and Environment',
    'Department of Housing and Community Development',
    'Office of the Chief Financial Officer',
    'Metropolitan Police Department',
    'Fire and Emergency Medical Services Department',
    'Office of Documents and Administrative Issuances'
  ];
  
  for (const agency of agencies) {
    if (text.includes(agency)) return agency;
  }
  
  const match = text.match(/^([^-]+(?:Department|Office|Administration|Agency|Board|Commission))/i);
  if (match) return match[1].trim();
  
  const dashMatch = text.match(/^([^-]+)/);
  return dashMatch ? dashMatch[1].trim() : 'DC Government';
}

function isWithinDays(dateString, days) {
  if (!dateString) return false;
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = (now - date) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  } catch (e) {
    return false;
  }
}
