const input = document.getElementById('photo-input');
const statusSection = document.getElementById('status');
const statusText = document.getElementById('status-text');
const preview = document.getElementById('preview');
const resultSection = document.getElementById('result');
const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history');
const clearHistoryButton = document.getElementById('clear-history');
const captureLabel = document.getElementById('capture-label');

const HISTORY_KEY = 'wms-history';
const HISTORY_LIMIT = 25;
const MAX_EDGE = 1280;
const THUMB_EDGE = 96;

const DISPOSITION_LABELS = {
  sell: 'Sell it',
  donate: 'Donate it',
  recycle: 'Recycle it',
  repurpose: 'Repurpose it',
  trash: 'Let it go',
};

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  try {
    const { dataUrl, thumb } = await resizeImage(file);
    showAnalyzing(dataUrl);
    const result = await requestAnalysis(dataUrl);
    showResult(result);
    saveToHistory({ ts: Date.now(), thumb, result });
    renderHistory();
  } catch (err) {
    statusSection.hidden = false;
    statusText.textContent = err.message || 'Something went wrong — try another photo.';
    statusText.classList.add('error');
  } finally {
    captureLabel.textContent = 'Take another photo';
  }
});

clearHistoryButton.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

function showAnalyzing(dataUrl) {
  resultSection.hidden = true;
  resultSection.innerHTML = '';
  preview.src = dataUrl;
  statusText.textContent = 'Analyzing… (this can take ~30 seconds)';
  statusText.classList.remove('error');
  statusSection.hidden = false;
}

async function requestAnalysis(dataUrl) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Analysis failed (${response.status})`);
  }
  return body.result;
}

// Resize on-device: caps upload size and strips EXIF (incl. GPS) via canvas re-encode
async function resizeImage(file) {
  const bitmap = await loadImage(file);
  return {
    dataUrl: drawToJpeg(bitmap, MAX_EDGE, 0.85),
    thumb: drawToJpeg(bitmap, THUMB_EDGE, 0.7),
  };
}

function loadImage(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file).catch(() => loadImageViaElement(file));
  }
  return loadImageViaElement(file);
}

function loadImageViaElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

function drawToJpeg(image, maxEdge, quality) {
  const width = image.width ?? image.naturalWidth;
  const height = image.height ?? image.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function showResult(result) {
  statusSection.hidden = true;
  resultSection.innerHTML = '';
  resultSection.appendChild(buildCard(result));
  resultSection.hidden = false;
}

function buildCard(result) {
  const card = el('div', 'card');

  card.appendChild(el('h2', null, result.name));
  card.appendChild(el('p', 'meta', `${result.category} · condition: ${result.condition}`));

  const badge = el('span', `badge ${result.disposition}`, DISPOSITION_LABELS[result.disposition] || result.disposition);
  card.appendChild(badge);

  if (result.est_value_high > 0) {
    card.appendChild(el('p', 'value', `Estimated value: ${money(result.est_value_low)}–${money(result.est_value_high)}`));
  }
  card.appendChild(el('p', 'reasoning', result.reasoning));
  card.appendChild(buildNextStep(result));
  return card;
}

function buildNextStep(result) {
  const wrap = el('div', 'next-step');
  const actions = el('div', 'actions');

  switch (result.disposition) {
    case 'sell': {
      wrap.appendChild(el('h3', null, 'Ready-to-post listing'));
      const draft = `${result.listing.title}\n\n${result.listing.description}\n\nAsking: ${money(result.listing.suggested_price)}`;
      wrap.appendChild(el('pre', 'listing-draft', draft));
      const copy = el('button', null, 'Copy listing');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(draft);
        copy.textContent = 'Copied!';
        setTimeout(() => { copy.textContent = 'Copy listing'; }, 1500);
      });
      actions.appendChild(copy);
      actions.appendChild(link(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(result.search_query)}&LH_Sold=1&LH_Complete=1`, 'Check sold prices on eBay'));
      actions.appendChild(link('https://www.facebook.com/marketplace/create/item', 'Post on Facebook Marketplace'));
      break;
    }
    case 'donate': {
      wrap.appendChild(el('h3', null, 'Donate it'));
      if (result.donation_fmv > 0) {
        wrap.appendChild(el('p', null, `Fair market value for your tax records: about ${money(result.donation_fmv)}.`));
      }
      actions.appendChild(link('https://www.google.com/maps/search/donation+center+near+me', 'Find a donation center'));
      break;
    }
    case 'recycle': {
      wrap.appendChild(el('h3', null, 'Recycle it'));
      actions.appendChild(link(`https://www.google.com/search?q=${encodeURIComponent(`how to recycle ${result.name} near me`)}`, 'How to recycle this near you'));
      break;
    }
    case 'repurpose': {
      wrap.appendChild(el('h3', null, 'Ideas to reuse it'));
      const list = el('ul');
      for (const idea of result.repurpose_ideas) list.appendChild(el('li', null, idea));
      wrap.appendChild(list);
      break;
    }
    default: {
      wrap.appendChild(el('h3', null, 'Let it go'));
      wrap.appendChild(el('p', null, "Not everything has a second life — tossing it is the honest answer here."));
    }
  }

  if (actions.childNodes.length) wrap.appendChild(actions);
  return wrap;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(entry) {
  const history = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // localStorage full — drop the thumbnail and retry once
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map((h) => ({ ...h, thumb: '' }))));
    } catch { /* give up quietly */ }
  }
}

function renderHistory() {
  const history = loadHistory();
  historySection.hidden = history.length === 0;
  historyList.innerHTML = '';
  for (const entry of history) {
    const item = el('div', 'history-item');
    if (entry.thumb) {
      const img = document.createElement('img');
      img.src = entry.thumb;
      img.alt = '';
      item.appendChild(img);
    }
    const info = el('div', 'info');
    info.appendChild(el('strong', null, entry.result.name));
    const value = entry.result.est_value_high > 0
      ? `${money(entry.result.est_value_low)}–${money(entry.result.est_value_high)}`
      : new Date(entry.ts).toLocaleDateString();
    info.appendChild(el('span', null, value));
    item.appendChild(info);
    item.appendChild(el('span', `mini-badge ${entry.result.disposition}`, entry.result.disposition));
    historyList.appendChild(item);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function link(href, label) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}

function money(n) {
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

renderHistory();
