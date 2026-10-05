import type { NextFunction, Request, Response } from "express";

type Window = { count: number; resetAt: number };

export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now = Date.now()): number {
    const current = this.hits.get(key);
    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return 0;
    }
    current.count += 1;
    if (current.count > this.limit) return Math.ceil((current.resetAt - now) / 1000);
    return 0;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (this.hits.size < 5_000) return;
    for (const [key, window] of this.hits) {
      if (window.resetAt <= now) this.hits.delete(key);
    }
  }
}

export function rateLimit(options: {
  limit: number;
  windowMs: number;
  message?: string;
  key?: (req: Request) => string;
}) {
  const limiter = new RateLimiter(options.limit, options.windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip ?? "unknown"}|${options.key?.(req) ?? ""}`;
    const wait = limiter.hit(key);
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: options.message ?? "Too many requests. Wait a minute and try again.",
        },
        requestId: res.locals.requestId,
      });
      return;
    }
    next();
  };
}
