import fs from 'node:fs/promises';
import path from 'node:path';

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value) {
  return decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseViews(raw) {
  const normalized = String(raw ?? '').replace(/,/g, '').trim().toUpperCase();
  if (!normalized) return 0;
  if (normalized.endsWith('K')) return Math.round(Number.parseFloat(normalized.slice(0, -1)) * 1000);
  if (normalized.endsWith('M')) return Math.round(Number.parseFloat(normalized.slice(0, -1)) * 1000000);
  return Number.parseInt(normalized, 10) || 0;
}

export function parseTelegramPublicMessages(html, channel) {
  const messages = [];
  const messagePattern = /<div class="tgme_widget_message[^"]*js-widget_message"[^>]*data-post="([^"/]+)\/(\d+)"[\s\S]*?<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<span class="tgme_widget_message_views">([^<]*)<\/span>[\s\S]*?<a class="tgme_widget_message_date" href="([^"]+)">[\s\S]*?<time datetime="([^"]+)"/giu;

  for (const match of html.matchAll(messagePattern)) {
    const [, handle, postId, textHtml, viewsRaw, url, publishedAt] = match;
    messages.push({
      channel: channel || handle,
      postId,
      text: stripHtml(textHtml),
      url,
      views: parseViews(viewsRaw),
      publishedAt
    });
  }

  return messages;
}

function normalizeCompanyName(token) {
  return cleanText(token)
    .replace(/[,'"“”‘’\[\]]/gu, '')
    .replace(/^(주식회사|㈜)/u, '')
    .replace(/(은|는|이|가|도)$/u, '')
    .trim();
}

function extractTelegramCompanyName(text) {
  const patterns = [
    /\[?([A-Za-z0-9가-힣&]+)\((\d{4,6})(?:,[A-Z]{2})?\)/u,
    /^([A-Za-z0-9가-힣&]+)\s+(?:골드만|제이피모건|JP모건|씨티|유진투자증권|메리츠|신한투자증권|하나증권|한국투자증권)/u,
    /^([A-Za-z0-9가-힣&]+)\s+(?:급등|강세|반등|상한가|하락|약세)/u
  ];

  for (const pattern of patterns) {
    const matched = text.match(pattern);
    const companyName = normalizeCompanyName(matched?.[1] ?? '');
    if (companyName && companyName.length >= 2) return companyName;
  }

  return null;
}

function buildTelegramHeadline(text, companyName) {
  const normalized = cleanText(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((\d{4,6})(?:,[A-Z]{2})?\)/g, ' ')
    .replace(/\s*\/\s*[^-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const remainder = normalized
    .replace(new RegExp(`^${companyName}\\s*`), '')
    .replace(/^(?:급등세 지속,?\s*|급등,?\s*|강세,?\s*|반등 시도,?\s*)/u, '')
    .replace(/^(?:(?:제이피모건|골드만|씨티)\s*|투자의견:\s*)+/u, '')
    .trim();

  const concise = remainder
    .split(/\s(?:☞|🔑|📋|🤖|💰|📈|🏦|🛡|⚠️|🔔|🌏)\s| \| | 1\.\s/u)[0]
    .trim();

  return cleanText(`${companyName} ${concise}`.trim());
}

export function messagesToTelegramNewsCandidates(messages) {
  return messages.flatMap((message) => {
    const text = cleanText(message.text);
    if (!text || /^https?:\/\//iu.test(text)) return [];

    const companyName = extractTelegramCompanyName(text);
    if (!companyName) return [];

    return [{
      companyName,
      title: buildTelegramHeadline(text, companyName),
      summary: `Telegram @${message.channel} 공개 채널 멘션`,
      source: `Telegram @${message.channel}`,
      sourceUrl: message.url,
      publishedAt: message.publishedAt
    }];
  });
}

export async function fetchTelegramPublicMessages(channel, options = {}) {
  const fixtureDir = options.fixtureDir;
  if (fixtureDir) {
    const html = await fs.readFile(path.join(fixtureDir, `${channel}.html`), 'utf8');
    return parseTelegramPublicMessages(html, channel);
  }

  const response = await fetch(`https://t.me/s/${channel}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; HermesRealtimeSurgeBot/1.0)'
    }
  });

  if (!response.ok) {
    throw new Error(`telegram_public_fetch_failed:${channel}:${response.status}`);
  }

  const html = await response.text();
  return parseTelegramPublicMessages(html, channel);
}
