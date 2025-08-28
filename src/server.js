import express from 'express'
import axios, { AxiosRequestHeaders } from 'axios'
import rateLimit from 'express-rate-limit'
import { createLogger, transports, format } from 'winston'
import dotenv from 'dotenv'
import NodeCache from 'node-cache'
import cors from 'cors'
import http from 'http'

dotenv.config()

// ===================== CACHE =====================
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || '10'), // default 10s
})

// ===================== CONFIG =====================
const config = {
  port: process.env.PORT || 2208,
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1m
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // 100 req/m
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'proxy.log',
  },
}

// ===================== LOGGER =====================
const logger = createLogger({
  level: config.logging.level,
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.File({ filename: config.logging.file }),
    new transports.Console(),
  ],
})

// ===================== EXPRESS APP =====================
const app = express()

// Middlewares
app.use(cors())
app.use(express.json({ limit: '5mb' }))
app.use(express.text({ type: 'text/*', limit: '5mb' }))
app.use(express.urlencoded({ extended: true, limit: '5mb' }))

// Rate limiting
const limiter = rateLimit({
  ...config.rateLimit,
  handler: (_req, res) => res.status(429).send('Too many requests'),
})
app.use(limiter)

// Minimal request logging
app.use((req, _res, next) => {
  logger.info({
    method: req.method,
    ip: req.ip,
    url: req.query?.url,
  })
  next()
})

// ===================== PROXY HANDLER =====================
app.all('/', async (req, res) => {
  const targetUrl = req.query?.url as string

  if (!targetUrl) {
    return res.status(400).send('Target URL not provided')
  }

  let validatedUrl: URL
  try {
    validatedUrl = new URL(targetUrl)
  } catch {
    return res.status(400).send('Invalid URL format')
  }

  // Hop-by-hop headers to remove
  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ]

  // Forward headers
  const forwardHeaders: AxiosRequestHeaders = { ...req.headers } as AxiosRequestHeaders
  hopByHopHeaders.forEach((h) => delete forwardHeaders[h.toLowerCase()])

  // Cache check (GET only)
  if (req.method === 'GET') {
    const cached = cache.get<Buffer>(targetUrl)
    if (cached) {
      res.setHeader('X-Proxy-Cache', 'HIT')
      return res.end(cached)
    }
  }

  try {
    const axiosResponse = await axios({
      method: req.method as any,
      url: validatedUrl.href,
      headers: {
        ...forwardHeaders,
        host: validatedUrl.host,
      },
      data: req.body,
      responseType: 'arraybuffer', // binary/text/json
      validateStatus: () => true,
      timeout: 0, // infinite request timeout
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })

    // Forward response headers
    for (const [key, value] of Object.entries(axiosResponse.headers)) {
      if (!hopByHopHeaders.includes(key.toLowerCase())) {
        try {
          res.setHeader(key, value as string)
        } catch {
          // ignore invalid header values
        }
      }
    }

    // Cache successful GET responses
    if (req.method === 'GET' && axiosResponse.status >= 200 && axiosResponse.status < 300) {
      cache.set(targetUrl, axiosResponse.data)
      res.setHeader('X-Proxy-Cache', 'MISS')
    }

    res.status(axiosResponse.status).end(axiosResponse.data)
  } catch (error: any) {
    logger.error(`Proxy error: ${error.message}`)
    res.status(500).send('Error fetching the requested URL')
  }
})

// ===================== RAW SERVER (disable timeout) =====================
const server = http.createServer(app)
server.setTimeout(0) // infinite socket timeout

server.listen(config.port, () => {
  console.log(`🚀 CORS Proxy server running on port ${config.port}`)
})
