import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
