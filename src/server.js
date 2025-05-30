import express from 'express';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { createLogger, transports, format } from 'winston';
import https from 'https';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import http from 'http';

dotenv.config();

// Cache settings
const cache = new NodeCache({ stdTTL: 10 });

// Configuration
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

// Logger settings
const logger = createLogger({
  level: config?.logging?.level,
  format: format?.combine(
    format?.timestamp(),
    format?.json()
  ),
  transports: [
    new transports.File({ filename: config?.logging?.file }),
  ],
});

// Express app
const app = express();

// Axios settings (for performance)
const axiosInstance = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
});

// Rate limiting
const limiter = rateLimit({
  ...config?.rateLimit,
  handler: (_req, res) => {
    res?.status(429).send('Too many requests');
  },
});

// CORS settings
app.use((req, res, next) => {
  res?.header('Access-Control-Allow-Origin', '*');
  res?.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res?.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req?.method === 'OPTIONS') {
    return res?.sendStatus(200);
  }
  next();
});

// Apply rate limiting
app.use(limiter);

// Minimal logging (no target URL stored)
app.use((req, _res, next) => {
  logger?.info({
    method: req?.method,
    ip: req?.ip,
  });
  next();
});

// Proxy route
app.all('/', async (req, res) => {
  const targetUrl = req?.query.url;
  if (!targetUrl) return res?.status(400).send('Target URL not provided');

  // URL validation
  try {
    new URL(targetUrl);
  } catch {
    return res?.status(400).send('Invalid URL format');
  }

  // Remove hop-by-hop and sensitive headers
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
  hopByHopHeaders?.forEach(header => delete forwardHeaders[header]);

  // Check cache (for GET requests only)
  if (req?.method === 'GET') {
    const cachedData = cache?.get(targetUrl);
    if (cachedData) return res?.send(cachedData);
  }

  try {
    const response = await axiosInstance({
      method: req?.method,
      url: targetUrl,
      data: req?.body,
      headers: {
        ...forwardHeaders,
        'X-Proxy-Source': 'anonymous', // Generic source for privacy
      },
      responseType: 'stream',
      validateStatus: () => true,
    });

    // Set response headers
    Object.entries(response?.headers).forEach(([key, value]) => {
      if (!hopByHopHeaders?.includes(key?.toLowerCase())) res?.setHeader(key, value);
    });

    // Cache response (for successful GET requests)
    if (req?.method === 'GET' && response?.status >= 200 && response?.status < 300) {
      response?.data?.on('data', (chunk) => cache?.set(targetUrl, chunk?.toString())
      );
    }

    res?.status(response?.status);
    response?.data?.pipe(res);
    response?.data?.on('error', (err) => {
      logger?.error(`Stream error: ${err?.message}`);
      if (!res?.headersSent) res?.status(500).send('Stream error');
    });
  } catch (error) {
    logger?.error(`Request error: ${error?.message}`);
    res?.status(500).send('Error fetching target URL');
  }
});

// Start server
app?.listen(config?.port, () => {
  console.log(`CORS Proxy server running on port ${config?.port}`);
});