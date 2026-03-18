require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const Groq = require('groq-sdk');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const sequelize = require('./db');
const User = require('./models/User');
const Summary = require('./models/Summary');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
const sessionStore = new SequelizeStore({ db: sequelize });
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));
sessionStore.sync();

// Serve public folder
app.use(express.static('public'));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
}

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

// Groq setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function cleanText(text) {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([.!?;:,])([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/([a-z]{2,})([A-Z][a-z])/g, '$1 $2')
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

// ─── AUTH ROUTES ─────────────────────────────────────────

// Register
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ where: { email } });
    if (existing)
      return res.status(400).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ where: { email } });
    if (!user)
      return res.status(400).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ error: 'Invalid email or password' });

    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Check session
app.get('/auth/me', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, email: req.session.userEmail });
  } else {
    res.json({ loggedIn: false });
  }
});

// ─── SUMMARIZE ROUTE ─────────────────────────────────────

app.post('/summarize', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: 'No PDF file uploaded' });

    const label = req.body.label || req.file.originalname.replace('.pdf', '');
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = cleanText(pdfData.text);

    if (!extractedText || extractedText.trim().length === 0)
      return res.status(400).json({ error: 'Could not extract text from PDF.' });

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

    const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
    const pages = pdfData.numpages;
    const summaryWordCount = fullSummary.split(/\s+/).filter(Boolean).length;
    const reduction = wordCount > summaryWordCount
      ? Math.round((1 - summaryWordCount / wordCount) * 100) : 0;

    // Save to database
    await Summary.create({
      userId: req.session.userId,
      label,
      filename: req.file.originalname,
      pages,
      wordCount,
      content: fullSummary.trim()
    });

    res.json({ summary: fullSummary.trim(), wordCount, pages, reduction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong: ' + err.message });
  }
});

// ─── HISTORY ROUTES ──────────────────────────────────────

// Get all summaries for logged in user
app.get('/history', requireAuth, async (req, res) => {
  try {
    const summaries = await Summary.findAll({
      where: { userId: req.session.userId },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'label', 'filename', 'pages', 'wordCount', 'createdAt']
    });
    res.json(summaries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get single summary
app.get('/history/:id', requireAuth, async (req, res) => {
  try {
    const summary = await Summary.findOne({
      where: { id: req.params.id, userId: req.session.userId }
    });
    if (!summary) return res.status(404).json({ error: 'Not found' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Delete summary
app.delete('/history/:id', requireAuth, async (req, res) => {
  try {
    await Summary.destroy({
      where: { id: req.params.id, userId: req.session.userId }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete summary' });
  }
});

// ─── START SERVER ─────────────────────────────────────────

sequelize.sync({ alter: true }).then(() => {
  console.log('Database synced');
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err.message);
});