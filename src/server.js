import express from 'express'
import axios from 'axios'
import rateLimit from 'express-rate-limit'
import { createLogger, transports, format } from 'winston'
import dotenv from 'dotenv'
import NodeCache from 'node-cache'
import cors from 'cors'
import http from 'http'

dotenv.config()

// Cache
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL || '30') })

// Config
const config = {
  port: process.env.PORT || 2208,
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'proxy.log',
  },
}

// Logger
const logger = createLogger({
  level: config.logging.level,
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.File({ filename: config.logging.file })],
})

const app = express()

// ✅ CORS – barcha domenlarga ruxsat
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Accept'] }))
app.options('*', cors()) // preflight OPTIONS ga javob beradi

// Body parsers
app.use(express.json({ limit: '5mb' }))
app.use(express.text({ type: 'text/*', limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// ✅ Rate limiting
const limiter = rateLimit({
  ...config.rateLimit,
  handler: (_req, res) => res.status(429).send('Too many requests'),
})
app.use(limiter)

// ✅ Logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, ip: req.ip, url: req.query?.url })
  next()
})

// Proxy
app.all('/', async (req, res) => {
  const targetUrl = req.query?.url
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Target URL not provided')
  }

  let validatedUrl: URL
  try {
    validatedUrl = new URL(targetUrl)
  } catch {
    return res.status(400).send('Invalid URL format')
  }

  // Hop-by-hop headers
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

  const forwardHeaders = { ...req.headers }
  hopByHopHeaders.forEach((h) => delete forwardHeaders[h.toLowerCase()])
  delete forwardHeaders['host'] // ⚠ host headerni yubormaymiz

  // ✅ Cache only for GET
  if (req.method === 'GET') {
    const cached = cache.get<Buffer>(targetUrl)
    if (cached) {
      res.setHeader('X-Proxy-Cache', 'HIT')
      return res.end(cached)
    }
  }

  try {
    const axiosResponse = await axios({
      method: req.method,
      url: validatedUrl.href,
      headers: forwardHeaders,
      data: req.body,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 0,
    })

    // Forward headers
    for (const [key, value] of Object.entries(axiosResponse.headers)) {
      if (!hopByHopHeaders.includes(key.toLowerCase())) {
        try {
          res.setHeader(key, value as string)
        } catch {
          // agar noto‘g‘ri header bo‘lsa, tashlab ketamiz
        }
      }
    }

    // Cache save
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

// HTTP server
const server = http.createServer(app)
server.setTimeout(0)

server.listen(config.port, () => {
  console.log(`✅ CORS Proxy running on port ${config.port}`)
})
