import { Request, Response, NextFunction } from 'express';

interface ResponseMetric {
  timestamp: number;
  durationMs: number;
}

// In-memory storage for 60s rolling average
const responseMetrics: ResponseMetric[] = [];

/**
 * Tracks response times for all API requests.
 */
export const responseTimeTracker = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const durationMs = (seconds * 1000) + (nanoseconds / 1000000);
    const now = Date.now();

    responseMetrics.push({ timestamp: now, durationMs });

    // Clean up old metrics (> 60s)
    const sixtySecondsAgo = now - 60000;
    while (responseMetrics.length > 0 && responseMetrics[0].timestamp < sixtySecondsAgo) {
      responseMetrics.shift();
    }
  });

  next();
};

/**
 * Returns the rolling average response time for the last 60 seconds.
 */
export const getAverageResponseTime = (): number => {
  if (responseMetrics.length === 0) return 0;
  const totalDuration = responseMetrics.reduce((sum, metric) => sum + metric.durationMs, 0);
  return totalDuration / responseMetrics.length;
};
