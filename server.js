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

// Clean broken text from PDFs
function cleanText(text) {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')           // fix hyphenated line breaks
    .replace(/([a-z])([A-Z])/g, '$1 $2')        // fix camelCase merges
    .replace(/([.,!?;:])([a-zA-Z])/g, '$1 $2')  // fix missing space after punctuation
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')         // fix letter+number merges
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')         // fix number+letter merges
    .replace(/\n{3,}/g, '\n\n')                  // remove excessive line breaks
    .replace(/\s+/g, ' ')                         // normalize spaces
    .trim();
}

// Split long text into chunks to avoid token limits
function chunkText(text, maxChunkSize = 3000) {
  const sentences = text.split('. ');
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChunkSize) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence + '. ';
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

app.post('/summarize', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    // Step 1: Extract and clean text
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = cleanText(pdfData.text);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF. It may be a scanned image.' });
    }

    // Step 2: Chunk text if too long
    const chunks = chunkText(extractedText);
    let fullSummary = '';

    for (const chunk of chunks) {
      const chatCompletion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a study assistant. Your job is to summarize study material into bullet points.
STRICT RULES:
- Use ## for section headings
- Use * for bullet points  
- Keep bullets short and clear
- NEVER add commentary, opinions, or feedback
- NEVER say "please let me know", "I hope this helps", "your summary", or anything similar
- NEVER ask the user to revise anything
- Output ONLY the summary, nothing else`
          },
          {
            role: 'user',
            content: `Summarize this into bullet points:\n\n${chunk}`
          }
        ],
        max_tokens: 1500
      });

      fullSummary += chatCompletion.choices[0].message.content + '\n\n';
    }

    // Step 3: Send back results
    const extractedWordCount = extractedText.split(/\s+/).filter(Boolean).length;
    const summaryWordCount = fullSummary.split(/\s+/).filter(Boolean).length;
    const pages = pdfData.numpages;
    const reduction = extractedWordCount > summaryWordCount
      ? Math.round((1 - summaryWordCount / extractedWordCount) * 100)
      : 0;

    res.json({
      summary: fullSummary.trim(),
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