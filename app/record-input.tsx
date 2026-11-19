import type { DataSet, Row } from "./editor-types";
import type { Field } from "./record-fields";

export function browserFieldValue(field: Field, value: unknown) {
  const raw = String(value ?? "");
  if (field.type === "date") return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
  if (field.type === "datetime-local") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : "";
  return raw;
}

export function recordLabel(row?: Row) {
  if (!row) return "Record";
  const name = [row.name, row.title, row.label, row.description, row.number, row.period,
    row.prompt, row.business, row.reference, row.author, row.quote].find(value => typeof value === "string" && value.trim());
  if (name) return String(name);
  if (row.paidAt) return `Payment · ${row.paidAt} · NZ$${Number(row.amount).toFixed(2)}`;
  if (row.minutes != null) return `${row.minutes} min · ${row.date}`;
  return String(row.date ?? row.id);
}

function numberRules(entity: string, key: string) {
  const currency = ["amount", "tax", "price", "budget", "revenueGenerated"].includes(key) ||
    (entity === "leads" && key === "value") || (entity === "revenueGoals" && key === "target");
  const min = entity === "kpis" ? undefined : entity === "payments" && key === "amount" ? 0.01 :
    ["dayNumber", "weekNumber"].includes(key) ? 1 : 0;
  const max = ["progress", "probability", "conversionRate"].includes(key) ? 100 : undefined;
  const step = currency ? 0.01 : entity === "kpis" || key === "conversionRate" ? "any" : 1;
  return { min, max, step };
}

export function validateForm(form: HTMLFormElement) {
  const errors: Record<string, string> = {};
  let first: HTMLElement | undefined;
  for (const control of form.elements) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) ||
        !control.name || !control.willValidate) continue;
    const missing = control.required && !control.value.trim();
    if (!missing && control.validity.valid) continue;
    errors[control.name] = missing ? (control instanceof HTMLSelectElement ? "Choose a record." :
      control instanceof HTMLInputElement && control.type === "file" ? "Choose a file." : "Enter a value for this field.") : control.validationMessage;
    first ??= control;
  }
  return { errors, first };
}

export function FieldInput({ entity, field, value, data, onChange, error, minDate }: {
  entity: string; field: Field; value: unknown; data: DataSet; onChange: (value: unknown) => void;
  error?: string; minDate?: string;
}) {
  const { key, label, type, required, hint } = field;
  const id = "field-" + key;
  const shared = { id, name: key, required, "aria-invalid": error ? true : undefined,
    "aria-describedby": [hint && id + "-hint", error && id + "-error"].filter(Boolean).join(" ") || undefined };
  const caption = <div className="field-caption"><label htmlFor={id}>{label}</label>{required && <span aria-hidden="true"> *</span>}</div>;
  let control;
  if (type === "textarea") control = <textarea {...shared} rows={5} value={String(value ?? "")} onChange={e => onChange(e.target.value)}/>;
  else if (type === "checkbox") control = <input {...shared} type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)}/>;
  else if (type === "select" || type === "relation") {
    const current = String(value ?? "");
    const options = type === "relation" ? (data[field.relation!] ?? []).map(row => [row.id, recordLabel(row)]) :
      (field.options ?? []).map(option => [option, option]);
    control = <select {...shared} value={current} onChange={e => onChange(e.target.value)}>
      {type === "relation" && <option value="">{required ? "Choose a record" : "None"}</option>}
      {current && !options.some(([v]) => v === current) && <option value={current}>
        {type === "relation" ? "Previously linked record unavailable" : current}</option>}
      {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
    </select>;
  } else {
    const inputType = entity === "revenueGoals" && key === "period" ? "month" : key === "email" ? "email" :
      key === "phone" ? "tel" : type ?? "text";
    control = <input {...shared} type={inputType} value={browserFieldValue(field, value)} onChange={e => onChange(e.target.value)}
      {...(type === "number" ? numberRules(entity, key) : { min: minDate })}/>;
  }
  return <div className={type === "checkbox" ? "record-field checkbox-field" : "record-field"}>
    {type === "checkbox" ? <>{control}{caption}</> : <>{caption}{control}</>}
    {hint && <small id={id + "-hint"}>{hint}</small>}
    {error && <small className="field-error" id={id + "-error"}>{error}</small>}
  </div>;
}
