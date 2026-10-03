import twilio from 'twilio';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import MessageLog from '../model/MessageLog.js';
import Lead from '../model/Lead.js';
import Service from '../model/Service.js';
import TwilioNumber from '../model/TwilioNumber.js';
import { buildMessageAccessQuery } from '../utils/messageAccess.js';
import { buildPaginatedResponse, parseBeforeDate, parseLimit } from '../utils/pagination.js';
import { buildPhoneOrFilter, buildPhonePatterns, toStandardE164 } from '../utils/phoneMatch.js';
import { getAssignedNumberForUser } from '../utils/twilioNumbers.js';
import { createTextResponse, getOpenAIModel } from '../services/openaiService.js';
import User from '../model/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const messageUploadsDir = path.join(uploadsRoot, 'messages');
const allowedImageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp']
]);
const maxImageBytes = 5 * 1024 * 1024;
const defaultGreetingReply = 'Hello';
const unknownNumberGreeting = 'Hello! How can I help you find the right parts for your vehicle today?';
const autoReplyCooldownMs = Math.max(0, Number(process.env.AI_AUTO_REPLY_COOLDOWN_MS) || 4000);
const autoReplyEnabled = String(process.env.AI_AUTO_REPLY_ENABLED || process.env.AI_AUTO_REPLY_WHEN_AGENT_OFFLINE || 'true').toLowerCase() !== 'false';
const autoReplyRequireOffline = String(process.env.AI_AUTO_REPLY_REQUIRE_OFFLINE || 'false').toLowerCase() === 'true';

export const isOptOutMessage = (text = '') => {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return false;

  // Standalone TCPA stop keywords
  if (/^(stop|unsubscribe|cancel|end|quit|stopall)$/i.test(clean)) return true;

  // Phrases that indicate conversation context, NOT an opt-out
  if (/\b(stop\s+by|end\s+of|quit\s+looking|cancel\s+(the\s+)?(order|quote|appointment|part|item))\b/i.test(clean)) {
    return false;
  }

  // Explicit opt-out requests
  if (/\b(stop\s+(texting|messaging|sending|contacting|calling)|do\s*not\s*(contact|text|message|call)|don'?t\s*(contact|text|message|call)|unsubscribe\s+me|remove\s+me|take\s+me\s+off(\s+your)?\s+list)\b/i.test(clean)) {
    return true;
  }

  return false;
};

const optOutPattern = { test: (text) => isOptOutMessage(text) };
const discountNegotiationReply = 'How much you would like to pay ?';
const ACK_ONLY_PATTERN = /^(ok|okay|k|kk|sure|yes|yeah|yep|correct|right|alright|thanks|thank you|thank u)\.?$/i;

const isAcknowledgementOnly = (text = '') => ACK_ONLY_PATTERN.test(String(text || '').trim().toLowerCase());

const isOrderConfirmationFollowup = (latestOutbound = '', inbound = '') => (
  /representative will contact you soon for confirming the order/i.test(String(latestOutbound || '')) &&
  isAcknowledgementOnly(inbound)
);

const MODEL_ALIASES = {
  altime: 'altima',
  altma: 'altima',
  ultima: 'altima',
  seqio: 'sequoia',
  sequa: 'sequoia',
  sequo: 'sequoia',
  sequioa: 'sequoia',
  sequoya: 'sequoia',
  sequia: 'sequoia',
};

const tokenizeVehicleText = (text = '') => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const getModelFromToken = (token = '') => {
  const normalized = String(token || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!normalized) return '';
  if (COMMON_MODELS_MAP[normalized]) return normalized;
  if (MODEL_ALIASES[normalized]) return MODEL_ALIASES[normalized];

  let bestModel = '';
  let bestDistance = Infinity;
  for (const modelName of Object.keys(COMMON_MODELS_MAP)) {
    const compactModel = modelName.replace(/[^a-z0-9]/g, '');
    const compactToken = normalized.replace(/[^a-z0-9]/g, '');
    const maxDistance = compactModel.length <= 5 ? 1 : 2;
    if (Math.abs(compactModel.length - compactToken.length) > maxDistance) continue;
    const distance = getEditDistance(compactToken, compactModel);
    if (distance <= maxDistance && distance < bestDistance) {
      bestModel = modelName;
      bestDistance = distance;
    }
  }

  return bestModel;
};

const getModelFromText = (text = '') => {
  const lower = String(text || '').toLowerCase();
  for (const [modelName, modelMake] of Object.entries(COMMON_MODELS_MAP)) {
    if (new RegExp(`\\b${escapeRegex(modelName).replace(/[-]/g, '[- ]?')}\\b`, 'i').test(lower)) {
      return { model: modelName, make: modelMake, corrected: false };
    }
  }

  for (const token of tokenizeVehicleText(lower)) {
    if (VEHICLE_STOP_WORDS.has(token)) continue;
    if (COMMON_MAKES.includes(token)) continue;
    if (/^\d+$/.test(token) || /^\d\.\d\s*l?$/i.test(token)) continue;
    const model = getModelFromToken(token);
    if (model) return { model, make: COMMON_MODELS_MAP[model], corrected: model !== token };
  }

  return { model: '', make: '', corrected: false };
};

const buildVehicleConfirmationQuestion = ({ year = '', make = '', model = '', part = '' } = {}) => {
  const words = [year, make, model, part].filter(Boolean);
  if (words.length < 2) return '';
  return `Did you mean ${words.join(' ')}?`;
};

const getLatestConfirmedVehicleText = (messages = []) => {
  const latestInbound = getLatestInboundMessage(messages);
  if (!isAcknowledgementOnly(latestInbound)) return '';

  const latestOutbound = getLatestOutboundMessage(messages);
  const match = String(latestOutbound || '').match(/^Did you mean\s+(.+?)\?$/i);
  return match ? match[1].trim() : '';
};

const phoneLocks = new Map();

const withPhoneLock = async (phone, fn) => {
  const key = toStandardE164(phone) || String(phone || 'default');
  const prevLock = phoneLocks.get(key) || Promise.resolve();

  let release;
  const currentLock = new Promise((resolve) => {
    release = resolve;
  });
  phoneLocks.set(key, currentLock);

  try {
    await prevLock.catch(() => {});
    return await fn();
  } finally {
    release();
    if (phoneLocks.get(key) === currentLock) {
      phoneLocks.delete(key);
    }
  }
};

const getEditDistance = (left = '', right = '') => {
  const a = String(left || '');
  const b = String(right || '');
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
};

const getSimpleGreetingReply = (text = '') => {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const fillerWords = new Set(['there', 'sir', 'mam', 'maam', 'madam', 'friend', 'team']);
  const words = normalized.split(' ').filter(Boolean);
  const coreWords = words.filter((word) => !fillerWords.has(word));

  if (!coreWords.length || words.length > 5) return null;

  const greetingWords = new Set([
    'hi',
    'hy',
    'hai',
    'hey',
    'hello',
    'helo',
    'heloo',
    'helloo',
    'hlo',
    'hii',
    'hiii',
    'hola',
    'greetings',
    'yo',
  ]);
  const timeGreetingWords = coreWords.filter((word) => !greetingWords.has(word));
  const phraseWords = timeGreetingWords.length ? timeGreetingWords : coreWords;
  const corePhrase = phraseWords.join(' ');
  const compactPhrase = phraseWords.join('');
  const phraseMatches = (phrases) => phrases.some((phrase) => {
    const phraseValue = String(phrase || '').replace(/\s+/g, '');
    if (phrase === corePhrase || phraseValue === compactPhrase) return true;

    const maxDistance = phraseValue.length <= 4 ? 1 : 2;
    const isCloseTypo = Math.abs(phraseValue.length - compactPhrase.length) <= maxDistance
      && getEditDistance(compactPhrase, phraseValue) <= maxDistance;
    const isMissingEnding = compactPhrase.length >= 6
      && phraseValue.startsWith(compactPhrase)
      && phraseValue.length - compactPhrase.length <= 4;

    return isCloseTypo || isMissingEnding;
  });

  if (phraseMatches(['good morning', 'gud morning', 'goodmorning', 'gudmorning', 'gdmorning', 'goodmorn', 'gudmorn', 'gm', 'mrng', 'morn', 'morning'])) {
    return 'Good morning';
  }

  if (phraseMatches(['good afternoon', 'gud afternoon', 'goodafternoon', 'gudafternoon', 'ga', 'afternoon'])) {
    return 'Good afternoon';
  }

  if (phraseMatches(['good evening', 'gud evening', 'goodevening', 'gudevening', 'ge', 'evening'])) {
    return 'Good evening';
  }

  if (phraseMatches(['good night', 'gud night', 'goodnight', 'gudnight', 'gn', 'night'])) {
    return 'Good night';
  }

  if (phraseMatches(['whats up', 'what s up', 'wassup', 'sup'])) {
    return 'Hello';
  }

  return coreWords.length <= 3 && coreWords.every((word) => greetingWords.has(word))
    ? 'Hello'
    : null;
};

const AUTO_PARTS_ASSISTANT_INSTRUCTIONS = `You are the customer support assistant for an auto-parts business. You reply to customer inquiries via SMS like a real, helpful human being.

Core Guidelines:
1. Brevity & Tone: Keep replies short, natural, friendly, and human (1 to 2 short sentences, under 160 characters). Never use robotic greetings, fluff, or emojis.
2. Part Inquiries & Availability:
   - When vehicle details are missing: Ask for the missing fields once in a short generic reply (e.g., "Please share the model and year."). Never guess a model from casual words, and never ask about engine displacement or transmission variants until model and year are known.
   - When a part is in stock and fitment is clear: Reply exactly "Yes, we have it in stock." (or include price if they also asked for price, e.g., "Yes, we have it in stock for $1,250.").
   - When a part is not in stock or not found: Reply exactly "Let me check and update you shortly."
   - When multiple variants match the customer's vehicle (e.g., different engine sizes or transmission types for that specific vehicle): Ask a short, human clarifying question (e.g. "Is yours 1.5L turbo or 2.0L non-turbo? Also automatic or manual?").
3. Common Questions & Typos:
   - Price inquiries (e.g., "price?", "how much?", "/price"): Reply in the format "<Part Title> - $<Price.toFixed(2)>" (e.g., "2019 Honda Civic 2.0L non-turbo CVT Automatic Transmission - $1250.00"). If not in catalog, reply "Let me check and update you shortly."
   - Warranty inquiries: Confirm OEM parts include a standard 30-90 day replacement warranty.
   - Mileage inquiries: Confirm mechanical parts are tested OEM units with verified low mileage.
   - Shipping inquiries: When the customer asks about shipping, first ask "Shipping address?". Once the customer provides their shipping address or zip code, reply "Shipping takes about 7-14 days."
   - Order confirmation / Placing orders: Reply "Our representative will contact you soon for confirming the order."
   - Photo requests: Reply "Our representative will send you the picture of the required part when they are online."
4. Opt-Out Safety: If the customer asks to stop, unsubscribe, cancel, or opt out, return an empty draft ("") with safeToAutoSend: false and intent: "opt_out".`;

export const detectInquiryTopics = (text = '') => {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return [];

  const topics = [];

  // Discount / last price inquiries after a quoted price
  if (
    /\b(last\s*price|final\s*price|best\s*price|lowest\s*price|discount|discounted|less|lower|reduce|negotiate|negotiable|deal|offer|any\s*discount|can\s*you\s*do\s*better|is\s*this\s*your\s*(last|final|best))\b/i.test(raw) ||
    /^\/?(discount|deal|offer|lastprice|bestprice)\b/i.test(raw)
  ) {
    topics.push('discount');
  }

  // Price inquiries: price, prce, cost, quote, how much, how much is, rate, /price, $
  if (
    /\b(price|prce|prices|pricing|cost|costs|costing|how\s*much|quote|quotes|quotation|rate|rates|\$)\b/i.test(raw) ||
    /^\/?(price|prce|cost|quote|pricing|rate)\b/i.test(raw) ||
    /\bprice\s+please\b/i.test(raw)
  ) {
    topics.push('price');
  }

  // Warranty inquiries: warranty, warrany (typo), waranty, warenty, warrenty, warranti, guarantee
  if (
    /\b(warranty|warrany|waranty|warenty|warrenty|warranti|warranties|guarantee|guaranty)\b/i.test(raw) ||
    /^\/?(warranty|warrany|waranty|warenty|warrenty|warranti|guarantee)\b/i.test(raw) ||
    /\bwarran(ty|y)\s+please\b/i.test(raw)
  ) {
    topics.push('warranty');
  }

  // Mileage inquiries: mileage, milage (typo), milleage, millage, miles, mile, odometer
  if (
    /\b(mileage|milage|milleage|millage|miles|mile|odometer|how\s*many\s*miles)\b/i.test(raw) ||
    /^\/?(mileage|milage|milleage|millage|miles|mile)\b/i.test(raw) ||
    /\bmil(e|)(age|es)\s+please\b/i.test(raw)
  ) {
    topics.push('mileage');
  }

  // Shipping inquiries: shipping, ship, delivery, dispatch, eta, transit
  if (
    /\b(shipping|ship|shipped|delivery|deliver|delivered|dispatch|eta|transit|how\s*long\s*(to|does|will)?\s*(ship|take|deliver))\b/i.test(raw) ||
    /^\/?(shipping|delivery|ship)\b/i.test(raw)
  ) {
    topics.push('shipping');
  }

  // Availability & part inquiries: available, in stock, instock, do you have, have it, looking for, or mentioning vehicle parts
  if (
    /\b(available|availability|in\s*stock|instock|do\s*you\s*have|have\s*it|got\s*it|looking\s*for|need|want)\b/i.test(raw) ||
    /\b(transmission|transmition|transmision|tranny|trans|gearbox|engine|motor|engin|alternator|starter|compressor|headlight|taillight|bumper|hood|fender|door|mirror|radiator|axle|strut|shock|transfer\s*case|differential|ecm|ecu|pcm)\b/i.test(raw) ||
    /^\/?(available|stock|part)\b/i.test(raw)
  ) {
    topics.push('availability');
  }

  // Order confirmation / placing order inquiries
  if (
    /\b(confirm(\s*(the|my|this))?\s*order|placing(\s*(the|my|an|this))?\s*order|place(\s*(the|my|an|this))?\s*order|proceed(\s*with)?(\s*(the|my|their|this))?\s*order|ready\s*to\s*order|want\s*to\s*(order|buy|purchase)|order\s*now|book(\s*(the|my|this))?\s*order|take(\s*(the|my|this))?\s*order|i('?m| am|am)\s*placing|i\s*need\s*to\s*confirm|i('?ll| will)?\s*take\s*it|i\s*want\s*to\s*buy|let('?s|\s*us)?\s*proceed)\b/i.test(raw) ||
    /^\/?(order|buy|confirm|purchase)\b/i.test(raw)
  ) {
    topics.push('order');
  }

  // Photo / Picture inquiries
  if (
    /\b(photo|photos|picture|pictures|pic|pics|image|images|img|show\s*me|send\s*(me)?\s*(the|a)?\s*(picture|photo|pic|image)s?)\b/i.test(raw) ||
    /^\/?(photo|photos|picture|pictures|pic|pics|image|images)\b/i.test(raw)
  ) {
    topics.push('photo');
  }

  return [...new Set(topics)];
};

export const getInboundMessagesChronological = (messages = []) => {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const inbounds = messages.filter((m) => m.direction === 'inbound');
  if (!inbounds.length) return [];

  const hasDates = inbounds.some((m) => m.createdAt);
  if (hasDates) {
    return inbounds.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  return inbounds.slice();
};

export const getLatestInboundMessage = (messages = []) => {
  const inbounds = getInboundMessagesChronological(messages);
  return inbounds.length ? (inbounds[inbounds.length - 1]?.body || '') : '';
};

export const getLatestOutboundMessage = (messages = []) => {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const outbounds = messages.filter((m) => m.direction === 'outbound');
  if (!outbounds.length) return '';

  const hasDates = outbounds.some((m) => m.createdAt);
  if (hasDates) {
    return outbounds.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.body || '';
  }

  return outbounds[outbounds.length - 1]?.body || outbounds[0]?.body || '';
};

const looksLikePriceQuote = (text = '') => {
  const value = String(text || '').trim();
  if (!value) return false;

  return /\$\s*\d+(?:,\d{3})*(?:\.\d{2})?\b/.test(value) || /\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(usd|dollars?)\b/i.test(value);
};

export const hasAddressDetails = (text = '') => {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return false;

  if (/\b\d{5}(?:-\d{4})?\b/.test(clean)) return true;
  if (/\b\d+\s+[a-z0-9\s.,]+(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|lane|ln|way|ct|court|hwy|highway|pkwy|parkway|apt|suite|ste|circle|cir|trail|trl)\b/i.test(clean)) {
    return true;
  }
  const stateRegex = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|texas|california|florida|new\s*york|ohio|georgia|illinois|pennsylvania|michigan|arizona|colorado|washington|virginia|carolina)\b/i;
  if (stateRegex.test(clean) && clean.length >= 3) {
    return true;
  }
  if (/\b(p\.?o\.?\s*box)\b/i.test(clean)) return true;

  return false;
};

export const generateDirectAnswer = ({ lead, detectedTopics, partAvailability, recentMessages = [] }) => {
  if (!detectedTopics || detectedTopics.length === 0) return null;

  const latestOutbound = getLatestOutboundMessage(recentMessages);

  if (detectedTopics.includes('discount') && looksLikePriceQuote(latestOutbound)) {
    return discountNegotiationReply;
  }

  // Missing vehicle details, missing year clarification, or variant disambiguation takes highest priority
  if ((partAvailability?.status === 'missing_details' || partAvailability?.status === 'missing_year' || partAvailability?.status === 'confirm_vehicle' || partAvailability?.status === 'ambiguous') && partAvailability?.clarifyingQuestion) {
    return partAvailability.clarifyingQuestion;
  }

  const inStockMatch = partAvailability?.matches?.find(
    (p) => String(p.availability || '').toLowerCase() === 'in stock' && p.price
  ) || partAvailability?.matches?.[0];

  const hasPrice = inStockMatch && typeof inStockMatch.price === 'number' && inStockMatch.price > 0;
  const priceFormatted = hasPrice
    ? (inStockMatch.title ? `${inStockMatch.title} - $${Number(inStockMatch.price).toFixed(2)}` : `$${Number(inStockMatch.price).toFixed(2)}`)
    : null;

  const isPriceOnlyInquiry = detectedTopics.length === 1 && detectedTopics.includes('price');

  if (isPriceOnlyInquiry) {
    return priceFormatted || 'Let me check and update you shortly.';
  }

  const wasAskedAddress = /shipping\s*address\?/i.test(latestOutbound);
  const inbounds = (Array.isArray(recentMessages) ? recentMessages : []).filter((m) => m.direction === 'inbound');
  const allInboundText = inbounds.map((m) => m.body || '').join(' ');
  const latestInbound = getLatestInboundMessage(recentMessages);
  const hasProvidedAddress = Boolean(lead?.zip) || hasAddressDetails(allInboundText) || (wasAskedAddress && hasAddressDetails(latestInbound));

  const isShippingOnlyInquiry = detectedTopics.length === 1 && detectedTopics.includes('shipping');
  if (isShippingOnlyInquiry) {
    return hasProvidedAddress ? 'Shipping takes about 7-14 days.' : 'Shipping address?';
  }

  const parts = [];

  // Availability / Part inquiry answer (human-like)
  if (detectedTopics.includes('availability')) {
    if (partAvailability?.status === 'available') {
      if (detectedTopics.includes('price') && priceFormatted) {
        parts.push(priceFormatted);
      } else {
        parts.push('Yes, we have it in stock.');
      }
    } else {
      parts.push('Let me check and update you shortly.');
    }
  } else if (detectedTopics.includes('price')) {
    if (priceFormatted) {
      parts.push(priceFormatted);
    } else {
      parts.push('Let me check and update you shortly.');
    }
  }

  // Warranty answer
  if (detectedTopics.includes('warranty')) {
    parts.push('All our tested OEM parts include a standard 30-90 day replacement warranty.');
  }

  // Mileage answer
  if (detectedTopics.includes('mileage')) {
    parts.push('Our parts are quality-tested OEM units with verified low mileage.');
  }

  // Shipping answer
  if (detectedTopics.includes('shipping')) {
    if (hasProvidedAddress) {
      parts.push('Shipping takes about 7-14 days.');
    } else {
      parts.push('Shipping address?');
    }
  }

  // Order confirmation / Placing order answer
  if (detectedTopics.includes('order')) {
    parts.push('Our representative will contact you soon for confirming the order.');
  }

  // Photo / Picture answer
  if (detectedTopics.includes('photo')) {
    parts.push('Our representative will send you the picture of the required part when they are online.');
  }

  if (parts.length === 0) return null;

  return parts.join(' ');
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio SMS credentials are not configured');
  }

  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

const getSenderConfig = async (userId) => {
  const assignedNumber = await getAssignedNumberForUser(userId);
  if (assignedNumber) {
    return { from: assignedNumber };
  }

  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    return { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  }

  if (!process.env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio sender number is not configured');
  }

  return { from: process.env.TWILIO_PHONE_NUMBER };
};

const getPublicBaseUrl = () => (process.env.BASE_URL || '').replace(/\/$/, '');

const toPublicMediaUrl = (url) => {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return '';

  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
};

const normalizeMediaUrls = (mediaUrls) => {
  if (!Array.isArray(mediaUrls)) return [];

  return mediaUrls
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, 10);
};

const resolveLeadForMessage = async ({ leadId, phoneNumber }) => {
  if (mongoose.isValidObjectId(leadId)) {
    const lead = await Lead.findById(leadId).select('_id');
    if (lead?._id) return lead._id;
  }

  if (!phoneNumber) return undefined;

  const lead = await Lead.findOne(buildPhoneOrFilter(phoneNumber, ['phone']))
    .select('_id')
    .sort({ updatedAt: -1 });

  return lead?._id;
};

const extractResponseText = (response) => {
  if (typeof response?.output_text === 'string') return response.output_text;

  const parts = response?.output
    ?.flatMap((item) => item.content || [])
    ?.map((content) => content.text || '')
    ?.filter(Boolean);

  if (parts?.length) return parts.join('\n').trim();

  if (response?.choices?.[0]?.message?.content) {
    return response.choices[0].message.content.trim();
  }

  return '';
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value || '').match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const formatLeadForAi = (lead) => ({
  name: lead?.name || '',
  phone: lead?.phone || '',
  email: lead?.email || '',
  zip: lead?.zip || '',
  partRequested: lead?.partRequested || '',
  make: lead?.make || '',
  model: lead?.model || '',
  year: lead?.year || '',
  yearMakeModel: lead?.yearMakeModel || `${lead?.year || ''} ${lead?.make || ''} ${lead?.model || ''}`.trim(),
  disposition: lead?.disposition || '',
  notes: lead?.notes || '',
  followUpAt: lead?.followUpAt || '',
  followUpNote: lead?.followUpNote || '',
  source: lead?.source || '',
});

const formatRecentMessagesForAi = (messages) => messages
  .slice()
  .reverse()
  .map((message) => ({
    direction: message.direction,
    body: message.body || (message.mediaUrls?.length ? '[image message]' : ''),
    status: message.status || '',
    at: message.createdAt,
  }));

const formatPriceForSms = (price, currency = 'USD') => {
  if (typeof price !== 'number') return price ? `${currency} ${price}` : 'Quote required';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(price) ? 0 : 2,
  }).format(price);
};

const formatPartForAi = (item) => {
  const name = item.name || item.title || item.part || 'Service';
  const currency = item.currency || 'USD';

  return {
    title: name,
    name,
    category: item.category || 'Digital Marketing',
    make: item.make || '',
    model: item.model || '',
    year: item.year || '',
    trim: item.trim || '',
    part: name,
    price: item.price,
    priceFormatted: formatPriceForSms(item.price, currency),
    availability: item.status === 'inactive' ? 'out of stock' : 'in stock',
    condition: item.condition || '',
    description: item.description || '',
    deliverables: item.deliverables || [],
  };
};

const hasPhotoRequest = (...values) => {
  const text = values.map((value) => String(value || '')).join(' ').toLowerCase();
  return /\b(photo|photos|picture|pictures|pic|pics|image|images|img|show me|send.*(it|one|them))\b/.test(text);
};

const getSuggestedPartMediaUrls = () => [];

const buildRegexFilter = (field, value, exact = false) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  return {
    [field]: {
      $regex: exact ? `^${escapeRegex(trimmed)}$` : escapeRegex(trimmed),
      $options: 'i',
    },
  };
};

export const PART_KEYWORDS = {
  'transfer case': ['transfer case', 'transfercase', 'transfer-case', 't-case', 't case'],
  transmission: ['transmission', 'transmition', 'transmision', 'tranny', 'trans', 'gearbox'],
  differential: ['differential', 'diff', 'carrier'],
  engine: ['engine', 'motor', 'engin', 'longblock'],
  alternator: ['alternator', 'alternater'],
  starter: ['starter'],
  compressor: ['compressor', 'compresser', 'ac compressor', 'a/c compressor'],
  headlight: ['headlight', 'head light', 'headlamp', 'head lamp'],
  taillight: ['taillight', 'tail light', 'taillamp'],
  bumper: ['bumper', 'front bumper', 'rear bumper'],
  hood: ['hood'],
  fender: ['fender'],
  door: ['door', 'doors'],
  mirror: ['mirror', 'side mirror'],
  radiator: ['radiator'],
  axle: ['axle'],
  strut: ['strut'],
  shock: ['shock', 'shocks'],
};

export const COMMON_MAKES = [
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy', 'chrysler',
  'dodge', 'ford', 'gmc', 'honda', 'hyundai', 'infiniti', 'jeep', 'kia',
  'lexus', 'lincoln', 'mazda', 'mercedes', 'mercedes-benz', 'mercury', 'mini',
  'mitsubishi', 'nissan', 'pontiac', 'porsche', 'ram', 'saab', 'subaru', 'toyota',
  'volkswagen', 'vw', 'volvo'
];

export const COMMON_MODELS_MAP = {
  // Nissan
  altima: 'nissan', maxima: 'nissan', sentra: 'nissan', rogue: 'nissan', pathfinder: 'nissan',
  murano: 'nissan', titan: 'nissan', frontier: 'nissan', versa: 'nissan', armada: 'nissan',
  kicks: 'nissan', quest: 'nissan', juke: 'nissan', xterra: 'nissan',
  // Toyota
  camry: 'toyota', corolla: 'toyota', rav4: 'toyota', highlander: 'toyota', tacoma: 'toyota',
  tundra: 'toyota', '4runner': 'toyota', sienna: 'toyota', prius: 'toyota', sequoia: 'toyota',
  avalon: 'toyota', yaris: 'toyota', venza: 'toyota', matrix: 'toyota',
  // Honda
  civic: 'honda', accord: 'honda', 'cr-v': 'honda', crv: 'honda', pilot: 'honda',
  odyssey: 'honda', fit: 'honda', ridgeline: 'honda', passport: 'honda', hrv: 'honda', 'hr-v': 'honda',
  // Ford
  f150: 'ford', 'f-150': 'ford', f250: 'ford', 'f-250': 'ford', f350: 'ford', 'f-350': 'ford',
  mustang: 'ford', explorer: 'ford', escape: 'ford', edge: 'ford', fusion: 'ford', focus: 'ford',
  taurus: 'ford', ranger: 'ford', expedition: 'ford',
  // Chevy / Chevrolet
  silverado: 'chevy', tahoe: 'chevy', suburban: 'chevy', malibu: 'chevy', impala: 'chevy',
  equinox: 'chevy', colorado: 'chevy', camaro: 'chevy', corvette: 'chevy', cruze: 'chevy', traverse: 'chevy',
  // Jeep
  wrangler: 'jeep', cherokee: 'jeep', 'grand cherokee': 'jeep', compass: 'jeep', renegade: 'jeep', comanche: 'jeep',
  // Dodge / Ram
  charger: 'dodge', challenger: 'dodge', durango: 'dodge', ram: 'ram', colt: 'dodge',
  // Subaru
  outback: 'subaru', forester: 'subaru', impreza: 'subaru', legacy: 'subaru', crosstrek: 'subaru',
  // Volkswagen
  jetta: 'volkswagen', golf: 'volkswagen', passat: 'volkswagen', tiguan: 'volkswagen', atlas: 'volkswagen', beetle: 'volkswagen',
  // GMC
  sierra: 'gmc', yukon: 'gmc', canyon: 'gmc', acadia: 'gmc', terrain: 'gmc', jimmy: 'gmc',
  // Hyundai
  elantra: 'hyundai', sonata: 'hyundai', 'santa fe': 'hyundai', santafe: 'hyundai', tucson: 'hyundai',
  kona: 'hyundai', palisade: 'hyundai', accent: 'hyundai', genesis: 'hyundai', veloster: 'hyundai',
  // Kia
  optima: 'kia', forte: 'kia', sorento: 'kia', sportage: 'kia', telluride: 'kia', soul: 'kia',
  rio: 'kia', sedona: 'kia', carnival: 'kia', stinger: 'kia',
  // Mazda
  'cx-5': 'mazda', cx5: 'mazda', 'cx-9': 'mazda', cx9: 'mazda', 'cx-30': 'mazda', cx30: 'mazda',
  mazda3: 'mazda', mazda6: 'mazda', miata: 'mazda', tribute: 'mazda',
  // BMW
  '328i': 'bmw', '330i': 'bmw', '335i': 'bmw', '528i': 'bmw', '530i': 'bmw', '535i': 'bmw',
  x3: 'bmw', x5: 'bmw', x1: 'bmw', m3: 'bmw', m5: 'bmw',
  // Mercedes-Benz
  c300: 'mercedes', e350: 'mercedes', glc: 'mercedes', gle: 'mercedes', cla: 'mercedes',
  // Audi
  a4: 'audi', a6: 'audi', q5: 'audi', q7: 'audi', a3: 'audi',
  // Lexus
  rx350: 'lexus', es350: 'lexus', is250: 'lexus', is350: 'lexus', gx460: 'lexus',
  // Acura
  mdx: 'acura', rdx: 'acura', tl: 'acura', tsx: 'acura', ilx: 'acura', tlx: 'acura',
  // Infiniti
  g35: 'infiniti', g37: 'infiniti', q50: 'infiniti', q60: 'infiniti', qx60: 'infiniti',
};

const VEHICLE_STOP_WORDS = new Set([
  'for', 'the', 'a', 'an', 'in', 'stock', 'do', 'you', 'have', 'with', 'is', 'to',
  'need', 'as', 'well', 'what', 'about', 'how', 'much', 'it', 'its', 'my', 'car',
  'vehicle', 'truck', 'auto', 'any', 'got', 'looking', 'please', 'thanks', 'thank',
  'can', 'get', 'of', 'and', 'or', 'at', 'on', 'by', 'hey', 'hello', 'hi', 'yes', 'no',
  'mine', 'yours', 'year', 'model', 'make', 'price', 'cost', 'quote', 'check', 'give', 'tell', 'want',
  'good', 'morning', 'afternoon', 'evening', 'night', 'sir', 'mam', 'maam', 'madam', 'there'
]);

export const normalizePartKeyword = (word = '') => {
  const lower = String(word || '').toLowerCase();
  for (const [canonical, aliases] of Object.entries(PART_KEYWORDS)) {
    for (const alias of aliases) {
      const escaped = escapeRegex(alias).replace(/\s+/g, '\\s+');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
        return canonical;
      }
    }
  }
  return null;
};

export const extractVehicleDetails = (lead, recentMessages = []) => {
  const inbounds = getInboundMessagesChronological(recentMessages);
  const latestInbound = inbounds.length ? (inbounds[inbounds.length - 1]?.body || '') : '';
  const latestOutbound = getLatestOutboundMessage(recentMessages);
  if (/shipping\s*address\?/i.test(latestOutbound) && hasAddressDetails(latestInbound)) {
    return {
      make: '',
      model: '',
      year: '',
      partRequested: '',
      inboundText: String(latestInbound || '').toLowerCase(),
      isNewPartAsked: false,
      hasNewVehicleInLatest: false,
      modelWasCorrected: false,
    };
  }
  const confirmedVehicleText = getLatestConfirmedVehicleText(recentMessages);
  const latestTextForVehicle = confirmedVehicleText || latestInbound;
  const latestLower = latestTextForVehicle.toLowerCase();

  // 1. Check if the latest message specifically mentions a new part
  const partInLatest = normalizePartKeyword(latestLower);
  let partRequested = partInLatest || '';

  // 2. Check make in latest message
  let makeInLatest = '';
  for (const m of COMMON_MAKES) {
    if (new RegExp(`\\b${m}\\b`, 'i').test(latestLower)) {
      makeInLatest = m === 'chevy' ? 'chevy' : (m === 'vw' ? 'volkswagen' : m);
      break;
    }
  }

  // 3. Check model in latest message, including common typos
  const latestModelMatch = getModelFromText(latestLower);
  let modelInLatest = latestModelMatch.model;
  let modelWasCorrected = latestModelMatch.corrected;
  if (modelInLatest && !makeInLatest) makeInLatest = latestModelMatch.make;

  // 4. Check year in latest message
  const yMatchLatest = latestLower.match(/\b(19\d\d|20[0-2]\d)\b/);
  const yearInLatest = yMatchLatest ? yMatchLatest[1] : '';

  const hasNewVehicleInLatest = Boolean(makeInLatest || modelInLatest);

  let make = makeInLatest;
  let model = modelInLatest;
  let year = yearInLatest;

  if (!hasNewVehicleInLatest) {
    // Look backwards chronologically across inbounds (newest to oldest)
    for (let i = inbounds.length - 1; i >= 0; i--) {
      const text = (inbounds[i].body || '').toLowerCase();
      if (!partRequested) {
        const p = normalizePartKeyword(text);
        if (p) partRequested = p;
      }
      if (!year) {
        const ym = text.match(/\b(19\d\d|20[0-2]\d)\b/);
        if (ym) year = ym[1];
      }
      if (!model) {
        const modelMatch = getModelFromText(text);
        if (modelMatch.model) {
          model = modelMatch.model;
          if (!make) make = modelMatch.make;
          modelWasCorrected = modelWasCorrected || modelMatch.corrected;
        }
      }
      if (!make) {
        for (const m of COMMON_MAKES) {
          if (new RegExp(`\\b${m}\\b`, 'i').test(text)) {
            make = m === 'chevy' ? 'chevy' : (m === 'vw' ? 'volkswagen' : m);
            break;
          }
        }
      }
    }

    // If model still not found, search clean candidate words in inbounds (newest to oldest)
    if (!model) {
      for (let i = inbounds.length - 1; i >= 0; i--) {
        const text = (inbounds[i].body || '').toLowerCase();
        const words = text
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter(Boolean);

        for (const word of words) {
          if (word.length <= 1) continue;
          if (/^\d+$/.test(word)) continue;
          if (/^\d\.\d\s*l?$/i.test(word)) continue;
          if (word === make || (make === 'chevy' && word === 'chevrolet') || (make === 'volkswagen' && word === 'vw')) continue;
          if (COMMON_MAKES.includes(word)) continue;
          if (VEHICLE_STOP_WORDS.has(word)) continue;
          const isPart = Object.values(PART_KEYWORDS).some((aliases) =>
            aliases.some((alias) => alias.replace(/[^a-z0-9]/g, '') === word)
          );
          if (isPart) continue;
          if (['automatic', 'manual', 'cvt', 'turbo', 'hybrid', 'fwd', 'rwd', 'awd', '4wd', '4x4', 'at', 'mt'].includes(word)) continue;

          model = word;
          break;
        }
        if (model) break;
      }
    }

    if (!partRequested && lead?.partRequested) {
      partRequested = normalizePartKeyword(lead.partRequested) || lead.partRequested;
    }
    if (!year && lead?.year) year = String(lead.year).trim();
    if (!make && lead?.make) make = String(lead.make).trim().toLowerCase();
    if (!model && lead?.model) model = String(lead.model).trim().toLowerCase();
  } else {
    // New vehicle explicitly introduced in latest message
    if (model && !make && COMMON_MODELS_MAP[model]) {
      make = COMMON_MODELS_MAP[model];
    }
    if (!partRequested) {
      for (let i = inbounds.length - 1; i >= 0; i--) {
        const p = normalizePartKeyword(inbounds[i].body || '');
        if (p) {
          partRequested = p;
          break;
        }
      }
    }
    if (!partRequested && lead?.partRequested) {
      partRequested = normalizePartKeyword(lead.partRequested) || lead.partRequested;
    }
  }

  // Model-Make consistency check: if model's known make contradicts make, resolve accurately
  if (model && COMMON_MODELS_MAP[model] && make && COMMON_MODELS_MAP[model] !== make) {
    if (makeInLatest && !modelInLatest) {
      model = '';
    } else if (modelInLatest && !makeInLatest) {
      make = COMMON_MODELS_MAP[model];
    }
  }

  // Determine relevant specs text:
  // If a new vehicle or part was asked in the latest message, only use specs from the latest message.
  // If a follow-up inquiry (e.g., "how much?"), use specs since this part was requested.
  let relevantSpecsText = latestLower;
  if (!partInLatest && !hasNewVehicleInLatest) {
    let partSwitchIndex = -1;
    for (let i = inbounds.length - 1; i >= 0; i--) {
      if (normalizePartKeyword(inbounds[i].body || '') === partRequested) {
        partSwitchIndex = i;
        break;
      }
    }
    if (partSwitchIndex !== -1) {
      relevantSpecsText = inbounds.slice(partSwitchIndex).map((m) => m.body || '').join(' ').toLowerCase();
    } else {
      relevantSpecsText = inbounds.map((m) => m.body || '').join(' ').toLowerCase();
    }
  }

  return {
    make,
    model,
    year,
    partRequested: normalizePartKeyword(partRequested) || partRequested,
    inboundText: relevantSpecsText,
    isNewPartAsked: Boolean(partInLatest),
    hasNewVehicleInLatest,
    modelWasCorrected,
  };
};

const deduplicateEngineSpecs = (rawSpecs) => {
  const list = Array.from(rawSpecs).map((s) => s.trim());
  const filtered = list.filter((item) => (
    !list.some((other) => other !== item && other.toLowerCase().includes(item.toLowerCase()))
  ));
  return Array.from(new Set(filtered));
};

const analyzePartVariants = (matchingTitles = [], userQuery = '') => {
  const queryLower = String(userQuery || '').toLowerCase();
  const rawEngineSpecs = new Set();
  const transSpecs = new Set();
  const driveSpecs = new Set();

  for (const title of matchingTitles) {
    const engineMatch = title.match(/\b(\d\.\d\s*L(?:\s+(?:non-turbo|turbo|turbocharged|w\/o\s*turbo))?)\b/i);
    if (engineMatch) {
      rawEngineSpecs.add(engineMatch[1].trim());
    }

    const hasAuto = /\b(AT|Automatic|CVT|Auto)\b/i.test(title);
    const hasManual = /\b(MT|Manual|\d\s*speed\s*MT)\b/i.test(title);
    if (hasAuto && !hasManual) transSpecs.add('automatic');
    else if (hasManual && !hasAuto) transSpecs.add('manual');

    const is4WD = /\b(4x4|4wd|awd)\b/i.test(title);
    const is2WD = /\b(2wd|fwd|rwd)\b/i.test(title);
    if (is4WD) driveSpecs.add('4WD/AWD');
    if (is2WD) driveSpecs.add('2WD/FWD');
  }

  const engineSpecs = deduplicateEngineSpecs(rawEngineSpecs);
  const questions = [];

  const userHasEngine = /\b(\d\.\d\s*L?|turbo|non-turbo)\b/i.test(queryLower);
  if (engineSpecs.length > 1 && !userHasEngine) {
    const formatted = engineSpecs.map((s) => s.replace(/\bturbo\b/i, 'turbo').replace(/\bnon-turbo\b/i, 'non-turbo'));
    questions.push(`Is yours ${formatted.join(' or ')}?`);
  }

  const userHasAuto = /\b(automatic|auto|at|cvt)\b/i.test(queryLower);
  const userHasManual = /\b(manual|mt|stick|\d\s*speed)\b/i.test(queryLower);
  if (transSpecs.size > 1 && !userHasAuto && !userHasManual) {
    questions.push(questions.length > 0 ? 'Also automatic or manual?' : 'Is yours automatic or manual?');
  }

  if (driveSpecs.size > 1 && questions.length === 0) {
    const userHas4WD = /\b(4x4|4wd|awd)\b/i.test(queryLower);
    const userHas2WD = /\b(2wd|fwd|rwd)\b/i.test(queryLower);
    if (!userHas4WD && !userHas2WD) {
      questions.push('Is yours 2WD or 4WD/AWD?');
    }
  }

  return {
    isAmbiguous: questions.length > 0,
    clarifyingQuestion: questions.join(' '),
  };
};

export const findAvailablePartsForLead = async (lead, recentMessages = []) => {
  const details = extractVehicleDetails(lead, recentMessages);

  if (details.modelWasCorrected && details.hasNewVehicleInLatest) {
    const clarifyingQuestion = buildVehicleConfirmationQuestion({
      year: details.year,
      make: details.make,
      model: details.model,
      part: details.partRequested,
    });
    if (clarifyingQuestion) {
      return {
        status: 'confirm_vehicle',
        reason: 'Customer vehicle model looked misspelled and was corrected.',
        matches: [],
        isAmbiguous: true,
        clarifyingQuestion,
        reply: clarifyingQuestion,
      };
    }
  }

  if (!details.partRequested && (details.year || details.make || details.model)) {
    return {
      status: 'missing_details',
      reason: 'Vehicle was provided without a requested part.',
      matches: [],
      isAmbiguous: true,
      clarifyingQuestion: 'Which part do you need?',
      reply: 'Which part do you need?',
    };
  }

  // If a part is requested, check if essential vehicle details (make, model) are missing
  if (details.partRequested) {
    const missingMake = !details.make;
    const missingModel = !details.model;

    if (missingMake && missingModel) {
      const clarifyingQuestion = 'Please share the year, make, and model.';
      return {
        status: 'missing_details',
        reason: 'Missing vehicle make and model.',
        matches: [],
        isAmbiguous: true,
        clarifyingQuestion,
        reply: clarifyingQuestion,
      };
    }

    if (missingModel && !missingMake) {
      const clarifyingQuestion = 'Please share the model and year.';
      return {
        status: 'missing_details',
        reason: 'Missing vehicle model and year.',
        matches: [],
        isAmbiguous: true,
        clarifyingQuestion,
        reply: clarifyingQuestion,
      };
    }

    if (missingMake && !missingModel) {
      const clarifyingQuestion = 'Please share the make and year.';
      return {
        status: 'missing_details',
        reason: 'Missing vehicle make.',
        matches: [],
        isAmbiguous: true,
        clarifyingQuestion,
        reply: clarifyingQuestion,
      };
    }
  }

  const conditions = [];

  if (details.year) {
    conditions.push({
      $or: [
        { year: String(details.year).trim() },
        { title: { $regex: details.year, $options: 'i' } },
      ],
    });
  }

  if (details.make) {
    const makePattern = details.make === 'chevy' ? '(chevy|chevrolet)' : details.make;
    conditions.push({
      $or: [
        { make: { $regex: `^${makePattern}$`, $options: 'i' } },
        { title: { $regex: makePattern, $options: 'i' } },
      ],
    });
  }

  if (details.model) {
    conditions.push({
      $or: [
        { model: { $regex: `^${escapeRegex(details.model)}$`, $options: 'i' } },
        { title: { $regex: escapeRegex(details.model), $options: 'i' } },
      ],
    });
  }

  if (details.partRequested) {
    const partRoot = details.partRequested === 'transmission'
      ? '(transmission|\\btrans\\b)'
      : escapeRegex(details.partRequested);
    conditions.push({
      $or: [
        { part: { $regex: partRoot, $options: 'i' } },
        { productType: { $regex: partRoot, $options: 'i' } },
        { title: { $regex: partRoot, $options: 'i' } },
      ],
    });
  }

  // Only apply transmission specs if active part is transmission
  if (details.partRequested === 'transmission') {
    if (/\b(automatic|auto|cvt|at)\b/i.test(details.inboundText) && !/\b(manual|mt)\b/i.test(details.inboundText)) {
      conditions.push({ title: { $regex: '(AT|Automatic|CVT)', $options: 'i' } });
    } else if (/\b(manual|mt|stick)\b/i.test(details.inboundText) && !/\b(automatic|auto|cvt)\b/i.test(details.inboundText)) {
      conditions.push({ title: { $regex: '(MT|Manual)', $options: 'i' } });
    }
  }

  // Only apply engine displacement/turbo if part requested is engine or transmission
  if (details.partRequested === 'engine' || details.partRequested === 'transmission') {
    const engineSpecMatch = details.inboundText.match(/\b(\d\.\d\s*L?)\b/i);
    if (engineSpecMatch) {
      conditions.push({ title: { $regex: engineSpecMatch[1].replace(/\s+/g, '\\s*'), $options: 'i' } });
    }
    if (/\bnon-turbo\b/i.test(details.inboundText)) {
      conditions.push({ title: { $regex: 'non-turbo', $options: 'i' } });
    } else if (/\bturbo\b/i.test(details.inboundText)) {
      conditions.push({ title: { $regex: 'turbo', $options: 'i' } });
    }
  }

  const serviceQuery = clean(details.serviceInterestedIn || details.partRequested);
  let matches = [];
  if (serviceQuery) {
    matches = await Service.find({
      $or: [
        { name: { $regex: escapeRegex(serviceQuery), $options: 'i' } },
        { description: { $regex: escapeRegex(serviceQuery), $options: 'i' } },
        { category: { $regex: escapeRegex(serviceQuery), $options: 'i' } },
      ],
      status: 'active',
    })
      .sort({ price: 1 })
      .limit(10)
      .lean();
  }
  if (!matches.length) {
    matches = await Service.find({ status: 'active' })
      .sort({ price: 1 })
      .limit(10)
      .lean();
  }

  if (!matches.length) {
    return {
      status: 'not_found',
      reason: 'No matching service record was found in the catalog.',
      matches: [],
      isAmbiguous: false,
      reply: 'Let me check and update you shortly.',
    };
  }

  const inStockMatches = matches.filter(
    (item) => item.status !== 'inactive'
  );

  if (!inStockMatches.length) {
    return {
      status: 'out_of_stock',
      reason: 'Matching part records were found, but none are currently in stock.',
      matches: matches.map(formatPartForAi),
      isAmbiguous: false,
      reply: 'Let me check and update you shortly.',
    };
  }

  // When year was not specified by customer, but parts exist in stock
  if (!details.year) {
    const distinctYears = [...new Set(inStockMatches.map((m) => {
      if (m.year) return String(m.year).trim();
      const ym = String(m.title || '').match(/\b(19\d\d|20[0-2]\d)\b/);
      return ym ? ym[1] : null;
    }).filter(Boolean))].sort();

    const inbounds = getInboundMessagesChronological(recentMessages);
    const latestInbound = inbounds.length ? (inbounds[inbounds.length - 1]?.body || '') : '';
    const detectedTopics = detectInquiryTopics(details.inboundText || latestInbound);
    const isPriceInquiry = detectedTopics.includes('price');
    const firstMatch = inStockMatches[0];
    const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
    const makeTitle = capitalize(details.make);
    const modelTitle = capitalize(details.model);
    const partTitle = details.partRequested || 'part';

    let clarifyingQuestion = '';
    if (distinctYears.length === 1) {
      const yr = distinctYears[0];
      if (isPriceInquiry && firstMatch.price) {
        clarifyingQuestion = `We have a ${yr} ${makeTitle} ${modelTitle} ${partTitle} in stock for $${Number(firstMatch.price).toLocaleString()}. What year is yours?`;
      } else {
        clarifyingQuestion = `Yes, we have a ${yr} ${makeTitle} ${modelTitle} ${partTitle} in stock. What year is yours?`;
      }
    } else {
      if (isPriceInquiry && firstMatch.price) {
        clarifyingQuestion = `Yes, we have them in stock starting at $${Number(firstMatch.price).toLocaleString()}. What year is your ${modelTitle}?`;
      } else {
        clarifyingQuestion = `Yes, we have it in stock. What year is your ${modelTitle}?`;
      }
    }

    return {
      status: 'missing_year',
      reason: 'In-stock matching part found; clarifying customer vehicle year.',
      matches: inStockMatches.map(formatPartForAi),
      isAmbiguous: true,
      clarifyingQuestion,
      reply: clarifyingQuestion,
    };
  }

  // Check if multiple variants exist that require clarification
  const variantAnalysis = analyzePartVariants(
    inStockMatches.map((m) => m.title || ''),
    details.inboundText
  );

  if (variantAnalysis.isAmbiguous) {
    return {
      status: 'ambiguous',
      reason: 'Multiple matching part variants found in stock.',
      matches: inStockMatches.map(formatPartForAi),
      isAmbiguous: true,
      clarifyingQuestion: variantAnalysis.clarifyingQuestion,
      reply: variantAnalysis.clarifyingQuestion,
    };
  }

  return {
    status: 'available',
    reason: 'Matching in-stock part record found in the catalog.',
    matches: inStockMatches.map(formatPartForAi),
    isAmbiguous: false,
    reply: 'Yes, we have it in stock.',
  };
};

export const generateAiReply = async ({ lead, recentMessages = [], instruction = 'reply_to_latest_message', automatic = false }) => {
  const latestInbound = getLatestInboundMessage(recentMessages);
  const latestOutbound = getLatestOutboundMessage(recentMessages);
  const confirmedVehicleText = getLatestConfirmedVehicleText(recentMessages);
  const wasAskedShippingAddress = /shipping\s*address\?/i.test(latestOutbound);
  const hasShippingAddressReply = wasAskedShippingAddress && hasAddressDetails(latestInbound);
  const isAnsweringVariantQuestion = /\b(Is yours|automatic or manual|2WD|4WD|AWD)\b/i.test(latestOutbound);

  if (isOrderConfirmationFollowup(latestOutbound, latestInbound) || (isAcknowledgementOnly(latestInbound) && !confirmedVehicleText && !hasShippingAddressReply && !isAnsweringVariantQuestion)) {
    return {
      draft: '',
      intent: 'unknown',
      safeToAutoSend: false,
      reason: 'Acknowledgement-only message; no auto-reply needed.',
      partAvailability: { status: 'not_checked', reason: 'Acknowledgement-only message.', matches: [], isAmbiguous: false },
      suggestedMediaUrls: [],
    };
  }

  const textToAnalyze = [instruction !== 'reply_to_latest_message' && instruction !== 'follow_up' ? instruction : '', latestInbound]
    .filter(Boolean)
    .join(' ');
  const detectedTopics = detectInquiryTopics(textToAnalyze || latestInbound || instruction);

  if (wasAskedShippingAddress && hasAddressDetails(latestInbound) && !detectedTopics.includes('shipping')) {
    detectedTopics.push('shipping');
  }

  if (hasShippingAddressReply) {
    return {
      draft: 'Shipping takes about 7-14 days.',
      intent: 'answer_question',
      safeToAutoSend: true,
      reason: 'Shipping address received.',
      partAvailability: { status: 'not_checked', reason: 'Shipping address received.', matches: [], isAmbiguous: false },
      suggestedMediaUrls: [],
    };
  }

  let partAvailability;
  try {
    partAvailability = await findAvailablePartsForLead(lead, recentMessages);
  } catch (partErr) {
    console.warn('findAvailablePartsForLead error:', partErr.message);
    partAvailability = {
      status: 'not_checked',
      reason: 'Part catalog temporarily unavailable.',
      matches: [],
      isAmbiguous: false,
      reply: 'Let me check and update you shortly.',
    };
  }
  const directReply = generateDirectAnswer({ lead, detectedTopics, partAvailability, recentMessages });
  const isDirectPriceOnlyReply = detectedTopics.length === 1
    && detectedTopics.includes('price')
    && Boolean(directReply);

  const isDirectShippingOnlyReply = detectedTopics.length === 1
    && detectedTopics.includes('shipping')
    && Boolean(directReply);

  const isDirectDiscountReply = detectedTopics.includes('discount')
    && directReply === discountNegotiationReply;

  // Return direct answer immediately for missing details, part availability, price, or shipping inquiries (short, human-like)
  const isDirectReplyReady = directReply && (
    partAvailability?.status === 'missing_details' ||
    partAvailability?.status === 'missing_year' ||
    partAvailability?.status === 'confirm_vehicle' ||
    isDirectPriceOnlyReply ||
    isDirectShippingOnlyReply ||
    isDirectDiscountReply ||
    (detectedTopics.includes('availability') && !detectedTopics.some((t) => ['warranty', 'mileage', 'shipping', 'order', 'photo'].includes(t)))
  );

  if (isDirectReplyReady) {
    return {
      draft: directReply,
      intent: (partAvailability?.status === 'missing_details' || partAvailability?.status === 'missing_year' || partAvailability?.status === 'confirm_vehicle') ? 'qualify_lead' : 'answer_question',
      safeToAutoSend: true,
      reason: isDirectDiscountReply ? 'Discount negotiation answer' : (isDirectShippingOnlyReply ? 'Shipping inquiry answer' : (partAvailability.reason || 'Part availability / price answer')),
      partAvailability,
      suggestedMediaUrls: [],
    };
  }

  const suggestedMediaUrls = automatic
    ? []
    : getSuggestedPartMediaUrls({
      partAvailability,
      recentMessages,
      instruction,
    });

  const aiInput = {
    task: automatic
      ? 'Generate one safe SMS reply that may be automatically sent to this CRM lead.'
      : 'Draft one SMS reply for a CRM lead. Do not send it.',
    requestedInstruction: String(instruction || 'follow_up').slice(0, 240),
    detectedCustomerTopics: detectedTopics,
    lead: formatLeadForAi(lead),
    recentMessages: formatRecentMessagesForAi(recentMessages),
    partAvailability,
    rules: [
      'Return JSON only.',
      'Keep replies brief, short, concise, and customer-focused (under 160 characters, typically 1-2 short sentences).',
      'Sound natural, polite, and like a real human being. Avoid robotic greetings or fluff. Do not include emojis.',
      'Vehicle details missing: If the customer asks for a part or part price but vehicle details are missing, ask for the missing fields once in a short generic reply (e.g., "Please share the model and year."). Do not guess a model from casual words, and do not ask variant questions (engine size or transmission) until model and year are known.',
      'Part availability in stock: Reply exactly "Yes, we have it in stock." (or if price requested: "Yes, we have it in stock for <price>.").',
      'Part availability not found or out of stock: Reply exactly "Let me check and update you shortly."',
      'Multiple part variants: If partAvailability.status is ambiguous, ask the clarifying question (e.g., "Is yours 1.5L turbo or 2.0L non-turbo? Also automatic or manual?").',
      'Recognize shorthand, single words, slash commands (/price, /warranty, /mileage), and typos (warrany, waranty, milage, prce) as direct customer questions asking for those details.',
      'Price questions: Reply in the format "<Part Title> - $<Price.toFixed(2)>" (e.g., "2019 Honda Civic 2.0L non-turbo CVT Automatic Transmission - $1250.00"). If not in catalog, reply "Let me check and update you shortly."',
      'Discount / last price questions: If the previous outbound message included a price and the customer asks for last price, final price, best price, lower price, discount, or a better deal, reply exactly "How much you would like to pay ?"',
      'Warranty: If the customer asks about warranty (e.g., "warranty?", "warrany?"), confirm OEM parts include standard 30-90 day replacement warranty.',
      'Mileage: If the customer asks about mileage (e.g., "mileage?", "milage?"), confirm parts are quality-tested OEM units with verified low mileage.',
      'Shipping: Whenever the customer asks about shipping, first ask "Shipping address?". If the customer has already provided or just replied with their shipping address or zip code, reply "Shipping takes about 7-14 days."',
      'Order Confirmation / Placing Order: Reply "Our representative will contact you soon for confirming the order."',
      'Photo / Picture Requests: Reply "Our representative will send you the picture of the required part when they are online."',
      'If the customer asks multiple questions (e.g. price and photos, or warranty and order confirmation), answer each concisely in the same short reply.',
      'Always set safeToAutoSend: true and intent: "answer_question" for valid customer inquiries. Only set safeToAutoSend: false if the customer asked to stop, unsubscribe, or opt out.',
    ],
    responseShape: {
      draft: 'string',
      intent: 'follow_up | answer_question | schedule_callback | qualify_lead | opt_out | unknown',
      safeToAutoSend: 'boolean',
      reason: 'short explanation for the rep',
    },
    suggestedMediaUrls,
  };

  let draft = '';
  let intent = detectedTopics.length ? 'answer_question' : 'unknown';
  let safeToAutoSend = true;
  let reason = partAvailability.reason || 'Auto reply';

  try {
    const response = await createTextResponse({
      instructions: AUTO_PARTS_ASSISTANT_INSTRUCTIONS,
      input: JSON.stringify(aiInput),
    });
    const rawText = extractResponseText(response);
    const parsed = safeJsonParse(rawText);

    if (parsed && typeof parsed === 'object') {
      const candidate = parsed.draft ?? parsed.reply ?? parsed.message ?? parsed.answer ?? parsed.text ?? '';
      draft = String(candidate).trim().slice(0, 1600);
      if (parsed.intent) intent = parsed.intent;
      if (typeof parsed.safeToAutoSend === 'boolean') {
        safeToAutoSend = parsed.safeToAutoSend;
      }
      if (parsed.reason) reason = parsed.reason;
    } else if (rawText && !rawText.trim().startsWith('{') && !rawText.trim().startsWith('[')) {
      draft = rawText.trim().slice(0, 1600);
      intent = 'answer_question';
      safeToAutoSend = true;
    }
  } catch (error) {
    console.error('OpenAI generation error in generateAiReply:', error.message);
  }

  // 1. Fallback to direct catalog answer if OpenAI draft is empty or failed
  if (!draft && detectedTopics.length > 0) {
    const directReply = generateDirectAnswer({ lead, detectedTopics, partAvailability, recentMessages });
    if (directReply) {
      draft = directReply;
      intent = 'answer_question';
      safeToAutoSend = true;
      reason = `Direct answer for ${detectedTopics.join(', ')}`;
    }
  }

  // 2. Fallback to part availability reply if still no draft
  if (!draft && partAvailability?.reply) {
    draft = partAvailability.reply;
    intent = 'answer_question';
    safeToAutoSend = true;
    reason = partAvailability.reason || 'Catalog availability status';
  }

  // 3. Fallback to friendly auto-parts support assistant response so customer is never ignored
  if (!draft && !isOptOutMessage(latestInbound)) {
    draft = 'Hello! Let me check on that and update you shortly. Could you please share your vehicle year, make, and model?';
    intent = 'answer_question';
    safeToAutoSend = true;
    reason = 'General auto-parts assistant fallback';
  }

  // Safety check: if draft contains opt-out text or intent is opt_out
  const isOptOut = isOptOutMessage(draft) || intent === 'opt_out' || (latestInbound && isOptOutMessage(latestInbound));
  if (isOptOut) {
    draft = '';
    safeToAutoSend = false;
    intent = 'opt_out';
  }

  return {
    draft,
    intent,
    safeToAutoSend,
    reason,
    partAvailability,
    suggestedMediaUrls,
  };
};

const isUserOnline = async (io, userId) => {
  if (!io || !userId) return false;
  const sockets = await io.in(String(userId)).fetchSockets();
  return sockets.some((socket) => String(socket.data.userId) === String(userId));
};

const sendSimpleGreetingReply = async ({ lead, from, to, userId, reply = defaultGreetingReply, senderType = 'ai' }) => {
  const twilioMessage = await getTwilioClient().messages.create({
    from: to,
    to: from,
    body: reply,
    ...(getPublicBaseUrl() ? { statusCallback: `${getPublicBaseUrl()}/api/messages/status` } : {}),
  });

  await MessageLog.create({
    ...(lead?._id ? { lead: lead._id } : {}),
    ...(userId ? { user: userId } : {}),
    phoneNumber: from,
    from: to,
    to: from,
    body: reply,
    direction: 'outbound',
    senderType,
    status: twilioMessage.status,
    messageSid: twilioMessage.sid,
  });
};

const sendOfflineAgentAiReply = async ({ io, lead, from, to, inboundMessage, fallbackUserId }) => {
  if (!autoReplyEnabled
    || !String(inboundMessage?.body || '').trim()
    || inboundMessage?.mediaUrls?.length
    || isOptOutMessage(inboundMessage?.body || '')) return;

  const assignedUserId = lead?.assignedTo?._id || lead?.assignedTo || fallbackUserId;
  if (assignedUserId) {
    const assignedUser = await User.findById(assignedUserId).select('isAiAutoReplyActive');
    if (assignedUser && assignedUser.isAiAutoReplyActive === false) return;

    if (autoReplyRequireOffline && (await isUserOnline(io, assignedUserId))) return;
  }

  const filterConditions = [{ phoneNumber: from }];
  if (lead?._id) {
    filterConditions.push({ lead: lead._id });
  }

  // Never drop a new customer inquiry because of previous replies:
  // Check if an outbound reply has ALREADY been sent in response to this or a newer message
  const lastOutbound = await MessageLog.findOne({
    $or: filterConditions,
    direction: 'outbound',
  }).sort({ createdAt: -1, _id: -1 }).select('createdAt').lean();

  if (lastOutbound && inboundMessage?.createdAt && new Date(lastOutbound.createdAt) >= new Date(inboundMessage.createdAt)) {
    return;
  }

  // Debounce rapid bursts from the customer (e.g. 2 rapid SMS in 1 second)
  const debounceWindow = Math.min(autoReplyCooldownMs, 4000);
  if (lastOutbound && debounceWindow > 0) {
    const elapsed = Date.now() - new Date(lastOutbound.createdAt).getTime();
    if (elapsed < debounceWindow) {
      await new Promise((r) => setTimeout(r, debounceWindow - elapsed));
      const freshOutbound = await MessageLog.findOne({
        $or: filterConditions,
        direction: 'outbound',
      }).sort({ createdAt: -1, _id: -1 }).select('createdAt').lean();
      if (freshOutbound && inboundMessage?.createdAt && new Date(freshOutbound.createdAt) >= new Date(inboundMessage.createdAt)) {
        return;
      }
    }
  }

  const messageQuery = lead?._id
    ? { lead: lead._id }
    : buildPhoneOrFilter(from, ['phoneNumber', 'from', 'to']);

  const recentMessages = await MessageLog.find(messageQuery)
    .sort({ createdAt: -1, _id: -1 })
    .limit(12)
    .lean();

  const aiReply = await generateAiReply({ lead, recentMessages, automatic: true });
  if (!aiReply.draft || !aiReply.safeToAutoSend || aiReply.intent === 'opt_out' || isOptOutMessage(aiReply.draft)) return;

  // If strict offline-only mode is active, check if the agent opened the CRM
  if (autoReplyRequireOffline && assignedUserId && (await isUserOnline(io, assignedUserId))) return;

  const twilioMessage = await getTwilioClient().messages.create({
    from: to,
    to: from,
    body: aiReply.draft,
    ...(getPublicBaseUrl() ? { statusCallback: `${getPublicBaseUrl()}/api/messages/status` } : {}),
  });

  const replyLog = await MessageLog.create({
    ...(lead?._id ? { lead: lead._id } : {}),
    ...(assignedUserId ? { user: assignedUserId } : {}),
    phoneNumber: from,
    from: to,
    to: from,
    body: aiReply.draft,
    mediaUrls: aiReply.suggestedMediaUrls,
    direction: 'outbound',
    senderType: 'ai',
    status: twilioMessage.status,
    messageSid: twilioMessage.sid,
  });

  if (assignedUserId) {
    io?.to(String(assignedUserId)).emit('ai-message-sent', {
      lead: lead?._id ? String(lead._id) : null,
      message: replyLog,
      reason: aiReply.reason,
    });
  }
};

export const uploadMessageImage = async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const extension = allowedImageTypes.get(contentType);
    const baseUrl = getPublicBaseUrl();

    if (!extension) {
      return res.status(400).json({ message: 'Upload a JPG, PNG, GIF, or WebP image.' });
    }

    if (!baseUrl) {
      return res.status(500).json({ message: 'BASE_URL is required before image messages can be sent.' });
    }

    if (!req.body?.length) {
      return res.status(400).json({ message: 'Image file is required.' });
    }

    if (req.body.length > maxImageBytes) {
      return res.status(400).json({ message: 'Image must be 5MB or smaller.' });
    }

    await fs.mkdir(messageUploadsDir, { recursive: true });

    const fileName = `${Date.now()}-${req.user.id}-${Math.random().toString(36).slice(2)}.${extension}`;
    const filePath = path.join(messageUploadsDir, fileName);
    await fs.writeFile(filePath, req.body);

    res.status(201).json({
      mediaUrl: `${baseUrl}/uploads/messages/${fileName}`
    });
  } catch (error) {
    console.error('Upload Message Image Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { to, body, leadId } = req.body;
    const normalizedTo = toStandardE164(to);
    const trimmedBody = String(body || '').trim();
    const mediaUrls = normalizeMediaUrls(req.body.mediaUrls);

    if (!normalizedTo || normalizedTo.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ message: 'A valid recipient phone number is required' });
    }

    if (!trimmedBody && mediaUrls.length === 0) {
      return res.status(400).json({ message: 'Message body or image is required' });
    }

    if (trimmedBody.length > 1600) {
      return res.status(400).json({ message: 'Message body cannot exceed 1600 characters' });
    }

    const client = getTwilioClient();
    const senderConfig = await getSenderConfig(req.user.id);
    const baseUrl = getPublicBaseUrl();
    const linkedLeadId = await resolveLeadForMessage({ leadId, phoneNumber: normalizedTo });

    const twilioMessage = await client.messages.create({
      ...senderConfig,
      to: normalizedTo,
      ...(trimmedBody ? { body: trimmedBody } : {}),
      ...(mediaUrls.length > 0 ? { mediaUrl: mediaUrls } : {}),
      ...(baseUrl ? { statusCallback: `${baseUrl}/api/messages/status` } : {})
    });

    const sender = senderConfig.from || process.env.TWILIO_MESSAGING_SERVICE_SID;
    const messageLog = await MessageLog.create({
      ...(linkedLeadId ? { lead: linkedLeadId } : {}),
      user: req.user.id,
      phoneNumber: normalizedTo,
      from: sender,
      to: normalizedTo,
      body: trimmedBody,
      mediaUrls,
      direction: 'outbound',
      status: twilioMessage.status,
      messageSid: twilioMessage.sid
    });

    const messageLogObj = messageLog.toObject();
    messageLogObj.userName = req.user.name || '';
    messageLogObj.user = {
      _id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    };

    res.status(201).json({ message: 'Message sent', messageLog: messageLogObj });
  } catch (error) {
    console.error('Send Message Error:', error);
    res.status(500).json({
      message: error.message,
      code: error.code
    });
  }
};

export const updateMessageStatus = async (req, res) => {
  try {
    console.log('Twilio message status webhook body:', req.body);

    const messageSid = req.body.MessageSid || req.body.SmsSid;
    const status = req.body.MessageStatus || req.body.SmsStatus;

    if (!messageSid || !status) {
      return res.status(400).json({ message: 'MessageSid and status are required' });
    }

    const update = {
      status,
      errorCode: req.body.ErrorCode || '',
      errorMessage: req.body.ErrorMessage || ''
    };

    if (status === 'delivered') {
      update.deliveredAt = new Date();
    }

    const messageLog = await MessageLog.findOneAndUpdate(
      { messageSid },
      update,
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('message-status-updated', {
        messageSid,
        status,
        errorCode: update.errorCode,
        deliveredAt: messageLog?.deliveredAt
      });
    }

    res.sendStatus(204);
  } catch (error) {
    console.error('Message Status Error:', error);
    res.status(500).json({ message: error.message });
  }
};

const formatMessage = (message) => {
  const item = message.toObject ? message.toObject() : message;
  const assignee = item.lead?.assignedTo || null;
  const assigneeName = assignee?.name || assignee?.email || '';
  const userName = item.user?.name || item.user?.email || assigneeName || '';

  return {
    ...item,
    userName,
    assigneeName,
    senderType: item.senderType || (item.user ? 'human' : 'system'),
    assignedTo: assignee ? {
      _id: assignee._id,
      name: assignee.name,
      email: assignee.email,
      role: assignee.role
    } : null
  };
};

export const getMessages = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const before = parseBeforeDate(req.query.before);
    const phoneNumber = String(req.query.phoneNumber || '').trim();
    const accessQuery = await buildMessageAccessQuery(req.user);
    const filters = [];

    if (phoneNumber) {
      filters.push(buildPhoneOrFilter(phoneNumber, ['phoneNumber', 'from', 'to']));
    }

    if (Object.keys(accessQuery).length > 0) {
      filters.push(accessQuery);
    }

    const query = filters.length > 1
      ? { $and: filters }
      : (filters[0] || {});

    if (before) {
      query.createdAt = { $lt: before };
    }

    const messages = await MessageLog.find(query)
      .populate('user', 'name email role')
      .populate({
        path: 'lead',
        select: 'name email phone assignedTo disposition',
        populate: { path: 'assignedTo', select: 'name email role' }
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const page = buildPaginatedResponse(
      messages.map(formatMessage),
      limit,
      (message) => new Date(message.createdAt || 0).toISOString()
    );

    res.json(page);
  } catch (error) {
    console.error('Get Messages Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getMessageThreads = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const before = parseBeforeDate(req.query.before);
    const accessQuery = await buildMessageAccessQuery(req.user);
    const pipeline = [];

    if (Object.keys(accessQuery).length > 0) {
      pipeline.push({ $match: accessQuery });
    }

    pipeline.push(
      {
        $addFields: {
          threadPhone: {
            $cond: [
              { $eq: ['$direction', 'outbound'] },
              { $ifNull: ['$to', '$phoneNumber'] },
              { $ifNull: ['$from', '$phoneNumber'] }
            ]
          }
        }
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$threadPhone',
          latestMessage: { $first: '$$ROOT' },
          latestCreatedAt: { $first: '$createdAt' }
        }
      },
      { $sort: { latestCreatedAt: -1, _id: -1 } }
    );

    if (before) {
      pipeline.push({ $match: { latestCreatedAt: { $lt: before } } });
    }

    pipeline.push({ $limit: (limit * 2) + 1 });

    const groupedThreads = await MessageLog.aggregate(pipeline);

    // Merge any duplicate thread variants in JS using toStandardE164
    const threadMap = new Map();
    for (const thread of groupedThreads) {
      const canonicalPhone = toStandardE164(thread._id);
      const existing = threadMap.get(canonicalPhone);
      if (!existing || new Date(thread.latestCreatedAt) > new Date(existing.latestCreatedAt)) {
        threadMap.set(canonicalPhone, {
          ...thread,
          canonicalPhone
        });
      }
    }

    const mergedThreads = Array.from(threadMap.values())
      .sort((a, b) => new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt))
      .slice(0, limit + 1);

    // Populate user if present in latestMessage
    const userIds = mergedThreads
      .map((t) => t.latestMessage?.user)
      .filter((id) => mongoose.isValidObjectId(id));
    const users = userIds.length > 0
      ? await mongoose.model('User').find({ _id: { $in: userIds } }).select('name email role').lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    // Batch resolve leads for all thread phones
    const threadPhones = mergedThreads.map((t) => t.canonicalPhone).filter(Boolean);
    const directLeadIds = mergedThreads
      .map((t) => t.latestMessage?.lead)
      .filter((id) => mongoose.isValidObjectId(id));
    const allPhonePatterns = threadPhones.flatMap((p) => buildPhonePatterns(p));

    const leads = await Lead.find({
      $or: [
        ...(directLeadIds.length > 0 ? [{ _id: { $in: directLeadIds } }] : []),
        ...(allPhonePatterns.length > 0 ? [{ phone: { $in: allPhonePatterns } }] : [])
      ]
    })
      .select('_id name email phone disposition assignedTo')
      .populate('assignedTo', 'name email role')
      .lean();

    const leadById = new Map(leads.map((l) => [String(l._id), l]));
    const leadByPhone = new Map();
    for (const lead of leads) {
      for (const pattern of buildPhonePatterns(lead.phone)) {
        leadByPhone.set(pattern, lead);
      }
    }

    const page = buildPaginatedResponse(
      mergedThreads.map((thread) => {
        const rawMessage = thread.latestMessage;
        const user = rawMessage?.user ? userMap.get(String(rawMessage.user)) : null;

        const resolvedLead = (rawMessage?.lead && leadById.get(String(rawMessage.lead)))
          || leadByPhone.get(thread.canonicalPhone)
          || null;

        const assignee = resolvedLead?.assignedTo || null;
        const assigneeName = assignee?.name || assignee?.email || '';
        const userName = user?.name || user?.email || assigneeName || '';

        const formattedMsg = {
          ...rawMessage,
          userName,
          assigneeName,
          assignedTo: assignee ? {
            _id: assignee._id,
            name: assignee.name,
            email: assignee.email,
            role: assignee.role
          } : null
        };

        return {
          ...formattedMsg,
          phoneNumber: thread.canonicalPhone,
          threadKey: thread.canonicalPhone,
          lead: resolvedLead ? resolvedLead._id : rawMessage?.lead,
          leadName: resolvedLead?.name || '',
          leadEmail: resolvedLead?.email || '',
          leadDisposition: resolvedLead?.disposition || ''
        };
      }),
      limit,
      (thread) => new Date(thread.createdAt || 0).toISOString()
    );

    res.json(page);
  } catch (error) {
    console.error('Get Message Threads Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const draftLeadMessage = async (req, res) => {
  try {
    const { leadId, phoneNumber, instruction } = req.body;
    const trimmedPhoneNumber = toStandardE164(phoneNumber);
    const linkedLeadId = await resolveLeadForMessage({ leadId, phoneNumber: trimmedPhoneNumber });

    if (!linkedLeadId && !trimmedPhoneNumber) {
      return res.status(400).json({ message: 'leadId or phoneNumber is required' });
    }

    const lead = linkedLeadId
      ? await Lead.findById(linkedLeadId)
        .populate('assignedTo', 'name email role')
        .lean()
      : null;

    const accessQuery = await buildMessageAccessQuery(req.user);
    const filters = [];

    if (linkedLeadId) {
      filters.push({ lead: linkedLeadId });
    }

    if (trimmedPhoneNumber || lead?.phone) {
      filters.push(buildPhoneOrFilter(trimmedPhoneNumber || lead.phone, ['phoneNumber', 'from', 'to']));
    }

    if (Object.keys(accessQuery).length > 0) {
      filters.push(accessQuery);
    }

    const messageQuery = filters.length > 1
      ? { $and: filters }
      : (filters[0] || {});

    const recentMessages = await MessageLog.find(messageQuery)
      .sort({ createdAt: -1, _id: -1 })
      .limit(12)
      .lean();

    const aiResult = await generateAiReply({
      lead,
      recentMessages,
      instruction: instruction || 'follow_up',
      automatic: false,
    });

    res.json({
      draft: aiResult.draft,
      intent: aiResult.intent,
      requiresApproval: true,
      reason: aiResult.reason,
      partAvailability: aiResult.partAvailability,
      suggestedMediaUrls: aiResult.suggestedMediaUrls,
      model: getOpenAIModel(),
      leadId: linkedLeadId || null,
    });
  } catch (error) {
    console.error('Draft Lead Message Error:', error);
    res.status(500).json({ message: error.message || 'Failed to draft message' });
  }
};

export const receiveMessage = async (req, res) => {
  try {
    const rawFrom = req.body.From || 'Unknown';
    const from = toStandardE164(rawFrom);
    const rawTo = req.body.To || process.env.TWILIO_PHONE_NUMBER || 'Unknown';
    const to = toStandardE164(rawTo);
    const body = req.body.Body || '';
    const messageSid = req.body.MessageSid || req.body.SmsSid || '';
    const mediaCount = Number(req.body.NumMedia) || 0;
    const mediaUrls = Array.from({ length: mediaCount }, (_, index) => req.body[`MediaUrl${index}`])
      .filter(Boolean);

    // Twilio can retry a webhook; never create or auto-reply to the same inbound SMS twice.
    if (messageSid && await MessageLog.exists({ messageSid, direction: 'inbound' })) {
      const twiml = new twilio.twiml.MessagingResponse();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    const assignedNumber = await TwilioNumber.findOne({
      $or: [{ phoneNumber: to }, { phoneNumber: rawTo }]
    });
    const assignedUserIds = (assignedNumber?.assignedUsers || []).map((userId) => String(userId));
    const linkedLeadId = await resolveLeadForMessage({ phoneNumber: from });
    const lead = linkedLeadId
      ? await Lead.findById(linkedLeadId).select('assignedTo name phone email companyName serviceInterestedIn industry businessType websiteUrl disposition lostReason notes followUpAt followUpNote source').lean()
      : null;

    const fallbackUserId = lead?.assignedTo || assignedUserIds[0] || undefined;

    const messageLog = await MessageLog.create({
      ...(linkedLeadId ? { lead: linkedLeadId } : {}),
      user: fallbackUserId,
      phoneNumber: from,
      from,
      to,
      body,
      mediaUrls,
      direction: 'inbound',
      status: req.body.SmsStatus || 'received',
      messageSid
    });

    const leadAssigneeId = lead?.assignedTo ? String(lead.assignedTo._id || lead.assignedTo) : null;
    const recipientUserIds = [...new Set([
      ...assignedUserIds,
      ...(leadAssigneeId ? [leadAssigneeId] : [])
    ])];

    const io = req.app.get('io');
    if (io) {
      io.emit('incoming-message', {
        from,
        to,
        body,
        mediaUrls,
        messageSid,
        lead: messageLog.lead,
        assignedTo: recipientUserIds,
        createdAt: messageLog.createdAt
      });
    }

    // Respond to Twilio immediately so webhook never times out or triggers retries
    const twiml = new twilio.twiml.MessagingResponse();
    res.type('text/xml');
    res.send(twiml.toString());

    // Process AI auto-reply asynchronously in background with per-phone serialization lock
    setImmediate(async () => {
      try {
        await withPhoneLock(from, async () => {
          const detectedTopics = detectInquiryTopics(body);
          const simpleGreetingReply = getSimpleGreetingReply(body);

          // Check if customer is replying to a shipping address inquiry
          const lastOutboundMsg = await MessageLog.findOne({
            ...(linkedLeadId ? { lead: linkedLeadId } : { phoneNumber: from }),
            direction: 'outbound',
          }).sort({ createdAt: -1, _id: -1 }).select('body').lean();
          const isReplyingToShippingAddress = /shipping\s*address\?/i.test(lastOutboundMsg?.body || '');
          if (isReplyingToShippingAddress && hasAddressDetails(body) && !detectedTopics.includes('shipping')) {
            detectedTopics.push('shipping');
          }

          // Auto-save 5-digit zip code to lead if found
          const zipMatch = body.match(/\b\d{5}\b/);
          if (zipMatch && linkedLeadId && !lead?.zip) {
            try {
              await Lead.findByIdAndUpdate(linkedLeadId, { zip: zipMatch[0] });
              if (lead) lead.zip = zipMatch[0];
            } catch (zipErr) {
              console.warn('Failed to update lead zip:', zipErr.message);
            }
          }

          // Update lead.partRequested if customer asks for a new part
          const newPartInInbound = normalizePartKeyword(body);
          if (newPartInInbound && linkedLeadId && lead && lead.partRequested !== newPartInInbound) {
            try {
              await Lead.findByIdAndUpdate(linkedLeadId, { partRequested: newPartInInbound });
              lead.partRequested = newPartInInbound;
              if (io) {
                io.emit('lead-updated', {
                  leadId: String(linkedLeadId),
                  partRequested: newPartInInbound,
                });
              }
            } catch (partErr) {
              console.warn('Failed to update lead partRequested:', partErr.message);
            }
          }

          // Auto-save vehicle details (year, make, model) to lead if newly identified
          if (linkedLeadId && lead && !(isReplyingToShippingAddress && hasAddressDetails(body))) {
            const vehicleDetails = extractVehicleDetails(lead, [messageLog]);
            const updates = {};
            if (vehicleDetails.hasNewVehicleInLatest) {
              if (vehicleDetails.make) updates.make = vehicleDetails.make;
              if (vehicleDetails.model) updates.model = vehicleDetails.model;
              updates.year = vehicleDetails.year || '';
            } else {
              if (vehicleDetails.make && !lead.make) updates.make = vehicleDetails.make;
              if (vehicleDetails.model && !lead.model) updates.model = vehicleDetails.model;
              if (vehicleDetails.year && !lead.year) updates.year = vehicleDetails.year;
            }
            if (Object.keys(updates).length > 0) {
              try {
                const updatedYear = updates.year !== undefined ? updates.year : (lead.year || '');
                const updatedMake = updates.make || lead.make || '';
                const updatedModel = updates.model || lead.model || '';
                updates.yearMakeModel = `${updatedYear} ${updatedMake} ${updatedModel}`.trim();
                await Lead.findByIdAndUpdate(linkedLeadId, updates);
                Object.assign(lead, updates);
                if (io) {
                  io.emit('lead-updated', {
                    leadId: String(linkedLeadId),
                    ...updates,
                  });
                }
              } catch (vehErr) {
                console.warn('Failed to update lead vehicle details:', vehErr.message);
              }
            }
          }

          if (simpleGreetingReply) {
            const newerInbound = await MessageLog.findOne({
              ...(linkedLeadId ? { lead: linkedLeadId } : { phoneNumber: from }),
              direction: 'inbound',
              createdAt: { $gt: messageLog.createdAt },
            }).select('_id body').lean();

            if (newerInbound && detectInquiryTopics(newerInbound.body).length > 0) {
              return;
            }

            await sendSimpleGreetingReply({
              lead,
              from,
              to,
              userId: fallbackUserId,
              reply: simpleGreetingReply,
            });
            return;
          }

          // Update lead disposition to 'Ordered' if customer is placing/confirming an order
          if (linkedLeadId && detectedTopics.includes('order') && lead?.disposition !== 'Ordered') {
            try {
              await Lead.findByIdAndUpdate(linkedLeadId, { disposition: 'Ordered' });
              if (io) {
                io.emit('lead-updated', {
                  leadId: String(linkedLeadId),
                  disposition: 'Ordered',
                });
              }
            } catch (leadUpdateErr) {
              console.warn('Failed to update lead disposition to Ordered:', leadUpdateErr.message);
            }
          }

          // Trigger AI reply for all customer inquiries (both existing leads and new contacts)
          await sendOfflineAgentAiReply({
            io,
            lead,
            from,
            to,
            inboundMessage: messageLog,
            fallbackUserId: assignedUserIds[0] || fallbackUserId || undefined,
          });
        });
      } catch (aiError) {
        console.error('Background Inbound AI Reply Error:', aiError);
      }
    });
  } catch (error) {
    console.error('Receive Message Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

