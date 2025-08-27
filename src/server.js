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
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 10 })

// Config
const config = {
  port: process.env.PORT || 2208,
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
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

// Middlewares
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.text({ type: 'text/*', limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

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

// Proxy handler
app.all('/', async (req, res) => {
  const targetUrl = req.query?.url || ''

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Target URL not provided')
  }

  let validatedUrl
  try {
    validatedUrl = new URL(targetUrl)
  } catch {
    return res.status(400).send('Invalid URL format')
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
  ]

  const forwardHeaders = { ...req.headers }
  hopByHopHeaders.forEach((h) => delete forwardHeaders[h.toLowerCase()])

  // Cache check (GET only)
  if (req.method === 'GET') {
    const cached = cache.get(targetUrl)
    if (cached) {
      res.setHeader('X-Proxy-Cache', 'HIT')
      return res.end(cached) // return as Buffer
    }
  }

  try {
    const axiosResponse = await axios({
      method: req.method,
      url: validatedUrl.href,
      headers: {
        ...forwardHeaders,
        host: validatedUrl.host,
      },
      data: req.body,
      responseType: 'arraybuffer', // supports binary/text/json
      validateStatus: () => true,
      timeout: 0, // ⬅ infinite timeout for requests
    })

    // Forward headers
    for (const [key, value] of Object.entries(axiosResponse.headers)) {
      if (!hopByHopHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value)
      }
    }

    // Cache successful GET responses
    if (req.method === 'GET' && axiosResponse.status >= 200 && axiosResponse.status < 300) {
      cache.set(targetUrl, axiosResponse.data)
      res.setHeader('X-Proxy-Cache', 'MISS')
    }

    res.status(axiosResponse.status).end(axiosResponse.data)
  } catch (error) {
    logger.error(`Proxy error: ${error.message}`)
    res.status(500).send('Error fetching the requested URL')
  }
})

// Create raw server to disable timeout
const server = http.createServer(app)

// ⬅ Disable request/response timeout (infinite)
server.setTimeout(0)

server.listen(config.port, () => {
  console.log(`CORS Proxy server running on port ${config.port}`)
})
