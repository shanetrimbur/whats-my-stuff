/**
 * Telegram interface: send the bot a photo of an item, get the decision card back.
 *
 * Uses long polling, so it runs anywhere — a laptop, a Raspberry Pi, behind
 * NAT — with no public URL. Create a bot with @BotFather, then:
 *
 *   TELEGRAM_BOT_TOKEN=123:abc npm run telegram
 *
 * Uses the same analyzer/demand configuration as the web server
 * (ANALYZER, MOCK_ANALYZE, demand provider keys, etc.).
 */

import { analyzeImage, errorToStatus } from '../lib/analyze.js';
import { getWantsScores } from '../lib/demand/index.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and export the token.');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TOKEN}`;

const DISPOSITION_LABELS = {
  sell: '💰 SELL IT',
  donate: '🎁 DONATE IT',
  recycle: '♻️ RECYCLE IT',
  repurpose: '🔧 REPURPOSE IT',
  trash: '🗑 LET IT GO',
};

async function tg(method, params) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`Telegram ${method} failed: ${body.description}`);
  return body.result;
}

async function downloadPhoto(fileId) {
  const file = await tg('getFile', { file_id: fileId });
  const response = await fetch(`${FILE_API}/${file.file_path}`);
  if (!response.ok) throw new Error(`Photo download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

function money(n) {
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`;
}

function formatCard(result) {
  const lines = [
    `${result.name}`,
    `${result.category} · condition: ${result.condition}`,
    '',
    DISPOSITION_LABELS[result.disposition] ?? result.disposition.toUpperCase(),
  ];
  if (result.est_value_high > 0) {
    lines.push(`Estimated value: ${money(result.est_value_low)}–${money(result.est_value_high)}`);
  }
  if (result.wants?.length) {
    const top = result.wants[0];
    lines.push('', `${top.headline}`);
    if (top.score != null) {
      lines.push(`WANTS ${top.score}/100 (${top.band}) · confidence ${top.grade}`);
    } else {
      lines.push(`WANTS confidence ${top.grade} · ${top.band}`);
    }
    for (const route of result.wants.slice(0, 3)) {
      const net = route.net_proceeds_est != null ? `${money(route.net_proceeds_est)} net` : 'net unknown';
      lines.push(`- ${route.marketplace}: ${net}, ${route.days_to_sale_label}`);
      const sourceUrl = route.sources.find((source) => source.url)?.url;
      if (sourceUrl) lines.push(`  ${sourceUrl}`);
    }
  }
  lines.push('', result.reasoning);

  if (result.disposition === 'sell') {
    lines.push('', '--- Ready-to-post listing ---',
      result.listing.title, '', result.listing.description, '',
      `Asking: ${money(result.listing.suggested_price)}`);
  } else if (result.disposition === 'donate' && result.donation_fmv > 0) {
    lines.push('', `Fair market value for tax records: about ${money(result.donation_fmv)}.`);
  } else if (result.disposition === 'repurpose' && result.repurpose_ideas.length) {
    lines.push('', 'Ideas:', ...result.repurpose_ideas.map((idea) => `• ${idea}`));
  }
  return lines.join('\n');
}

async function handleMessage(message) {
  const chatId = message.chat.id;

  // Largest photo size Telegram provides (they're pre-compressed JPEGs)
  const photo = message.photo?.at(-1)
    ?? (message.document?.mime_type?.startsWith('image/') ? message.document : null);

  if (!photo) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: "Send me a photo of an item and I'll tell you what it is, what it's worth, and whether to sell, donate, recycle, repurpose, or toss it.",
    });
    return;
  }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const base64 = await downloadPhoto(photo.file_id);
    const result = await analyzeImage('image/jpeg', base64);
    result.wants = await getWantsScores(result);
    await tg('sendMessage', { chat_id: chatId, text: formatCard(result) });
  } catch (err) {
    const mapped = errorToStatus(err);
    console.error('analysis failed:', err);
    await tg('sendMessage', {
      chat_id: chatId,
      text: mapped ? `Couldn't analyze that: ${mapped.message}` : "Couldn't analyze that photo — try another angle.",
    });
  }
}

async function poll() {
  let offset = 0;
  const me = await tg('getMe', {});
  console.log(`@${me.username} is listening (long polling). Send it a photo.`);
  for (;;) {
    try {
      const updates = await tg('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) {
          handleMessage(update.message).catch((err) => console.error('handler failed:', err));
        }
      }
    } catch (err) {
      console.error('poll error (retrying in 5s):', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

poll();
