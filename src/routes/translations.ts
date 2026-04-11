import { Router, Request, Response } from 'express';
import pool from '../db';
//import { translateText, translateBatch } from '../services/claude';
import { translateText, translateBatch } from '../services/glm';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

/**
 * GET /api/translations
 * Fetch translations with filters and pagination
 */
router.get('/translations', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '10',
      status,
      context,
      search,
      validated,
    } = req.query;

    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    let whereClause = 'WHERE 1=1 AND link is null';
    const params: any[] = [];
    let paramCount = 1;

    // Filter by status
    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    // Filter by context
    if (context && context !== 'all') {
      whereClause += ` AND context = $${paramCount}`;
      params.push(context);
      paramCount++;
    }

    // Search in French text or ID
    if (search) {
      whereClause += ` AND (fr ILIKE $${paramCount} OR id ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Filter by validation status
    if (validated === 'true') {
      whereClause += ` AND en_validated = true AND ar_validated = true AND es_validated = true`;
    } else if (validated === 'false') {
      whereClause += ` AND (en_validated = false OR ar_validated = false OR es_validated = false)`;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM translations ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    params.push(limit, offset);
    const query = `
      SELECT * FROM translations
      ${whereClause}
      ORDER BY id
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const result = await pool.query(query, params);

    res.json({
      data: result.rows,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error) {
    console.error('Error fetching translations:', error);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

/**
 * GET /api/translations/stats
 * Get overall statistics
 */
router.get('/translations/stats', async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'ai_translated') as ai_translated,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE en_validated = true) as en_validated,
        COUNT(*) FILTER (WHERE ar_validated = true) as ar_validated,
        COUNT(*) FILTER (WHERE es_validated = true) as es_validated,
        COUNT(DISTINCT context) as unique_contexts
      FROM translations
    `;

    const result = await pool.query(query);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /api/translations/contexts
 * Get all unique contexts
 */
router.get('/translations/contexts', async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT DISTINCT context
      FROM translations
      WHERE context IS NOT NULL
      ORDER BY context
    `;

    const result = await pool.query(query);
    res.json(result.rows.map((r) => r.context));
  } catch (error) {
    console.error('Error fetching contexts:', error);
    res.status(500).json({ error: 'Failed to fetch contexts' });
  }
});

/**
 * POST /api/translations/ai-translate
 * Generate AI translations for selected items
 */
router.post('/translations/ai-translate', async (req: Request, res: Response) => {
  try {
    const { ids, filenames } = req.body;

    if (!ids || !Array.isArray(ids) || !filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'ids and filenames arrays required' });
    }

    if (ids.length !== filenames.length) {
      return res.status(400).json({ error: 'ids and filenames must have same length' });
    }

    // Fetch the items to translate
    const placeholders = ids.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
    const params: any[] = [];
    ids.forEach((id: string, i: number) => {
      params.push(id, filenames[i]);
    });

    const query = `
      SELECT id, filename, fr, context
      FROM translations
      WHERE (id, filename) IN (${placeholders})
    `;

    const result = await pool.query(query, params);

    // Translate in batches of 20
    const batchSize = 20;
    const translations: any[] = [];

    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize);
      const batchResults = await translateBatch(
        batch.map((row) => ({
          french: row.fr,
          context: row.context,
          id: row.id,
        }))
      );

      // Update database
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const translation = batchResults[j];

        await pool.query(
          `
          UPDATE translations
          SET en = $1, ar = $2, es = $3, status = 'ai_translated'
          WHERE id = $4 AND filename = $5
        `,
          [translation.english, translation.arabic, translation.spanish, row.id, row.filename]
        );

        translations.push({
          id: row.id,
          filename: row.filename,
          ...translation,
        });
      }
    }

    res.json({ success: true, count: translations.length, translations });
  } catch (error) {
    console.error('Error AI translating:', error);
    res.status(500).json({ error: 'Failed to generate translations' });
  }
});

/**
 * GET /api/translations/:id/:filename
 * Fetch a single translation row by id and filename
 */
router.get('/translations/:id/:filename', async (req: Request, res: Response) => {
  try {
    const { id, filename } = req.params;
    const query = 'SELECT * FROM translations WHERE id = $1 AND filename = $2';
    const result = await pool.query(query, [id, filename]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching single translation:', error);
    res.status(500).json({ error: 'Failed to fetch translation' });
  }
});

/**
 * PUT /api/translations/:id/:filename
 * Update a single translation
 */
router.put('/translations/:id/:filename', async (req: Request, res: Response) => {
  try {
    const { id, filename } = req.params;
    const {
      en,
      ar,
      es,
      status,
      en_validated,
      ar_validated,
      es_validated,
      notes,
      context,
    } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (en !== undefined) {
      updates.push(`en = $${paramCount}`);
      params.push(en);
      paramCount++;
    }
    if (ar !== undefined) {
      updates.push(`ar = $${paramCount}`);
      params.push(ar);
      paramCount++;
    }
    if (es !== undefined) {
      updates.push(`es = $${paramCount}`);
      params.push(es);
      paramCount++;
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }
    if (en_validated !== undefined) {
      updates.push(`en_validated = $${paramCount}`);
      params.push(en_validated);
      paramCount++;
    }
    if (ar_validated !== undefined) {
      updates.push(`ar_validated = $${paramCount}`);
      params.push(ar_validated);
      paramCount++;
    }
    if (es_validated !== undefined) {
      updates.push(`es_validated = $${paramCount}`);
      params.push(es_validated);
      paramCount++;
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      params.push(notes);
      paramCount++;
    }
    if (context !== undefined) {
      updates.push(`context = $${paramCount}`);
      params.push(context);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id, filename);
    const query = `
      UPDATE translations
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND filename = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating translation:', error);
    res.status(500).json({ error: 'Failed to update translation' });
  }
});

/**
 * POST /api/translations/bulk-validate
 * Bulk validate translations
 */
router.post('/translations/bulk-validate', async (req: Request, res: Response) => {
  try {
    const { ids, filenames, languages } = req.body;

    if (!ids || !Array.isArray(ids) || !filenames || !Array.isArray(filenames)) {
      return res.status(400).json({ error: 'ids and filenames arrays required' });
    }

    const validLanguages = ['en', 'ar', 'es'];
    const langsToValidate = languages || validLanguages;

    const placeholders = ids.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',');
    const params: any[] = [];
    ids.forEach((id: string, i: number) => {
      params.push(id, filenames[i]);
    });

    const setClause = langsToValidate
      .filter((l: string) => validLanguages.includes(l))
      .map((l: string) => `${l}_validated = true`)
      .join(', ');

    const query = `
      UPDATE translations
      SET ${setClause}, status = 'approved', validated_at = now()
      WHERE (id, filename) IN (${placeholders})
    `;

    await pool.query(query, params);

    res.json({ success: true, count: ids.length });
  } catch (error) {
    console.error('Error bulk validating:', error);
    res.status(500).json({ error: 'Failed to validate translations' });
  }
});
/**
 * POST /api/translations/generate-xml-files
 * Generate XML files from get_xml() SQL function and save to public/output
 */
router.post('/translations/generate-xml-files', async (_req: Request, res: Response) => {
  try {
    const outputDir = path.join(process.cwd(), 'public', 'output');

    // 1- clear/delete all "output" folder content
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore errors if directory doesn't exist
    }

    // Recreate the output folder
    await fs.mkdir(outputDir, { recursive: true });

    // Call get_xml() function
    const query = 'SELECT * FROM get_xml()';
    const result = await pool.query(query);

    // Group rows by folder and file_name
    const fileMap: Record<string, Record<string, string[]>> = {};
    //let i: number = 0;
    for (const row of result.rows) {
      const { folder, file_name, xml } = row;

      if (!folder || !file_name) continue;

      if (!fileMap[folder]) {
        fileMap[folder] = {};
      }
      if (!fileMap[folder][file_name]) {
        fileMap[folder][file_name] = [];
      }
      if (xml) {
        fileMap[folder][file_name].push(xml);
      }
      //i++;
      //console.log(`${i} : ${folder} : ${file_name} : ${xml}`);
    }

    const xmlHeader = `<!-- edited with Code in ${new Date().getFullYear() + '-' + new Date().getMonth() + '-' + new Date().getDate() + ' ' + new Date().getHours() + ':' + new Date().getMinutes() + ':' + new Date().getSeconds()} by Silwane -->\n<?xml version="1.0" encoding="utf-8"?>\n<Root>\n`;
    const xmlFooter = `\n</Root>\n`;

    const writePromises = Object.entries(fileMap).flatMap(([folder, files]) => {
      const folderPath = path.join(outputDir, folder);

      // Ensure folder exists, then write its files
      return (async () => {
        await fs.mkdir(folderPath, { recursive: true });

        const filePromises = Object.entries(files).map(async ([fileName, xmlLines]) => {
          const filePath = path.join(folderPath, fileName);
          // 4- ensure that these files are xml compliant with root tg as <Root>
          // Joining the xml snippets and wrapping them in Root element
          const content = xmlHeader + xmlLines.join('\n') + xmlFooter;
          
          let fileHandle;
          try {
            fileHandle = await fs.open(filePath, 'w');
            await fileHandle.writeFile(content, 'utf-8');
          } finally {
            if (fileHandle !== undefined) {
              await fileHandle.close();
            }
          }
        });

        await Promise.all(filePromises);
      })();
    });

    await Promise.all(writePromises);

    // Calculate total files generated
    let totalFiles = 0;
    for (const folder in fileMap) {
      totalFiles += Object.keys(fileMap[folder]).length;
    }

    res.json({ success: true, message: 'XML files generated successfully', filesGenerated: totalFiles });
  } catch (error) {
    console.error('Error generating XML files:', error);
    res.status(500).json({ error: 'Failed to generate XML files' });
  }
});

export default router;