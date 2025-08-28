import express from 'express';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { createLogger, transports, format } from 'winston';
import https from 'https';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import http from 'http';

dotenv.config();

const cache = new NodeCache({ stdTTL: 10 });

const config = {
  port: process.env.PORT || 2208,
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'error',
    file: process.env.LOG_FILE || 'proxy.log',
  },
};

const logger = createLogger({
  level: config?.logging.level,
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.File({ filename: config?.logging.file })],
});

const app = express();

// Middleware for JSON & raw body
app?.use(express.json({ limit: '20mb' }));
app?.use(express.text({ type: 'text/*', limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));


// Rate limiting
const limiter = rateLimit({
  ...config?.rateLimit,
  handler: (_req, res) => res?.status(429).send('Too many requests'),
});

app?.use(limiter);

// CORS
app?.use((req, res, next) => {
  res?.setHeader('Access-Control-Allow-Origin', '*');
  res?.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res?.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req?.method === 'OPTIONS') return res?.sendStatus(200);
  next();
});

// Minimal logging
app?.use((req, _res, next) => {
  logger.info({
    method: req?.method,
    ip: req?.ip,
    url: req?.query?.url,
  });
  next();
});

app?.all('/', async (req, res) => {
  const targetUrl = req?.query?.url || '';

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res?.status(400).send('Target URL not provided or invalid type');
  }

  let validatedUrl;
  try {
    validatedUrl = new URL(targetUrl);
  } catch {
    return res?.status(400).send('Invalid URL format');
  }

  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'referer',
    'user-agent',
  ];

  const forwardHeaders = { ...req?.headers };
  hopByHopHeaders?.forEach(h => delete forwardHeaders[h]);

  // Check cache (GET only)
  if (req?.method === 'GET') {
    const cached = cache?.get(targetUrl);
    if (cached) {
      res?.setHeader('X-Proxy-Cache', 'HIT');
      return res?.send(cached);
    }
  }

  try {
    const axiosResponse = await axios({
      method: req?.method,
      url: validatedUrl.href,
      headers: {
        ...forwardHeaders,
        'X-Proxy-Source': 'anonymous',
      },
      data: req?.body,
      responseType: 'arraybuffer', // better for caching
      validateStatus: () => true,
      timeout: 0,
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50, timeout: 0 }),
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, timeout: 0 }),
    });

    const { status, headers, data } = axiosResponse;

    // Forward response headers (filtered)
    for (const [key, value] of Object.entries(headers)) {
      if (!hopByHopHeaders?.includes(key.toLowerCase())) res?.setHeader(key, value);
    }

    // Cache successful GETs
    if (req?.method === 'GET' && status >= 200 && status < 300) {
      cache?.set(targetUrl, data);
      res?.setHeader('X-Proxy-Cache', 'MISS');
    }

    res?.status(status).send(data);
  } catch (error) {
    logger.error(`Request error: ${error?.message}`);
    res?.status(500).send('Error fetching target URL');
  }
});

const server = app?.listen(config?.port, () => {
  console.log(`CORS Proxy server running on port ${config?.port}`);
});

server?.timeout = 0;
server?.headersTimeout = 0;
