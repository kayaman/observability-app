// src/app.ts
import express from 'express'
import { Request, Response } from 'express'
import client from 'prom-client'
import * as winston from 'winston'
import LokiTransport from 'winston-loki'

// Set up Prometheus metrics registry
const register = new client.Registry()
client.collectDefaultMetrics({ register })

// Create metrics
const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
})

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
})

// Register metrics
register.registerMetric(httpRequestDurationMicroseconds)
register.registerMetric(httpRequestCounter)

// Set up Winston logger with Loki transport
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'api-service' },
  transports: [
    new winston.transports.Console(),
    new LokiTransport({
      host: process.env.LOKI_HOST || 'http://loki:3100',
      labels: { job: 'api-service' },
      json: true,
      format: winston.format.json(),
      replaceTimestamp: true,
      onConnectionError: err => console.error(err),
    }),
  ],
})

// Create Express app
const app = express()
const port = 3000

// Middleware to measure request duration
app.use((req: Request, res: Response, next) => {
  const end = httpRequestDurationMicroseconds.startTimer()
  const originalSend = res.send

  res.send = function (body): Response {
    originalSend.call(this, body)
    const responseTime = end({ method: req.method, route: req.path, status_code: res.statusCode })

    logger.info('Request processed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTimeMs: responseTime * 1000,
    })

    httpRequestCounter.inc({
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    })

    return this
  }

  next()
})

// API endpoints
app.get('/api/data', (req: Request, res: Response) => {
  // Simulate processing time
  const processingTime = Math.random() * 500
  setTimeout(() => {
    const data = {
      value: Math.floor(Math.random() * 100),
      timestamp: new Date().toISOString(),
    }
    res.json(data)
  }, processingTime)
})

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Start server
app.listen(port, () => {
  logger.info(`API service listening on port ${port}`)
})
