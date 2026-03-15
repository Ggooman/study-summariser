const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const summarizeBtn = document.getElementById('summarizeBtn');
const loaderCard = document.getElementById('loaderCard');
const statsBar = document.getElementById('statsBar');
const resultCard = document.getElementById('resultCard');
const summaryContent = document.getElementById('summaryContent');
const errorCard = document.getElementById('errorCard');
const errorMessage = document.getElementById('errorMessage');
const copyBtn = document.getElementById('copyBtn');
const uploadBox = document.getElementById('uploadBox');

// When user picks a file
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    fileNameDisplay.textContent = '✅ ' + file.name;
    summarizeBtn.disabled = false;
  } else {
    fileNameDisplay.textContent = 'No file chosen';
    summarizeBtn.disabled = true;
  }
});

// Drag and drop support
uploadBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadBox.classList.add('drag-over');
});

uploadBox.addEventListener('dragleave', () => {
  uploadBox.classList.remove('drag-over');
});

uploadBox.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadBox.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    fileInput.files = e.dataTransfer.files;
    fileNameDisplay.textContent = '✅ ' + file.name;
    summarizeBtn.disabled = false;
  }
});

// Convert markdown-style text to HTML
function formatSummary(text) {
  // Convert **heading** to <h3>
  text = text.replace(/\*\*(.+?)\*\*/g, (match, content) => {
    // If it looks like a heading (standalone line), make it h3
    return `<strong>${content}</strong>`;
  });

  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    // Heading lines (lines ending with ** or starting with ##)
    if (line.startsWith('## ') || line.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${line.replace(/^#+\s*/, '')}</h3>`;
    }
    // Bullet points (* or -)
    else if (line.startsWith('* ') || line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.substring(2)}</li>`;
    }
    // Bold standalone line = treat as heading
    else if (line.startsWith('<strong>') && line.endsWith('</strong>')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${line.replace(/<\/?strong>/g, '')}</h3>`;
    }
    // Regular paragraph
    else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${line}</p>`;
    }
  }

  if (inList) html += '</ul>';
  return html;
}

// When user clicks Summarize
summarizeBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  // Hide previous results
  resultCard.hidden = true;
  errorCard.hidden = true;
  statsBar.hidden = true;

  // Show loader
  loaderCard.hidden = false;
  summarizeBtn.disabled = true;
  summarizeBtn.textContent = '⏳ Summarizing...';

  const formData = new FormData();
  formData.append('pdf', file);

  try {
    const response = await fetch('/summarize', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }

    // Calculate stats
    const extractedWords = data.wordCount || 0;
    const summaryWords = data.summary.split(' ').length;
    const pages = data.pages || '?';
    const reduction = extractedWords > 0
      ? Math.round((1 - summaryWords / extractedWords) * 100)
      : 0;

    // Show stats
    document.getElementById('pageCount').textContent = pages + ' page(s)';
    document.getElementById('wordCount').textContent = extractedWords.toLocaleString() + ' words extracted';
    document.getElementById('reductionCount').textContent = reduction + '% condensed';
    statsBar.hidden = false;

    // Show formatted summary
    summaryContent.innerHTML = formatSummary(data.summary);
    resultCard.hidden = false;

  } catch (error) {
    errorCard.hidden = false;
    errorMessage.textContent = '❌ Error: ' + error.message;
  } finally {
    loaderCard.hidden = true;
    summarizeBtn.textContent = '✨ Summarize';
    summarizeBtn.disabled = false;
  }
});

// Copy to clipboard
copyBtn.addEventListener('click', () => {
  const text = summaryContent.innerText;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✅ Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = '📋 Copy';
      copyBtn.classList.remove('copied');
    }, 2000);
  });
});