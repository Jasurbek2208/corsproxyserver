# 🌐 CORS Proxy Server

A lightweight and secure **CORS Proxy** built with **Node.js, Express, and Axios**, designed to bypass CORS restrictions when making client-side API requests.
Supports **infinite request/response timeout**, caching, rate-limiting, and logging.

## ✨ Features

* 🚀 Proxy any HTTP(S) request using `?url=...` query parameter
* ♾ Infinite request/response timeout (no timeouts for long-running requests)
* 📦 Built-in in-memory caching for GET requests (configurable TTL)
* 🔒 Rate limiting to prevent abuse (configurable)
* 📝 Winston-based logging to file with timestamps
* 🌍 CORS enabled (allows all origins by default)

## 📦 Installation

```bash
git clone https://github.com/Jasurbek2208/corsproxyserver.git
cd corsproxyserver
npm install
```

## 🚀 Usage

Start the proxy server:

```bash
npm run start
```

By default, the server runs on **port 2208** (or from `.env`).

### Example Request

```bash
# Proxy a public API request
curl "http://localhost:2208/?url=https://jsonplaceholder.typicode.com/posts/1"
```

### Example in JavaScript (fetch)

```js
fetch("http://localhost:2208/?url=https://jsonplaceholder.typicode.com/posts/1")
  .then(res => res.json())
  .then(console.log)
```

## ⚙ Configuration

Environment variables (`.env`):

| Variable               | Default   | Description                              |
| ---------------------- | --------- | ---------------------------------------- |
| `PORT`                 | 2208      | Server port                              |
| `RATE_LIMIT_WINDOW_MS` | 60000     | Rate limit window (ms)                   |
| `RATE_LIMIT_MAX`       | 100       | Max requests per window per IP           |
| `CACHE_TTL`            | 10        | GET cache TTL (seconds)                  |
| `LOG_LEVEL`            | info      | Logging level (error, warn, info, debug) |
| `LOG_FILE`             | proxy.log | Log file path                            |

## 🔒 Notes

* Use responsibly; this server exposes a raw proxy to any URL.
* Consider deploying behind authentication if running in production.
