require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Fix text extracted from PDF — adds spaces between merged words
function cleanText(text) {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')       // camelCase fix
    .replace(/([.,!?;:])([a-zA-Z])/g, '$1 $2')  // punctuation fix
    .replace(/\s+/g, ' ')                         // remove extra spaces
    .trim();
}

app.post('/summarize', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    // Step 1: Extract and clean text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text;
    const extractedText = cleanText(rawText);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF. It may be a scanned image.' });
    }

    // Step 2: Send to Groq with better prompt
    const chatCompletion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `You are a helpful study assistant for students. Summarize the following study material into clear bullet points.

Rules:
- Use ## for main headings
- Use * for bullet points
- Keep each bullet point concise (1-2 sentences max)
- Do NOT add any feedback, commentary, or suggestions
- Do NOT say things like "please let me know" or "your summary appears"
- Just give the summary, nothing else

Text to summarize:

${extractedText}`
        }
      ],
      max_tokens: 1024
    });

    // Step 3: Send back results
    const summary = chatCompletion.choices[0].message.content;
    const extractedWordCount = extractedText.split(/\s+/).filter(Boolean).length;
    const summaryWordCount = summary.split(/\s+/).filter(Boolean).length;
    const pages = pdfData.numpages;

    // Only show positive condensed % 
    const reduction = extractedWordCount > summaryWordCount
      ? Math.round((1 - summaryWordCount / extractedWordCount) * 100)
      : 0;

    res.json({
      summary: summary,
      wordCount: extractedWordCount,
      pages: pages,
      reduction: reduction
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Something went wrong: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});