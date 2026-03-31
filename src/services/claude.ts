import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

export interface TranslationRequest {
  french: string;
  context?: string;
  id?: string;
}

export interface TranslationResult {
  english: string;
  arabic: string;
  spanish: string;
}

/**
 * Translate a single French text to English, Arabic, and Spanish using Claude
 */
export async function translateText(
  request: TranslationRequest
): Promise<TranslationResult> {
  const contextInfo = request.context
    ? `This text is from the "${request.context}" module of an ERP system.`
    : 'This text is from an ERP (Enterprise Resource Planning) system.';

  const prompt = `${contextInfo}

Please translate the following French text into English, Arabic, and Spanish.

Context: This is a business/technical term or phrase used in enterprise software. Maintain professional terminology and consistency with ERP conventions.

French text: "${request.french}"

Return your response in this exact JSON format (no markdown, no preamble):
{
  "english": "translation here",
  "arabic": "translation here",
  "spanish": "translation here"
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  // Parse JSON response
  const cleaned = content.text.replace(/```json\n?|\n?```/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    english: result.english || '',
    arabic: result.arabic || '',
    spanish: result.spanish || '',
  };
}

/**
 * Translate multiple texts in a single batch (more efficient)
 */
export async function translateBatch(
  requests: TranslationRequest[]
): Promise<TranslationResult[]> {
  if (requests.length === 0) return [];

  // Group by context for better prompting
  const contextInfo = requests[0].context
    ? `These texts are from the "${requests[0].context}" module of an ERP system.`
    : 'These texts are from an ERP (Enterprise Resource Planning) system.';

  const textsJson = requests.map((req, idx) => ({
    id: idx,
    french: req.french,
  }));

  const prompt = `${contextInfo}

Please translate the following French texts into English, Arabic, and Spanish.

Context: These are business/technical terms or phrases used in enterprise software. Maintain professional terminology and consistency with ERP conventions.

French texts:
${JSON.stringify(textsJson, null, 2)}

Return your response as a JSON array (no markdown, no preamble) with this exact format:
[
  {
    "id": 0,
    "english": "translation here",
    "arabic": "translation here",
    "spanish": "translation here"
  },
  ...
]`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  // Parse JSON response
  const cleaned = content.text.replace(/```json\n?|\n?```/g, '').trim();
  const results = JSON.parse(cleaned);

  // Sort by id to maintain order
  results.sort((a: any, b: any) => a.id - b.id);

  return results.map((r: any) => ({
    english: r.english || '',
    arabic: r.arabic || '',
    spanish: r.spanish || '',
  }));
}