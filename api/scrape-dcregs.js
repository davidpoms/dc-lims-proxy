export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { limit = 20, debug = 'false' } = req.query;

  try {
    // Try to fetch the DC Register recent issues page
    const url = 'https://www.dcregs.dc.gov/Common/DCR/Issues/IssueCategoryList.aspx';
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Debug mode - return raw HTML sample
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
        url: url
      }
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to scrape DC Register', 
      details: error.message,
      stack: error.stack
    });
  }
}

function parseRegulations(html) {
  const regulations = [];
  
  // Try multiple parsing strategies
  
  // Strategy 1: Look for the table structure you showed me
  const tableMatch = html.match(/<table[^>]*id="noticeTable"[^>]*>([\s\S]*?)<\/table>/i);
  
  if (tableMatch) {
    const tableContent = tableMatch[1];
    
    // Find tbody content
    const tbodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const tbodyContent = tbodyMatch ? tbodyMatch[1] : tableContent;
    
    // Split into rows
    const rowMatches = tbodyContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    
    if (rowMatches) {
      for (const row of rowMatches) {
        try {
          const reg = parseRow(row);
          if (reg) regulations.push(reg);
        } catch (e) {
          console.error('Error parsing row:', e);
        }
      }
    }
  }
  
  // Strategy 2: Look for individual Notice IDs anywhere in the page
  if (regulations.length === 0) {
    const noticePattern = /N\d{6}/g;
    const notices = html.match(noticePattern);
    
    if (notices) {
      const uniqueNotices = [...new Set(notices)];
      
      for (const noticeId of uniqueNotices.slice(0, 20)) {
        // Try to find context around this notice ID
        const contextPattern = new RegExp(`(N${noticeId.slice(1)})([\\s\\S]{0,500})`, 'i');
        const contextMatch = html.match(contextPattern);
        
        if (contextMatch) {
          const context = contextMatch[2];
          
          // Try to extract a title
          const titleMatch = context.match(/lblSubject[^>]*>([^<]+)</i);
          const title = titleMatch ? titleMatch[1].trim() : 'Regulation Notice';
          
          regulations.push({
            id: noticeId,
            title: title,
            agency: extractAgency(title),
            category: 'Rulemaking',
            status: 'Published',
            date: extractDate(context) || new Date().toISOString().split('T')[0],
            source: 'Municipal Register',
            detailLink: `https://dcregs.dc.gov/Common/NoticeDetail.aspx?NoticeId=${noticeId}`,
            isNew: true
          });
        }
      }
    }
  }
  
  return regulations;
}

function parseRow(row) {
  // Extract Notice ID
  const noticeIdMatch = row.match(/>(N\d+)<\/a>/i);
  if (!noticeIdMatch) return null;
  const noticeId = noticeIdMatch[1];
  
  // Extract Section Number
  const sectionMatch = row.match(/SectionNumber=([^"&]+)/);
  const sectionNumber = sectionMatch ? sectionMatch[1] : null;
  
  // Extract Subject
  const subjectMatch = row.match(/lblSubject[^>]*>([^<]+)<\/span>/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : 'Unknown Subject';
  
  // Extract agency from subject
  const agency = extractAgency(subject);
  
  // Extract Register Issue
  const registerIssueMatch = row.match(/>Vol\s+(\d+\/\d+)<\/a>/i);
  const registerIssue = registerIssueMatch ? registerIssueMatch[1] : null;
  
  // Extract Publish Date
  const publishDateMatch = row.match(/lblActiondate[^>]*>([^<]+)<\/span>/i);
  const publishDate = publishDateMatch ? publishDateMatch[1].trim() : null;
  
  // Extract document link
  const linkMatch = row.match(/href="([^"]*DownloadFile[^"]*)"/i);
  const documentLink = linkMatch ? linkMatch[1].replace(/^\.\.\//, 'https://dcregs.dc.gov/Common/DCR/Issues/') : null;
  
  // Extract notice detail link
  const noticeLink = `https://dcregs.dc.gov/Common/NoticeDetail.aspx?NoticeId=${noticeId}`;
  
  return {
    id: noticeId,
    title: subject,
    agency: agency,
    category: 'Rulemaking',
    status: 'Published',
    sectionNumber: sectionNumber,
    registerIssue: registerIssue,
    date: publishDate || new Date().toISOString().split('T')[0],
    documentLink: documentLink,
    detailLink: noticeLink,
    source: 'Municipal Register',
    isNew: publishDate ? isWithinDays(publishDate, 7) : false
  };
}

function extractAgency(text) {
  if (!text) return 'Unknown Agency';
  
  // Common DC agency patterns
  const agencies = [
    'Alcoholic Beverage and Cannabis Administration',
    'Department of Health',
    'Department of Transportation',
    'Department of Energy and Environment',
    'Department of Housing and Community Development',
    'Office of the Chief Financial Officer',
    'Metropolitan Police Department',
    'Fire and Emergency Medical Services Department'
  ];
  
  for (const agency of agencies) {
    if (text.includes(agency)) return agency;
  }
  
  // Try to extract first part before dash or "Notice"
  const match = text.match(/^([^-]+(?:Department|Office|Administration|Agency|Board|Commission))/i);
  if (match) return match[1].trim();
  
  const dashMatch = text.match(/^([^-]+)/);
  return dashMatch ? dashMatch[1].trim() : 'Unknown Agency';
}

function extractDate(text) {
  // Look for date patterns like "1/9/2026"
  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  return dateMatch ? dateMatch[1] : null;
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
