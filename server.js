require('dotenv').config();
const express = require('express');
const multer = require('multer');
const PDFParser = require('pdf2json');
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

// Extract text using pdf2json
function extractTextFromPDF(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataError', (err) => {
      reject(err.parserError);
    });

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      try {
        let text = '';
        const pages = pdfData.Pages || [];

        for (const page of pages) {
          const texts = page.Texts || [];
          for (const t of texts) {
            for (const r of t.R) {
              text += decodeURIComponent(r.T) + ' ';
            }
          }
          text += '\n\n';
        }

        resolve({
          text: text.trim(),
          pages: pages.length
        });
      } catch (e) {
        reject(e);
      }
    });

    pdfParser.parseBuffer(buffer);
  });
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

    // Step 1: Extract text
    const { text: extractedText, pages } = await extractTextFromPDF(req.file.buffer);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF. It may be a scanned image.' });
    }

    // Step 2: Chunk and summarize
    const chunks = chunkText(extractedText);
    let fullSummary = '';

    for (const chunk of chunks) {
      const chatCompletion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a study assistant that summarizes text into bullet points.
STRICT RULES:
- Use ## for section headings
- Use * for bullet points
- Keep each bullet short and clear (1 sentence max)
- Output ONLY the summary bullet points
- Do NOT write any introduction or conclusion sentences
- Do NOT say "Here is a summary" or "I hope this helps"
- Do NOT add feedback, commentary, or suggestions
- Do NOT say "please let me know" or "please revise"
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

    // Step 3: Return results
    const extractedWordCount = extractedText.split(/\s+/).filter(Boolean).length;
    const summaryWordCount = fullSummary.split(/\s+/).filter(Boolean).length;
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