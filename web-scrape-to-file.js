// Interview Questions Web Scraper with File Output
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Output file paths
const outputFolder = path.join(__dirname, 'scraped_data');
const outputFile = path.join(outputFolder, 'interview_questions.json');
const visitedUrlsFile = path.join(__dirname, 'visitedUrls.json');

// Create output folder if it doesn't exist
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

// Initialize output file with an empty array if it doesn't exist
if (!fs.existsSync(outputFile)) {
  fs.writeFileSync(outputFile, JSON.stringify([], null, 2), 'utf8');
}

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

// Load existing questions to avoid duplicates
let existingQuestions = [];
try {
  if (fs.existsSync(outputFile)) {
    existingQuestions = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    console.log(`Loaded ${existingQuestions.length} existing questions from file`);
  }
} catch (error) {
  console.error('Error loading existing questions:', error.message);
}

// Function to save visited URLs to disk
function saveVisitedUrls() {
  fs.writeFileSync(visitedUrlsFile, JSON.stringify([...visitedUrls]), 'utf8');
  console.log(`Saved ${visitedUrls.size} visited URLs to disk`);
}

// Periodically save visited URLs
setInterval(saveVisitedUrls, 60000); // Every minute

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
function extractInterviewQuestions($, pageUrl) {
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
          source: pageUrl,
          category: detectCategory(text),
          scrapedAt: new Date().toISOString()
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
        source: pageUrl,
        category: detectCategory(text),
        scrapedAt: new Date().toISOString()
      });
    }
  });
  
  return {
    title,
    url: pageUrl,
    questions
  };
}

// Detect category of question based on content
function detectCategory(text) {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('javascript') || lowerText.includes('js ') || lowerText.includes(' js') || 
      lowerText.includes('node') || lowerText.includes('react') || lowerText.includes('angular')) {
    return 'Web Development';
  }
  
  if (lowerText.includes('python') || lowerText.includes('java ') || 
      lowerText.includes('c++') || lowerText.includes('c#')) {
    return 'Programming Languages';
  }
  
  if (lowerText.includes('algorithm') || lowerText.includes('data structure') || 
      lowerText.includes('complexity') || lowerText.includes('big o')) {
    return 'Algorithms & Data Structures';
  }
  
  if (lowerText.includes('sql') || lowerText.includes('database') || 
      lowerText.includes('mongodb') || lowerText.includes('nosql')) {
    return 'Databases';
  }
  
  if (lowerText.includes('system design') || lowerText.includes('architecture') || 
      lowerText.includes('scale') || lowerText.includes('distributed')) {
    return 'System Design';
  }
  
  if (lowerText.includes('manager') || lowerText.includes('leadership') || 
      lowerText.includes('team') || lowerText.includes('project')) {
    return 'Management & Leadership';
  }
  
  if (lowerText.includes('behavior') || lowerText.includes('tell me about') || 
      lowerText.includes('yourself') || lowerText.includes('challenge')) {
    return 'Behavioral';
  }
  
  return 'General';
}

// Save extracted questions to file
function saveQuestionsToFile(extractedData) {
  if (!extractedData || !extractedData.questions || extractedData.questions.length === 0) {
    return 0;
  }
  
  try {
    // Load current data
    let questionsData = [];
    try {
      questionsData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (e) {
      questionsData = [];
    }
    
    let newQuestionCount = 0;
    
    // Add new questions (avoiding duplicates)
    for (const question of extractedData.questions) {
      // Simple duplicate check based on question text
      const isDuplicate = questionsData.some(q => 
        q.question.toLowerCase() === question.question.toLowerCase()
      );
      
      if (!isDuplicate) {
        questionsData.push(question);
        newQuestionCount++;
      }
    }
    
    // Save updated data
    fs.writeFileSync(outputFile, JSON.stringify(questionsData, null, 2), 'utf8');
    
    return newQuestionCount;
  } catch (error) {
    console.error('Error saving questions to file:', error.message);
    return 0;
  }
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
        const newQuestionsCount = saveQuestionsToFile(extractedData);
        console.log(`Found ${extractedData.quest
