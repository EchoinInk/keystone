// Storage remains NZD decimal dollars. Aggregate rounded line items in cents.
type Row = Record<string, unknown>;
export function cents(value: unknown) {
  const amount = Number(value ?? 0);
  // Malformed historical amounts appear in the exception report. Exclude
  // unquantifiable lines from provisional totals rather than emitting NaN.
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}
export const validMoney = (value: unknown) => typeof value === "number" && Number.isFinite(value)
  && value >= 0 && Number.isSafeInteger(cents(value)) && cents(value) / 100 === value;
const sum = (rows: Row[], key: string) => rows.reduce((n, row) => n + cents(row[key]), 0);

export function validDate(value: unknown) {
  const day = String(value).slice(0, 10);
  const time = Date.parse(day + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(time) && new Date(time).toISOString().startsWith(day);
}

export function financialReport(invoices: Row[], payments: Row[], expenses: Row[], date = new Date(), goals: Row[] = []) {
  const month = date.toISOString().slice(0, 7);
  const issues: { entity: string; id: string; reason: string }[] = [];
  const flag = (entity: string, row: Row, reason: string) => issues.push({ entity, id: String(row.id), reason });
  const periods = new Set<string>();
  for (const goal of goals) {
    const period = String(goal.period);
    if (!/^\d{4}-(0[1-9]|1[012])$/.test(period) || !validMoney(goal.target)) flag("revenueGoals", goal, "Review goal month or target");
    if (periods.has(period)) flag("revenueGoals", goal, "Repeated goal month");
    periods.add(period);
  }
  for (const expense of expenses) {
    if (!validMoney(expense.amount)) flag("expenses", expense, "Invalid expense amount");
    if (!validDate(expense.incurredAt)) flag("expenses", expense, "Review expense date");
  }
  const ids = new Set(invoices.map(row => row.id));
  const applied = new Map<unknown, number>();
  const references = new Set<string>();
  const numbers = new Set<string>();
  for (const payment of payments) {
    if (!validMoney(payment.amount) || cents(payment.amount) <= 0) flag("payments", payment, "Invalid receipt amount");
    if (!ids.has(payment.invoiceId)) flag("payments", payment, "Unallocated receipt or missing invoice");
    if (!validDate(payment.paidAt)) flag("payments", payment, "Review receipt date");
    const reference = String(payment.reference ?? "").trim().toLowerCase();
    const key = JSON.stringify([payment.invoiceId, reference]);
    if (reference && references.has(key)) flag("payments", payment, "Repeated receipt reference on invoice");
    references.add(key);
    applied.set(payment.invoiceId, (applied.get(payment.invoiceId) ?? 0) + cents(payment.amount));
  }
  let outstandingCents = 0;
  const balances = invoices.map(invoice => {
    const number = String(invoice.number ?? "").trim().toLowerCase();
    if (!number || numbers.has(number)) flag("invoices", invoice, "Missing or repeated invoice number");
    numbers.add(number);
    if (!validMoney(invoice.amount) || !validMoney(invoice.tax)) flag("invoices", invoice, "Invalid subtotal or tax");
    const gross = cents(invoice.amount) + cents(invoice.tax);
    const received = applied.get(invoice.id) ?? 0;
    const voided = invoice.status === "Void";
    if (voided && received) flag("invoices", invoice, "Void invoice has receipts");
    if (received > gross) flag("invoices", invoice, "Receipts exceed invoice total");
    const balance = voided ? 0 : Math.max(0, gross - received);
    const settlementStatus = voided ? "Void" : received > 0 && received >= gross ? "Paid" : received > 0 ? "Part paid"
      : ["Paid", "Part paid"].includes(String(invoice.status)) ? "Unpaid" : invoice.status;
    if (["Paid", "Part paid"].includes(String(invoice.status)) && settlementStatus !== invoice.status) {
      flag("invoices", invoice, "Recorded status disagrees with receipts");
    }
    outstandingCents += balance;
    return { ...invoice, id: invoice.id, status: invoice.status, number: invoice.number, dueDate: invoice.dueDate, balance: balance / 100, received: received / 100, settlementStatus };
  });
  const receiptsFor = (period: string) => sum(payments.filter(p => String(p.paidAt).startsWith(period)), "amount");
  const revenue = receiptsFor(month);
  const expense = sum(expenses.filter(e => String(e.incurredAt).startsWith(month)), "amount");
  const history = Array.from({ length: 6 }, (_, i) => {
    const period = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7);
    return { period, value: receiptsFor(period) / 100 };
  });
  return { balances, issues, metrics: { month, revenue: revenue / 100, totalRevenue: sum(payments, "amount") / 100,
    outstanding: outstandingCents / 100, openInvoices: balances.filter(row => row.balance > 0).length,
    monthExpenses: expense / 100, profit: (revenue - expense) / 100, history } };
}

export function pipelineMetrics(leads: Row[]) {
  const open = leads.filter(openLead);
  return { pipelineValue: open.reduce((total, row) => total + Number(row.value), 0),
    weightedPipeline: open.reduce((total, row) => total + Number(row.value) * Number(row.probability) / 100, 0) };
}

function openLead(row: Row) {
  return !["Won", "Lost", "Closed", "Not suitable"].includes(String(row.stage)) && row.status !== "Closed";
}
