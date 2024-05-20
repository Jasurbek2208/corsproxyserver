import express from 'express'
import axios from 'axios'
import dotenv from 'dotenv'
import cors from 'cors'
dotenv?.config()

const app = express()
const PORT = Number(process?.env?.PORT) || 3000

app?.use(cors())
app?.use(express?.json())

app?.use('/', async (req, res) => {
  const TARGET_URL = String(req?.query?.url) || ''
  if (!TARGET_URL) return res?.status(400)?.send('Missing target URL')

  try {
    const response = await axios({
      method: req?.method,
      url: TARGET_URL,
      data: req?.body,
      headers: {
        ...req.headers,
        host: new URL(TARGET_URL)?.host || '',
      },
    })

    return res?.send(response?.data)
  } catch (error) {
    return res?.status(500).send('Error fetching the requested URL')
  }
})

app?.listen(PORT, () => {
  console?.log(`CORS Proxy server running on port ${PORT}`)
})