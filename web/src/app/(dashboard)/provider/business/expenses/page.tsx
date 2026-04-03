'use client';

import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCreateExpense, useDeleteExpense, useExpenses } from '@/hooks/useExpenses';
import { EXPENSE_CATEGORY_CLASSES } from '@/lib/status-badge-classes';
import { formatCents } from '@/lib/utils';
import type { ExpenseCategory, ProviderExpense } from '@/types';
import { EXPENSE_CATEGORY } from '@/types';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: 'Materials',
  tools: 'Tools',
  transportation: 'Transportation',
  insurance: 'Insurance',
  licensing: 'Licensing',
  marketing: 'Marketing',
  subcontractor: 'Subcontractor',
  office: 'Office',
  other: 'Other',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ExpenseItem({ expense }: { expense: ProviderExpense }) {
  const deleteExpense = useDeleteExpense();

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={EXPENSE_CATEGORY_CLASSES[expense.category]}>
            {CATEGORY_LABELS[expense.category]}
          </Badge>
          <span className="text-sm font-medium tabular-nums">
            {formatCents(expense.amount_cents)}
          </span>
        </div>
        <p className="mt-1 text-sm">{expense.description}</p>
        <p className="text-xs text-zinc-300">{formatDate(expense.expense_date)}</p>
        {expense.receipt_url ? (
          <a
            href={expense.receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            View receipt
          </a>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-[44px] shrink-0 text-destructive hover:bg-destructive/10"
        onClick={() => { deleteExpense.mutate(expense.id); }}
        disabled={deleteExpense.isPending}
        aria-label={`Delete expense: ${expense.description}`}
      >
        {deleteExpense.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export default function ExpensesPage() {
  const { data: expensesData, isLoading } = useExpenses();
  const createExpense = useCreateExpense();

  const [category, setCategory] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [description, setDescription] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split('T')[0] ?? '',
  );

  const expenses = expensesData?.expenses ?? [];
  const totalCents = expensesData?.total_cents ?? 0;

  // Category breakdown
  const categoryBreakdown = expenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount_cents;
    return acc;
  }, {});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !amountDollars || !description || !expenseDate) return;

    const amountCents = Math.round(parseFloat(amountDollars) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) return;

    createExpense.mutate(
      {
        category,
        description,
        amount_cents: amountCents,
        receipt_url: receiptUrl || undefined,
        expense_date: expenseDate,
      },
      {
        onSuccess: () => {
          setCategory('');
          setAmountDollars('');
          setDescription('');
          setReceiptUrl('');
          setExpenseDate(new Date().toISOString().split('T')[0] ?? '');
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/provider/business"
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Business Services
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Expense Tracking</h1>
        <p className="mt-1 text-zinc-300">
          Track business expenses for tax deductions and financial planning.
        </p>
      </div>

      {/* Add expense form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Expense</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => { setExpenseDate(e.target.value); }}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="expense-category" className="min-h-[44px]" aria-label="Select expense category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPENSE_CATEGORY).map(([key, value]) => (
                      <SelectItem key={key} value={value}>
                        {CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount ($)</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amountDollars}
                  onChange={(e) => { setAmountDollars(e.target.value); }}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-receipt">Receipt URL (optional)</Label>
                <Input
                  id="expense-receipt"
                  type="url"
                  placeholder="https://..."
                  value={receiptUrl}
                  onChange={(e) => { setReceiptUrl(e.target.value); }}
                  className="min-h-[44px]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-description">Description</Label>
              <Textarea
                id="expense-description"
                placeholder="Describe the expense..."
                value={description}
                onChange={(e) => { setDescription(e.target.value); }}
                className="min-h-[80px]"
              />
            </div>

            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={
                !category || !amountDollars || !description || !expenseDate || createExpense.isPending
              }
            >
              {createExpense.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Add Expense
            </Button>
            {createExpense.isError ? (
              <p className="text-sm text-destructive">Failed to add expense. Please try again.</p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{formatCents(totalCents)}</p>
            )}
            <p className="mt-1 text-xs text-zinc-300">
              {String(expenses.length)} expense{expenses.length !== 1 ? 's' : ''} recorded
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Category</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={`skel-cat-${String(i)}`} className="h-5 w-full" />
                ))}
              </div>
            ) : Object.keys(categoryBreakdown).length === 0 ? (
              <p className="text-sm text-zinc-300">No expenses recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(categoryBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, amount]) => (
                    <div key={cat} className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className={EXPENSE_CATEGORY_CLASSES[cat as ExpenseCategory]}
                      >
                        {CATEGORY_LABELS[cat as ExpenseCategory]}
                      </Badge>
                      <span className="text-sm font-medium tabular-nums">
                        {formatCents(amount)}
                      </span>
                    </div>
                  ))}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-sm font-bold tabular-nums">{formatCents(totalCents)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expense list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={`skel-exp-${String(i)}`} className="h-20 w-full" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-zinc-300">
                No expenses recorded yet. Add your first expense above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <ExpenseItem key={expense.id} expense={expense} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
