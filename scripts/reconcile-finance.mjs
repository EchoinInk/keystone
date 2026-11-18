// Run on a restored SQLite backup. Read-only connection, single read snapshot.
import { DatabaseSync } from "node:sqlite";
import { financialReport } from "../app/finance.ts";

if (process.argv.length !== 3) throw new Error("Usage: node scripts/reconcile-finance.mjs <restored-database.sqlite>");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  db.exec("BEGIN");
  const invoices = db.prepare("SELECT id,number,amount,tax,status,due_date AS dueDate FROM invoices ORDER BY id").all();
  const payments = db.prepare("SELECT id,invoice_id AS invoiceId,amount,paid_at AS paidAt,reference FROM payments ORDER BY id").all();
  const expenses = db.prepare("SELECT id,amount,incurred_at AS incurredAt FROM expenses ORDER BY id").all();
  const goals = db.prepare("SELECT id,period,target FROM revenue_goals ORDER BY updated_at DESC,id").all();
  const report = financialReport(invoices, payments, expenses, new Date(), goals);
  console.log(JSON.stringify({ counts: { invoices: invoices.length, payments: payments.length, expenses: expenses.length, revenueGoals: goals.length },
    metrics: report.metrics, findings: report.issues, receipts: payments, invoices: report.balances }, null, 2));
  db.exec("COMMIT");
} finally { db.close(); }
