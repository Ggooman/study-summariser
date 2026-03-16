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

function cleanText(text) {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([.!?;:,])([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    // Fix words that got merged together - add space before capital in middle of word
    .replace(/([a-z]{2,})([A-Z][a-z])/g, '$1 $2')
    // Fix common merges like "andthe" "ofthe" "tothe"
    .replace(/\b(and|of|to|in|is|it|be|as|at|so|we|he|by|or|on|do|if|me|my|up|an|go|no|us|am)(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|can|this|that|these|those|their|there|they|with|from|into|onto|upon|over|under|about|above|below|between|through|during|before|after|each|every|some|any|all|both|few|more|most|other|such|than|then|when|where|which|while|who|whom|whose|why|how)\b/gi, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

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

    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = cleanText(pdfData.text);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF. It may be a scanned image.' });
    }

    const chunks = chunkText(extractedText);
    let fullSummary = '';

    for (const chunk of chunks) {
      const chatCompletion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a study assistant that summarizes text into bullet points.
STRICT RULES — follow exactly:
- Use ## for section headings
- Use * for bullet points
- Keep each bullet short and clear (1 sentence max)
- Output ONLY the summary bullet points
- Do NOT write any introduction or conclusion sentences
- Do NOT say "Here is a summary" or "I hope this helps"
- Do NOT add feedback, commentary, or suggestions
- Do NOT say "please let me know" or "please revise"
- Do NOT refer to "the text" or "the document"
- Just output the headings and bullet points, nothing else`
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