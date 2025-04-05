// Interview Questions Web Scraper
const axios = require('axios');
const cheerio = require('cheerio');
const { Queue } = require('bull');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Redis connection for Bull queue
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Create Bull queue for processing scraped content
const interviewQuestionsQueue = new Queue('interview-questions', REDIS_URL);

// Path for storing visited URLs to avoid duplicates
const visitedUrlsFile = path.join(__dirname, 'visitedUrls.json');

// Load visited URLs or initialize empty set
let visitedUrls = new Set();
try {
  if (fs.existsSync(visitedUrlsFile)) {
    visitedUrls = new Set(JSON.parse(fs.readFileSync(visitedUrlsFile, 'utf8')));
    console.log(`Loaded ${visitedUrls.size} previously visited URLs`);
  }
} catch (error) {
  console.error('Error loading visited URLs:', error.message);
}

// Periodically save visited URLs to disk
setInterval(() => {
  fs.writeFileSync(visitedUrlsFile, JSON.stringify([...visitedUrls]), 'utf8');
  console.log(`Saved ${visitedUrls.size} visited URLs to disk`);
}, 60000); // Save every minute

// Keywords related to interview questions
const interviewKeywords = [
  'interview questions',
  'coding interview',
  'technical interview',
  'job interview',
  'interview preparation',
  'common interview questions',
  'frequently asked questions',
  'interview tips'
];

// Function to check if a page is likely to contain interview questions
function isInterviewQuestionsPage(title, content) {
  if (!title || !content) return false;
  
  title = title.toLowerCase();
  content = content.toLowerCase();
  
  // Check if title contains interview keywords
  const titleContainsKeyword = interviewKeywords.some(keyword => 
    title.includes(keyword)
  );
  
  if (titleContainsKeyword) return true;
  
  // Check content for interview question patterns
  const hasQuestionPattern = (
    (content.includes('q:') || content.includes('question:')) &&
    (content.includes('a:') || content.includes('answer:'))
  );
  
  // Check if content has multiple question marks in different paragraphs
  const paragraphs = content.split('\n\n');
  const questionMarkParagraphs = paragraphs.filter(p => p.includes('?'));
  
  // Count how many keywords appear in the content
  const keywordMatches = interviewKeywords.filter(keyword => 
    content.includes(keyword)
  ).length;
  
  return hasQuestionPattern || questionMarkParagraphs.length >= 3 || keywordMatches >= 2;
}

// Extract links from a page
function extractLinks($, baseUrl) {
  const links = new Set();
  
  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      try {
        // Resolve relative URLs
        const absoluteUrl = url.resolve(baseUrl, href);
        // Only include http/https links
        if (absoluteUrl.startsWith('http')) {
          links.add(absoluteUrl);
        }
      } catch (error) {
        console.error(`Error resolving URL ${href}:`, error.message);
      }
    }
  });
  
  return [...links];
}

// Extract interview questions from page content
function extractInterviewQuestions($, url) {
  const questions = [];
  const title = $('title').text().trim();
  
  // Method 1: Look for question-answer patterns with specific formatting
  $('h1, h2, h3, h4, h5, h6, p, li').each((_, element) => {
    const text = $(element).text().trim();
    
    // Check if it looks like a question
    if (text.endsWith('?') || /^Q[:.]/i.test(text) || /question/i.test(text)) {
      // Try to find the corresponding answer
      let answer = '';
      let nextElement = $(element).next();
      
      // Look at the next few elements for potential answers
      for (let i = 0; i < 3 && nextElement.length; i++) {
        const nextText = nextElement.text().trim();
        if (nextText && !nextText.endsWith('?') && !/^Q[:.]/i.test(nextText)) {
          answer = nextText;
          break;
        }
        nextElement = nextElement.next();
      }
      
      if (text) {
        questions.push({
          question: text,
          answer: answer || 'No explicit answer found',
          source: url
        });
      }
    }
  });
  
  // Method 2: Look for list items that might be questions
  $('li').each((_, element) => {
    const text = $(element).text().trim();
    if (text.endsWith('?')) {
      questions.push({
        question: text,
        answer: 'No explicit answer found',
        source: url
      });
    }
  });
  
  return {
    title,
    url,
    questions
  };
}

// Scrape a single page
async function scrapePage(pageUrl) {
  if (visitedUrls.has(pageUrl)) {
    console.log(`Already visited: ${pageUrl}`);
    return [];
  }
  
  console.log(`Scraping: ${pageUrl}`);
  let links = [];
  
  try {
    // Mark as visited immediately to prevent concurrent crawls from re-visiting
    visitedUrls.add(pageUrl);
    
    // Use puppeteer for JavaScript-heavy sites
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    
    // Wait a bit for any dynamic content to load
    await page.waitForTimeout(2000);
    
    const content = await page.content();
    const title = await page.title();
    
    await browser.close();
    
    // Parse HTML
    const $ = cheerio.load(content);
    
    // Check if page likely contains interview questions
    if (isInterviewQuestionsPage(title, $('body').text())) {
      const extractedData = extractInterviewQuestions($, pageUrl);
      
      if (extractedData.questions.length > 0) {
        console.log(`Found ${extractedData.questions.length} questions on ${pageUrl}`);
        
        // Add to processing queue
        await interviewQuestionsQueue.add('process-interview-questions', {
          id: uuidv4(),
          title: extractedData.title,
          url: pageUrl,
          questions: extractedData.questions,
          scrapedAt: new Date().toISOString()
        }, {
          attempts: 3,
          removeOnComplete: true
        });
      }
    }
    
    // Extract links for further crawling
    links = extractLinks($, pageUrl);
    
  } catch (error) {
    console.error(`Error scraping ${pageUrl}:`, error.message);
  }
  
  return links;
}

// Start crawling from seed URLs
async function startCrawling(seedUrls) {
  const urlsToVisit = [...seedUrls];
  let processedCount = 0;
  
  while (urlsToVisit.length > 0 && processedCount < 1000) { // Limit to 1000 pages per run
    const currentUrl = urlsToVisit.shift();
    
    if (!visitedUrls.has(currentUrl)) {
      const newLinks = await scrapePage(currentUrl);
      
      // Add new links to the queue
      for (const link of newLinks) {
        if (!visitedUrls.has(link)) {
          urlsToVisit.push(link);
        }
      }
      
      processedCount++;
      
      // Respect website rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`Crawling finished. Processed ${processedCount} pages.`);
}

// Example consumer process for the queue (would typically be in a separate file)
interviewQuestionsQueue.process('process-interview-questions', async (job) => {
  const { id, title, url, questions } = job.data;
  console.log(`Processing ${questions.length} questions from "${title}"`);
  
  // Here you would implement your specific processing logic
  // e.g., store in database, analyze content, etc.
  
  return { id, processed: true, questionCount: questions.length };
});

// Example usage
const seedUrls = [
  'https://www.glassdoor.com/Interview/index.htm',
  'https://leetcode.com/discuss/interview-question',
  'https://www.geeksforgeeks.org/interview-preparation/',
  'https://www.indeed.com/career-advice/interviewing',
  'https://www.interviewbit.com/interview-questions/'
];

// Start the crawler
startCrawling(seedUrls).catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down...');
  // Save visited URLs
  fs.writeFileSync(visitedUrlsFile, JSON.stringify([...visitedUrls]), 'utf8');
  // Close queue
  await interviewQuestionsQueue.close();
  process.exit(0);
});
