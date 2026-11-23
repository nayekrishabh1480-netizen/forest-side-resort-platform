import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { ImportStatus, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ApiError, asyncRoute } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { AdminRole } from '@prisma/client';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const mapSchema = z.record(z.string(), z.string().trim().min(1).max(120));
const importFields = ['travellerCount', 'arrivalDate', 'departureDate', 'travelFrom', 'travelTo', 'name', 'phone'] as const;
type ImportField = typeof importFields[number];
type ParsedRow = { rowNumber: number; travellerCount: number | null; arrivalDate: Date | null; departureDate: Date | null; travelFrom: string | null; travelTo: string | null; fullName: string | null; phone: string | null; hash: string; duplicateOf: number | null };
type RowError = { rowNumber: number; field: string; code: string };

const aliases: Record<ImportField, string[]> = {
  travellerCount: ['no of travellers', 'number of travellers', 'travellers', 'guest count'],
  arrivalDate: ['date of arrival', 'arrival date', 'check in'],
  departureDate: ['date of departure', 'departure date', 'check out'],
  travelFrom: ['travelling from', 'traveling from', 'origin'],
  travelTo: ['travelling to', 'traveling to', 'destination'],
  name: ['name of traveller', 'traveller name', 'guest name'],
  phone: ['mob ph', 'mobile', 'mobile phone', 'phone'],
};
const piiFields = new Set<ImportField>(['name', 'phone']);
function normalize(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function cleanText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}
function parseSpreadsheetDate(value: ExcelJS.CellValue, cellText: string): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    return Number.isFinite(date.getTime()) ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) : null;
  }
  const text = cellText.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [Number(dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]), Number(dmy[2]), Number(dmy[1])] : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2] ? date : null;
}
function valueAsString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  return String(value);
}
function publicOperationalHash(row: Omit<ParsedRow, 'hash' | 'duplicateOf' | 'fullName' | 'phone'>) {
  return createHash('sha256').update(JSON.stringify([row.travellerCount, row.arrivalDate?.toISOString().slice(0, 10) ?? null, row.departureDate?.toISOString().slice(0, 10) ?? null, normalize(row.travelFrom ?? ''), normalize(row.travelTo ?? '')])).digest('hex');
}

export async function parseWorkbook(buffer: Buffer, providedMap?: unknown) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ApiError(400, 'INVALID_XLSX_FILE');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); } catch { throw new ApiError(400, 'INVALID_XLSX_FILE'); }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ApiError(400, 'WORKSHEET_NOT_FOUND');
  if (worksheet.rowCount > 10_000) throw new ApiError(400, 'ROW_LIMIT_EXCEEDED');
  const headersRow = worksheet.getRow(5);
  const headers: string[] = [];
  headersRow.eachCell({ includeEmpty: false }, (cell, col) => { headers[col] = cleanText(cell.value, 120) ?? ''; });
  const normalized = new Map<string, { name: string; index: number }>();
  headers.forEach((name, index) => { if (name) normalized.set(normalize(name), { name, index }); });
  const customMap: Record<string, string> = providedMap === undefined ? {} : mapSchema.parse(providedMap);
  const mapping: Partial<Record<ImportField, number>> = {};
  for (const field of importFields) {
    const preferred = customMap[field];
    const match = preferred ? normalized.get(normalize(preferred)) : aliases[field]!.map((alias) => normalized.get(normalize(alias))).find(Boolean);
    if (match) mapping[field] = match.index;
  }
  for (const required of ['travellerCount', 'arrivalDate'] as const) {
    if (!mapping[required]) throw new ApiError(400, 'REQUIRED_COLUMN_MISSING', `Required column mapping missing: ${required}`);
  }
  const errors: RowError[] = [];
  const rows: ParsedRow[] = [];
  const rowByFingerprint = new Map<string, number>();
  let rowsRead = 0;
  for (let rowNumber = 6; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const countCell = mapping.travellerCount ? row.getCell(mapping.travellerCount) : undefined;
    const arrivalCell = mapping.arrivalDate ? row.getCell(mapping.arrivalDate) : undefined;
    const departureCell = mapping.departureDate ? row.getCell(mapping.departureDate) : undefined;
    const countRaw = countCell?.value;
    const count = countRaw == null || countRaw === '' ? null : Number(countRaw);
    const arrival = arrivalCell ? parseSpreadsheetDate(arrivalCell.value, arrivalCell.text) : null;
    const departure = departureCell ? parseSpreadsheetDate(departureCell.value, departureCell.text) : null;
    const travelFrom = mapping.travelFrom ? cleanText(valueAsString(row.getCell(mapping.travelFrom)), 180) : null;
    const travelTo = mapping.travelTo ? cleanText(valueAsString(row.getCell(mapping.travelTo)), 180) : null;
    const fullName = mapping.name ? cleanText(valueAsString(row.getCell(mapping.name)), 180) : null;
    const phone = mapping.phone ? cleanText(valueAsString(row.getCell(mapping.phone)), 40) : null;
    if (![countRaw, arrivalCell?.value, departureCell?.value, travelFrom, travelTo, fullName, phone].some((value) => value != null && String(value).trim() !== '')) continue;
    rowsRead += 1;
    let invalid = false;
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > 30)) { errors.push({ rowNumber, field: 'travellerCount', code: 'INVALID_TRAVELLER_COUNT' }); invalid = true; }
    if (!arrival) { errors.push({ rowNumber, field: 'arrivalDate', code: 'INVALID_OR_MISSING_DATE' }); invalid = true; }
    if (departureCell?.value != null && !departure) { errors.push({ rowNumber, field: 'departureDate', code: 'INVALID_DATE' }); invalid = true; }
    if (arrival && departure && departure < arrival) { errors.push({ rowNumber, field: 'departureDate', code: 'DEPARTURE_BEFORE_ARRIVAL' }); invalid = true; }
    if (invalid) continue;
    const operational = { rowNumber, travellerCount: count, arrivalDate: arrival, departureDate: departure, travelFrom, travelTo };
    const fingerprint = createHash('sha256').update(JSON.stringify([count, arrival?.toISOString().slice(0, 10), departure?.toISOString().slice(0, 10), normalize(travelFrom ?? ''), normalize(travelTo ?? ''), normalize(fullName ?? ''), phone?.replace(/\D/g, '') ?? ''])).digest('hex');
    const duplicateOf = rowByFingerprint.get(fingerprint) ?? null;
    if (duplicateOf === null) rowByFingerprint.set(fingerprint, rowNumber);
    rows.push({ ...operational, fullName, phone, hash: publicOperationalHash(operational), duplicateOf });
  }
  return { headers: headers.filter(Boolean), mapping: Object.fromEntries(Object.entries(mapping).map(([field, index]) => [field, headers[index!]])), rows, errors, rowsRead, duplicateCount: rows.filter((row) => row.duplicateOf !== null).length };
}

function multipartMap(body: Record<string, unknown>) {
  if (!body.columnMap) return undefined;
  if (typeof body.columnMap !== 'string') return body.columnMap;
  try { return JSON.parse(body.columnMap) as unknown; } catch { throw new ApiError(400, 'INVALID_COLUMN_MAP'); }
}

export function importsRouter(prisma: PrismaClient) {
  const router = Router();
  const manager = requireRole(AdminRole.MANAGER, AdminRole.SUPER_ADMIN);
  router.post('/traveller-register/preview', manager, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED');
    const result = await parseWorkbook(req.file.buffer, multipartMap(req.body as Record<string, unknown>));
    const rows = result.rows.slice(0, 100).map((row) => ({ rowNumber: row.rowNumber, travellerCount: row.travellerCount, arrivalDate: row.arrivalDate?.toISOString().slice(0, 10) ?? null, departureDate: row.departureDate?.toISOString().slice(0, 10) ?? null, travelFrom: row.travelFrom, travelTo: row.travelTo, personalDataDetected: Boolean(row.fullName || row.phone), duplicateOfRow: row.duplicateOf }));
    res.json({ data: { worksheet: 'first worksheet', headerRow: 5, headers: result.headers, mapping: result.mapping, rowsRead: result.rowsRead, validRows: result.rows.length - result.duplicateCount, duplicateRows: result.duplicateCount, invalidRows: result.errors.length, personalDataStoredInPreview: false, rows, errors: result.errors.slice(0, 500), previewLimit: 100 } });
  }));

  router.post('/traveller-register', manager, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED');
    const includePersonalData = req.body.includePersonalData === 'true';
    const ownerAuthorized = req.body.ownerAuthorized === 'true';
    if (includePersonalData && !ownerAuthorized) throw new ApiError(400, 'OWNER_AUTHORIZATION_REQUIRED');
    if (includePersonalData && req.admin?.role !== AdminRole.SUPER_ADMIN) throw new ApiError(403, 'OWNER_AUTHORIZATION_REQUIRED');
    const parsed = await parseWorkbook(req.file.buffer, multipartMap(req.body as Record<string, unknown>));
    const uniqueRows = parsed.rows.filter((row) => row.duplicateOf === null);
    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({ data: { uploadedById: req.admin!.id, status: ImportStatus.COMPLETED, rowsRead: parsed.rowsRead, rowsImported: uniqueRows.length, rowsSkipped: parsed.duplicateCount, rowsFailed: new Set(parsed.errors.map((error) => error.rowNumber)).size, personalDataIncluded: includePersonalData, completedAt: new Date() } });
      for (const row of uniqueRows) {
        const guest = includePersonalData && (row.fullName || row.phone) ? await tx.guest.create({ data: { fullName: row.fullName, phone: row.phone, sourceImportBatchId: batch.id } }) : null;
        await tx.travellerRegisterEntry.create({ data: { importBatchId: batch.id, guestId: guest?.id, sourceRowNumber: row.rowNumber, travellerCount: row.travellerCount, travelFrom: row.travelFrom, travelTo: row.travelTo, arrivalDate: row.arrivalDate, departureDate: row.departureDate, operationalHash: row.hash } });
      }
      return batch;
    }, { timeout: 30_000 });
    res.status(201).json({ data: { batchId: created.id, status: created.status, rowsRead: created.rowsRead, rowsImported: created.rowsImported, rowsSkipped: created.rowsSkipped, rowsFailed: created.rowsFailed, personalDataIncluded: created.personalDataIncluded, identityProofsImported: false, addressesImported: false, errors: parsed.errors.slice(0, 500) } });
  }));

  router.get('/', asyncRoute(async (_req, res) => res.json({ data: await prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, status: true, rowsRead: true, rowsImported: true, rowsSkipped: true, rowsFailed: true, personalDataIncluded: true, createdAt: true, completedAt: true, revertedAt: true } }) })));
  router.get('/:id/summary', asyncRoute(async (req, res) => {
    const batch = await prisma.importBatch.findUnique({ where: { id: z.string().uuid().parse(req.params.id) }, include: { entries: { select: { travellerCount: true, travelFrom: true, travelTo: true, arrivalDate: true, departureDate: true, sourceRowNumber: true } } } });
    if (!batch) throw new ApiError(404, 'IMPORT_BATCH_NOT_FOUND');
    res.json({ data: { id: batch.id, status: batch.status, rowsRead: batch.rowsRead, rowsImported: batch.rowsImported, rowsSkipped: batch.rowsSkipped, rowsFailed: batch.rowsFailed, personalDataIncluded: batch.personalDataIncluded, entries: batch.entries } });
  }));
  router.post('/:id/revert', manager, asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id }, include: { entries: { select: { guestId: true } } } });
      if (!batch) throw new ApiError(404, 'IMPORT_BATCH_NOT_FOUND');
      if (batch.status === ImportStatus.REVERTED) throw new ApiError(409, 'IMPORT_ALREADY_REVERTED');
      const guestIds = [...new Set(batch.entries.map((entry) => entry.guestId).filter((guestId): guestId is string => Boolean(guestId)))];
      await tx.travellerRegisterEntry.deleteMany({ where: { importBatchId: id } });
      let deletedGuests = 0;
      for (const guestId of guestIds) {
        const related = await tx.guest.findUnique({ where: { id: guestId }, select: { _count: { select: { bookings: true, enquiries: true, travellerRegisterRows: true } } } });
        if (related && related._count.bookings === 0 && related._count.enquiries === 0 && related._count.travellerRegisterRows === 0) {
          await tx.guest.delete({ where: { id: guestId } });
          deletedGuests += 1;
        } else await tx.guest.update({ where: { id: guestId }, data: { sourceImportBatchId: null } });
      }
      await tx.importBatch.update({ where: { id }, data: { status: ImportStatus.REVERTED, revertedAt: new Date() } });
      return { deletedGuests };
    });
    res.json({ data: { reverted: true, deletedGuests: result.deletedGuests } });
  }));
  return router;
}
