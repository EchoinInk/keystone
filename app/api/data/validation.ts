import { getTableColumns, type Table } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { AccessError } from "../../chatgpt-auth";
import { configs } from "../../record-fields";
import { validDate, validMoney } from "../../finance";
import { entities } from "./entities";

type Row = Record<string, unknown>;
export const invalid = (message: string): never => { throw new AccessError(400, message); };
export const validId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256;
const currency = new Set(["amount", "tax", "budget", "price", "revenueGenerated"]);
const percentages = new Set(["probability", "progress", "conversionRate"]);

export function validateFields(entity: string, fields: Row, previous?: Row) {
  const columns = getTableColumns((schema as Record<string, Table>)[entity]);
  const specs = configs[entity] ?? [];
  for (const [key, raw] of Object.entries(fields)) {
    if (!entities[entity].columns.includes(key)) invalid("Unknown field: " + key);
    const column = columns[key];
    const spec = specs.find(field => field.key === key);
    if (raw == null || (raw === "" && !column.notNull)) {
      if (column.notNull || spec?.required) invalid("Missing " + key);
      fields[key] = null;
      continue;
    }
    if (spec?.required && typeof raw === "string" && !raw.trim()) invalid("Missing " + key);
    if (column.dataType === "boolean") {
      if (![true, false, 0, 1].includes(raw as boolean)) invalid("Invalid " + key);
      fields[key] = Number(raw);
    } else if (column.dataType === "number") {
      // Sprint duration uses a select in the existing form.
      const value = key === "duration" && typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)
        || (column.getSQLType() === "integer" && !Number.isSafeInteger(value))) invalid("Invalid " + key);
      if ((currency.has(key) || (entity === "revenueGoals" && key === "target") || (entity === "leads" && key === "value")) && !validMoney(value)) invalid("Expected NZD to whole cents for " + key);
      if (percentages.has(key) && (Number(value) < 0 || Number(value) > 100)) invalid("Invalid percentage");
      if (entity !== "kpis" && Number(value) < 0) invalid("Invalid " + key);
      fields[key] = value;
    } else {
      if (typeof raw !== "string") invalid("Expected text for " + key);
      if (spec?.options && !spec.options.includes(String(raw)) && raw !== previous?.[key]) invalid("Unknown " + key);
      if (spec?.type === "date" || spec?.type === "datetime-local") {
        const value = String(raw);
        const pattern = spec.type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z?$/;
        if (!pattern.test(value) || !Number.isFinite(Date.parse(value)) || !validDate(value)) invalid("Invalid date for " + key);
      }
    }
  }
  if (!previous) {
    for (const field of specs) {
      if (field.required && field.type !== "file" && fields[field.key] == null) invalid("Missing " + field.key);
    }
    for (const key of entities[entity].columns) {
      if (columns[key].notNull && !columns[key].hasDefault && fields[key] == null) invalid("Missing " + key);
    }
  }
  const row = { ...previous, ...fields };
  if (entity === "revenueGoals" && !/^\d{4}-(0[1-9]|1[012])$/.test(String(row.period))) invalid("Expected goal month YYYY-MM");
  if (entity === "payments" && (!validId(row.invoiceId) || !validMoney(row.amount) || Number(row.amount) <= 0)) invalid("A receipt requires an invoice and a positive amount");
  if (entity === "invoices" && row.dueDate && row.issueDate && String(row.dueDate) < String(row.issueDate)) invalid("Due date precedes issue date");
  if (entity === "sprints" && row.duration !== undefined && Number(row.duration) < 1) invalid("Sprint duration must be positive");
  if (row.endDate && row.startDate && String(row.endDate) < String(row.startDate)) invalid("End precedes start");
  if (row.endsAt && row.startsAt && String(row.endsAt) < String(row.startsAt)) invalid("End precedes start");
}
