import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import translationsRouter from './routes/translations';
import authRouter from './routes/auth';
import { authenticateToken } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/auth', authRouter);

// Protected routes
app.use('/api', authenticateToken, translationsRouter);

// Start server
app.listen(PORT, () => {
  console.log(`✅ Translation API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});