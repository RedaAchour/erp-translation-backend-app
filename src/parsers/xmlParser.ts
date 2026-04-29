import { XMLParser } from 'fast-xml-parser';

export type LangCode = 'fr' | 'en' | 'ar' | 'es';

export interface RawEntry {
  id: string;
  value?: string;
  link?: string;
}

export interface ParsedFile {
  filename: string;
  lang: LangCode;
  entries: RawEntry[];
}

/**
 * Parse an XML buffer or string into structured translation entries.
 * Replicates the logic from erp-i18n-export/src/parsers/xmlParser.ts
 */
export function parseXmlContent(
  content: string,
  lang: LangCode,
  filename: string
): ParsedFile {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    parseTagValue: false,
    isArray: (name) => name === 'Text',
  });

  const parsed = parser.parse(content);
  const textNodes = findTextNodes(parsed);

  const entries: RawEntry[] = [];

  for (const node of textNodes) {
    const id = node && node['@_Id'];
    if (!id || typeof id !== 'string' || id.trim() === '') {
      continue;
    }

    const link = node['@_Link'];

    let value: string | undefined = undefined;
    if (node.Value !== undefined && node.Value !== null) {
      if (typeof node.Value === 'string') {
        value = node.Value;
      } else if (typeof node.Value === 'object') {
        if (node.Value.__cdata !== undefined) {
          value = String(node.Value.__cdata);
        } else if (node.Value['#text'] !== undefined) {
          value = String(node.Value['#text']);
        } else {
          value = String(node.Value);
        }
      } else {
        value = String(node.Value);
      }
    }

    const entry: RawEntry = { id };
    if (value !== undefined) {
      entry.value = value;
    }
    if (link !== undefined && typeof link === 'string') {
      entry.link = link;
    }

    entries.push(entry);
  }

  return { filename, lang, entries };
}

/**
 * Recursively find all <Text> nodes regardless of XML depth
 */
function findTextNodes(obj: any): any[] {
  let results: any[] = [];
  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      results = results.concat(findTextNodes(item));
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === 'Text') {
        if (Array.isArray(obj[key])) {
          results = results.concat(obj[key]);
        } else {
          results.push(obj[key]);
        }
      } else {
        results = results.concat(findTextNodes(obj[key]));
      }
    }
  }
  return results;
}
