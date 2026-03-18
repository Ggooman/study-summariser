// Check auth on load
window.addEventListener('load', async () => {
  const res = await fetch('/auth/me');
  const data = await res.json();
  if (!data.loggedIn) {
    window.location.href = '/login.html';
    return;
  }
  document.getElementById('navEmail').textContent = data.email;
});

// Dark mode
const darkBtn = document.getElementById('darkModeBtn');
const html = document.documentElement;
if (localStorage.getItem('darkMode') === 'true') {
  html.setAttribute('data-theme', 'dark');
  darkBtn.textContent = '☀️ Light';
}
darkBtn.addEventListener('click', () => {
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  darkBtn.textContent = isDark ? '🌙 Dark' : '☀️ Light';
  localStorage.setItem('darkMode', !isDark);
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// File input
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const summarizeBtn = document.getElementById('summarizeBtn');
const uploadBox = document.getElementById('uploadBox');

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    fileNameDisplay.textContent = '✅ ' + file.name;
    summarizeBtn.disabled = false;
    // Auto fill label with filename
    const labelInput = document.getElementById('summaryLabel');
    if (!labelInput.value) {
      labelInput.value = file.name.replace('.pdf', '');
    }
  } else {
    fileNameDisplay.textContent = 'No file chosen';
    summarizeBtn.disabled = true;
  }
});

// Drag and drop
uploadBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadBox.classList.add('drag-over');
});
uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag-over'));
uploadBox.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadBox.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    fileInput.files = e.dataTransfer.files;
    fileNameDisplay.textContent = '✅ ' + file.name;
    summarizeBtn.disabled = false;
    const labelInput = document.getElementById('summaryLabel');
    if (!labelInput.value) labelInput.value = file.name.replace('.pdf', '');
  }
});

// Format markdown to HTML
function formatSummary(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${line.replace(/^#+\s*/, '')}</h3>`;
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      let content = line.substring(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html += `<li>${content}</li>`;
    } else if (line.startsWith('**') && line.endsWith('**')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${line.replace(/\*\*/g, '')}</h3>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      let content = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html += `<p>${content}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// Summarize
summarizeBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const label = document.getElementById('summaryLabel').value.trim() || file.name.replace('.pdf', '');

  document.getElementById('resultCard').hidden = true;
  document.getElementById('errorCard').hidden = true;
  document.getElementById('statsBar').hidden = true;
  document.getElementById('loaderCard').hidden = false;
  summarizeBtn.disabled = true;
  summarizeBtn.textContent = '⏳ Summarizing...';

  const formData = new FormData();
  formData.append('pdf', file);
  formData.append('label', label);

  try {
    const response = await fetch('/summarize', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong');

    document.getElementById('pageCount').textContent = data.pages + ' page(s)';
    document.getElementById('wordCount').textContent = data.wordCount.toLocaleString() + ' words extracted';
    document.getElementById('reductionCount').textContent = data.reduction + '% condensed';
    document.getElementById('statsBar').hidden = false;
    document.getElementById('summaryContent').innerHTML = formatSummary(data.summary);
    document.getElementById('resultCard').hidden = false;

  } catch (err) {
    document.getElementById('errorCard').hidden = false;
    document.getElementById('errorMessage').textContent = '❌ ' + err.message;
  } finally {
    document.getElementById('loaderCard').hidden = true;
    summarizeBtn.textContent = '✨ Summarize';
    summarizeBtn.disabled = false;
  }
});

// Copy
document.getElementById('copyBtn').addEventListener('click', () => {
  const text = document.getElementById('summaryContent').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000);
  });
});

// Download as txt
document.getElementById('downloadBtn').addEventListener('click', () => {
  const text = document.getElementById('summaryContent').innerText;
  const label = document.getElementById('summaryLabel').value || 'summary';
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = label + '.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// History panel
const historyBtn = document.getElementById('historyBtn');
const historyOverlay = document.getElementById('historyOverlay');
const closeHistory = document.getElementById('closeHistory');
const historyList = document.getElementById('historyList');

historyBtn.addEventListener('click', async () => {
  historyOverlay.hidden = false;
  historyList.innerHTML = '<p class="history-empty">Loading...</p>';
  try {
    const res = await fetch('/history');
    const data = await res.json();
    if (!data.length) {
      historyList.innerHTML = '<p class="history-empty">No summaries yet!</p>';
      return;
    }
    historyList.innerHTML = data.map(s => `
      <div class="history-item" data-id="${s.id}">
        <div class="history-info">
          <p class="history-label">${s.label}</p>
          <p class="history-meta">${s.filename} · ${s.pages} page(s) · ${new Date(s.createdAt).toLocaleDateString()}</p>
        </div>
        <div class="history-btns">
          <button class="btn-view" onclick="viewSummary(${s.id})">View</button>
          <button class="btn-delete" onclick="deleteSummary(${s.id})">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch {
    historyList.innerHTML = '<p class="history-empty">Failed to load history.</p>';
  }
});

closeHistory.addEventListener('click', () => historyOverlay.hidden = true);
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) historyOverlay.hidden = true;
});

// View summary from history
async function viewSummary(id) {
  try {
    const res = await fetch(`/history/${id}`);
    const data = await res.json();
    document.getElementById('summaryContent').innerHTML = formatSummary(data.content);
    document.getElementById('resultCard').hidden = false;
    document.getElementById('summaryLabel').value = data.label;
    document.getElementById('statsBar').hidden = false;
    document.getElementById('pageCount').textContent = data.pages + ' page(s)';
    document.getElementById('wordCount').textContent = data.wordCount.toLocaleString() + ' words extracted';
    document.getElementById('reductionCount').textContent = 'Saved summary';
    historyOverlay.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    alert('Failed to load summary');
  }
}

// Delete summary
async function deleteSummary(id) {
  if (!confirm('Delete this summary?')) return;
  try {
    await fetch(`/history/${id}`, { method: 'DELETE' });
    document.querySelector(`[data-id="${id}"]`).remove();
  } catch {
    alert('Failed to delete');
  }
}