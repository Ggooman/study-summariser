require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend files from the public folder
app.use(express.static('public'));

// Store uploaded file in memory
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

// Set up Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Main route — handles PDF upload and summarization
app.post('/summarize', upload.single('pdf'), async (req, res) => {
  try {
    // Check if a file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    // Step 1: Extract text from the PDF
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF. It may be a scanned image.' });
    }

    // Step 2: Send text to Groq for summarization
    const chatCompletion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `You are a helpful study assistant. Please summarize the following study material into clear, concise bullet points that are easy to understand and remember. Group related points together under short headings if possible.\n\nHere is the text:\n\n${extractedText}`
        }
      ],
      max_tokens: 1024
    });

    // Step 3: Save summary and send everything back to frontend
    const summary = chatCompletion.choices[0].message.content;
    const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
    const pages = pdfData.numpages;

    res.json({ summary: summary, wordCount: wordCount, pages: pages });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Something went wrong: ' + error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});