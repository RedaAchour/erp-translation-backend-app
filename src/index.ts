import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import translationsRouter from './routes/translations';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', translationsRouter);

// Start server
app.listen(PORT, () => {
  console.log(`✅ Translation API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});