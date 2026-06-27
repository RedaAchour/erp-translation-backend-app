import { Router, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../db';
import { AuthRequest } from '../middleware/auth';
//import { translateText, translateBatch } from '../services/claude';
import { translateText, translateBatch } from '../services/glm';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { parseXmlContent, LangCode, RawEntry } from '../parsers/xmlParser';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

const SORTABLE_COLUMNS = new Set(['id', 'filename', 'fr', 'en', 'ar', 'es', 'status', 'context', 'created_at', 'updated_at']);

/** Set transaction-scoped session variables for the audit trigger. */
async function setAuditContext(
  client: PoolClient,
  username: string,
  changeType: 'human_edited' | 'ai_generated' | 'bulk_import'
): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', ['app.current_user', username]);
  await client.query('SELECT set_config($1, $2, true)', ['app.change_type', changeType]);
}

/**
 * GET /api/translations
 * Fetch translations with filters and pagination
 */
router.get('/translations', async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = '1',
      limit = '10',
      status,
      context,
      search,
      validated,
      fr_filter,
      en_filter,
      ar_filter,
      es_filter,
      sortBy,
      sortOrder,
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

    // Filter by language column empty/non-empty
    const langFilters = [
      { param: fr_filter, column: 'fr' },
      { param: en_filter, column: 'en' },
      { param: ar_filter, column: 'ar' },
      { param: es_filter, column: 'es' },
    ];

    for (const lf of langFilters) {
      if (lf.param === 'empty') {
        whereClause += ` AND (${lf.column} IS NULL OR ${lf.column} = '')`;
      } else if (lf.param === 'not_empty') {
        whereClause += ` AND ${lf.column} IS NOT NULL AND ${lf.column} != ''`;
      }
    }

    const resolvedSortBy = typeof sortBy === 'string' && SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'id';
    const resolvedSortOrder: 'ASC' | 'DESC' = typeof sortOrder === 'string' && sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM translations ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    params.push(limit, offset);
    const query = `
      SELECT * FROM translations
      ${whereClause}
      ORDER BY ${resolvedSortBy} ${resolvedSortOrder} NULLS LAST
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
router.get('/translations/stats', async (_req: AuthRequest, res: Response) => {
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
router.get('/translations/contexts', async (_req: AuthRequest, res: Response) => {
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
router.post('/translations/ai-translate', async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
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

    const fetchResult = await client.query(
      `SELECT id, filename, fr, context FROM translations WHERE (id, filename) IN (${placeholders})`,
      params
    );

    // Translate in batches of 20
    const batchSize = 20;
    const translations: any[] = [];

    for (let i = 0; i < fetchResult.rows.length; i += batchSize) {
      const batch = fetchResult.rows.slice(i, i + batchSize);
      const batchResults = await translateBatch(
        batch.map((row) => ({
          french: row.fr,
          context: row.context,
          id: row.id,
        }))
      );

      // Update database in a single transaction per batch
      await client.query('BEGIN');
      await setAuditContext(client, 'ai', 'ai_generated');

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const translation = batchResults[j];

        await client.query(
          `UPDATE translations
           SET en = $1, ar = $2, es = $3, status = 'ai_translated'
           WHERE id = $4 AND filename = $5`,
          [translation.english, translation.arabic, translation.spanish, row.id, row.filename]
        );

        translations.push({ id: row.id, filename: row.filename, ...translation });
      }

      await client.query('COMMIT');
    }

    res.json({ success: true, count: translations.length, translations });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error AI translating:', error);
    res.status(500).json({ error: 'Failed to generate translations' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/translations/:id/:filename
 * Fetch a single translation row by id and filename
 */
router.get('/translations/:id/:filename', async (req: AuthRequest, res: Response) => {
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
 * GET /api/translations/:id/:filename/history
 * Fetch the change history for a single translation entry
 */
router.get('/translations/:id/:filename/history', async (req: AuthRequest, res: Response) => {
  try {
    const { id, filename } = req.params;
    const result = await pool.query(
      `SELECT id, language, old_value, new_value, changed_by, change_type, changed_at
       FROM translation_history
       WHERE translation_id = $1 AND filename = $2
       ORDER BY changed_at DESC`,
      [id, filename]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching translation history:', error);
    res.status(500).json({ error: 'Failed to fetch translation history' });
  }
});

/**
 * PUT /api/translations/:id/:filename
 * Update a single translation
 */
router.put('/translations/:id/:filename', async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { id, filename } = req.params;
    const {
      fr,
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

    if (fr !== undefined) {
      updates.push(`fr = $${paramCount}`);
      params.push(fr);
      paramCount++;
    }
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

    await client.query('BEGIN');
    await setAuditContext(client, req.username ?? 'unknown', 'human_edited');

    params.push(id, filename);
    const query = `
      UPDATE translations
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND filename = $${paramCount + 1}
      RETURNING *
    `;

    const result = await client.query(query, params);
    await client.query('COMMIT');

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating translation:', error);
    res.status(500).json({ error: 'Failed to update translation' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/translations/bulk-validate
 * Bulk validate translations
 */
router.post('/translations/bulk-validate', async (req: AuthRequest, res: Response) => {
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
      SET ${setClause}, status = 'approved', validated_by = $${ids.length * 2 + 1}, validated_at = now()
      WHERE (id, filename) IN (${placeholders})
    `;

    await pool.query(query, [...params, req.username ?? 'unknown']);

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
router.post('/translations/generate-xml-files', async (_req: AuthRequest, res: Response) => {
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

    const xmlHeader = `<?xml version="1.0" encoding="utf-8"?>\n<Root>\n`;
    const xmlFooter = `\n</Root>`;

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
/**
 * POST /api/translations/translation
 * Add a new entry to the translations table
 */
router.post('/translations/translation', async (req: AuthRequest, res: Response) => {
  try {
    let {
      filename,
      id,
      fr,
      en,
      es,
      ar,
      link,
      context,
      en_validated = false,
      es_validated = false,
      ar_validated = false
    } = req.body;

    // Validation
    if (!id || !filename) {
      return res.status(400).json({ error: 'id and filename are required' });
    }

    if (!fr && !link) {
      return res.status(400).json({ error: 'Either fr or link must be provided' });
    }

    en_validated = Boolean(en_validated);
    es_validated = Boolean(es_validated);
    ar_validated = Boolean(ar_validated);

    if (!ar && ar_validated) {
      return res.status(400).json({ error: 'Cannot set ar_validated to true if ar is empty' });
    }

    if (!es && es_validated) {
      return res.status(400).json({ error: 'Cannot set es_validated to true if es is empty' });
    }

    if (!en && en_validated) {
      return res.status(400).json({ error: 'Cannot set en_validated to true if en is empty' });
    }

    const query = `
      INSERT INTO translations (
        filename, id, fr, en, es, ar, link, context,
        en_validated, es_validated, ar_validated
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING *
    `;

    const params = [
      filename, id, fr, en, es, ar, link, context,
      en_validated, es_validated, ar_validated
    ];

    const result = await pool.query(query, params);

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating translation:', error);
    if (error.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Translation with this id and filename already exists' });
    }
    res.status(500).json({ error: 'Failed to create translation' });
  }
});

/**
 * POST /api/import
 * Import XML translation files (same logic as erp-i18n-export).
 * Accepts multipart form data with:
 *   - lang: language code ('fr' | 'en' | 'ar' | 'es')
 *   - files: one or more .xml files
 *
 * Upsert rule: if (id, filename) already exists, only update the
 * language column if it is currently NULL (never overwrite existing translations).
 */
router.post('/import', upload.array('files'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { lang } = req.body;
    const allowedLangs: LangCode[] = ['fr', 'en', 'ar', 'es'];

    if (!lang || !allowedLangs.includes(lang as LangCode)) {
      return res.status(400).json({
        error: `lang is required and must be one of: ${allowedLangs.join(', ')}`,
      });
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'At least one XML file is required' });
    }

    const langCode = lang as LangCode;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const fileResults: { filename: string; entries: number; inserted: number; updated: number; skipped: number }[] = [];

    for (const file of files) {
      // Derive filename without extension (matches erp-i18n-export behaviour)
      const filename = path.parse(file.originalname).name;
      if (!filename || filename.trim() === '') {
        continue;
      }

      const content = file.buffer.toString('utf-8');

      let parsed;
      try {
        parsed = parseXmlContent(content, langCode, filename);
      } catch (err: any) {
        console.error(`Failed to parse XML file: ${file.originalname}. Error: ${err.message}`);
        fileResults.push({ filename: file.originalname, entries: 0, inserted: 0, updated: 0, skipped: 0 });
        continue;
      }

      let fileInserted = 0;
      let fileUpdated = 0;
      let fileSkipped = 0;

      for (const entry of parsed.entries) {
        try {
          const result = await upsertTranslationImport(
            client,
            req.username ?? 'import',
            entry.id,
            entry.link ? null : langCode,
            entry.value ?? null,
            filename,
            entry.link ?? null
          );
          if (result === 'inserted') fileInserted++;
          else if (result === 'updated') fileUpdated++;
          else fileSkipped++;
        } catch (err: any) {
          console.error(`Failed to upsert entry: ${filename} ${entry.id} (${langCode}). Error: ${err.message}`);
          fileSkipped++;
        }
      }

      totalInserted += fileInserted;
      totalUpdated += fileUpdated;
      totalSkipped += fileSkipped;

      fileResults.push({
        filename,
        entries: parsed.entries.length,
        inserted: fileInserted,
        updated: fileUpdated,
        skipped: fileSkipped,
      });
    }

    res.json({
      success: true,
      lang: langCode,
      filesProcessed: fileResults.length,
      totalInserted,
      totalUpdated,
      totalSkipped,
      files: fileResults,
    });
  } catch (error) {
    console.error('Error importing translations:', error);
    res.status(500).json({ error: 'Failed to import translations' });
  } finally {
    client.release();
  }
});

/**
 * Upsert a single translation entry during import.
 *
 * - New row -> INSERT normally.
 * - Existing row with link -> update link if changed.
 * - Existing row with language value -> only update if the column is currently NULL.
 *
 * Returns 'inserted', 'updated', or 'skipped'.
 */
async function upsertTranslationImport(
  client: PoolClient,
  actor: string,
  id: string,
  lang: LangCode | null,
  value: string | null,
  filename: string,
  link: string | null
): Promise<'inserted' | 'updated' | 'skipped'> {
  if (link !== null) {
    // Link entry: insert or update link — no audit needed for link changes
    const result = await client.query(
      `INSERT INTO translations (id, link, filename)
       VALUES ($1, $2, $3)
       ON CONFLICT (id, filename) DO UPDATE SET
         link = EXCLUDED.link,
         updated_at = NOW()
       WHERE EXCLUDED.link IS DISTINCT FROM translations.link
       RETURNING (xmax = 0) AS is_insert`,
      [id, link, filename]
    );
    if (result.rowCount === 0) return 'skipped';
    return result.rows[0].is_insert ? 'inserted' : 'updated';
  }

  // Language value entry: only update if the existing column is NULL
  const allowedLangs: LangCode[] = ['fr', 'en', 'ar', 'es'];
  if (!lang || !allowedLangs.includes(lang)) {
    throw new Error(`Invalid language code: ${lang}`);
  }

  await client.query('BEGIN');
  await setAuditContext(client, actor, 'bulk_import');

  const result = await client.query(
    `INSERT INTO translations (id, ${lang}, filename)
     VALUES ($1, $2, $3)
     ON CONFLICT (id, filename) DO UPDATE SET
       ${lang} = EXCLUDED.${lang},
       updated_at = NOW()
     WHERE translations.${lang} IS NULL AND EXCLUDED.${lang} IS NOT NULL
     RETURNING (xmax = 0) AS is_insert`,
    [id, value, filename]
  );

  await client.query('COMMIT');

  if (result.rowCount === 0) return 'skipped';
  return result.rows[0].is_insert ? 'inserted' : 'updated';
}

export default router;
