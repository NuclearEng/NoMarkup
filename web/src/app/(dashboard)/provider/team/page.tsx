'use client';

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserX,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { AddEmployeeForm } from '@/components/providers/AddEmployeeForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmployees, useUpdateEmployee } from '@/hooks/useEmployees';
import { cn } from '@/lib/utils';
import type { BackgroundCheckStatus, CompanyEmployee, EmployeeRole, EmployeeStatus } from '@/types';

const ROLE_LABELS: Record<EmployeeRole, string> = {
  technician: 'Technician',
  lead: 'Lead',
  manager: 'Manager',
  apprentice: 'Apprentice',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
};

function getRoleBadgeVariant(role: EmployeeRole): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'manager':
      return 'default';
    case 'lead':
      return 'secondary';
    default:
      return 'outline';
  }
}

function getStatusColor(status: EmployeeStatus): string {
  switch (status) {
    case 'active':
      return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
    case 'pending':
      return 'text-amber-400 bg-amber-500/15 border-amber-500/30';
    case 'suspended':
      return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
    case 'terminated':
      return 'text-red-400 bg-red-500/15 border-red-500/30';
  }
}

function BackgroundCheckBadge({ status }: { status: BackgroundCheckStatus }) {
  switch (status) {
    case 'passed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Verified
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Check Pending
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Check Failed
        </span>
      );
    case 'not_started':
    default:
      return (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
          Not Started
        </span>
      );
  }
}

function EmployeeCard({
  employee,
  onStatusChange,
  onRemove,
}: {
  employee: CompanyEmployee;
  onStatusChange: (id: string, status: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-start gap-4 text-left"
          onClick={() => {
            setExpanded(!expanded);
          }}
          aria-expanded={expanded}
          aria-label={`${employee.first_name} ${employee.last_name} details`}
        >
          {/* Avatar placeholder */}
          <div className="bg-muted text-muted-foreground flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {employee.first_name.charAt(0)}
            {employee.last_name.charAt(0)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">
                {employee.first_name} {employee.last_name}
              </h3>
              <Badge variant={getRoleBadgeVariant(employee.role)}>
                {ROLE_LABELS[employee.role]}
              </Badge>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                  getStatusColor(employee.status),
                )}
              >
                {STATUS_LABELS[employee.status]}
              </span>
            </div>

            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-3 text-xs">
              {employee.hire_date ? (
                <span>Hired {new Date(employee.hire_date).toLocaleDateString()}</span>
              ) : null}
              <BackgroundCheckBadge status={employee.background_check_status} />
            </div>
          </div>

          <span className="text-muted-foreground shrink-0 text-xs" aria-hidden="true">
            {expanded ? 'Collapse' : 'Expand'}
          </span>
        </button>

        {expanded ? (
          <div className="mt-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Contact info */}
              <div className="space-y-2">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Contact
                </h4>
                {employee.email ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
                    {employee.email}
                  </div>
                ) : null}
                {employee.phone ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
                    {employee.phone}
                  </div>
                ) : null}
                {employee.date_of_birth ? (
                  <div className="text-muted-foreground text-sm">
                    DOB: {new Date(employee.date_of_birth).toLocaleDateString()}
                  </div>
                ) : null}
              </div>

              {/* License info */}
              <div className="space-y-2">
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Licenses & Insurance
                </h4>
                {employee.license_number ? (
                  <div className="text-sm">
                    License: {employee.license_number}
                    {employee.license_state ? ` (${employee.license_state})` : ''}
                    {employee.license_expiry ? (
                      <span className="text-muted-foreground ml-1">
                        exp. {new Date(employee.license_expiry).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No license on file</p>
                )}
                {employee.insurance_policy_number ? (
                  <div className="text-sm">
                    Insurance: {employee.insurance_policy_number}
                    {employee.insurance_expiry ? (
                      <span className="text-muted-foreground ml-1">
                        exp. {new Date(employee.insurance_expiry).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No insurance on file</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {employee.status === 'pending' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onStatusChange(employee.id, 'active');
                  }}
                  className="min-h-[44px]"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                  Activate
                </Button>
              ) : null}
              {employee.status === 'active' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onStatusChange(employee.id, 'suspended');
                  }}
                  className="min-h-[44px]"
                >
                  <AlertCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                  Suspend
                </Button>
              ) : null}
              {employee.status === 'suspended' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onStatusChange(employee.id, 'active');
                  }}
                  className="min-h-[44px]"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                  Reactivate
                </Button>
              ) : null}
              {employee.status !== 'terminated' ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onRemove(employee.id);
                  }}
                  className="min-h-[44px]"
                >
                  <UserX className="mr-1 h-4 w-4" aria-hidden="true" />
                  Terminate
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmployeeListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-4 p-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function TeamManagementPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const { data, isLoading, error } = useEmployees();
  const updateEmployee = useUpdateEmployee();

  const employees = data?.employees ?? [];

  function handleStatusChange(id: string, status: string) {
    updateEmployee.mutate({ id, data: { status } });
  }

  function handleRemove(id: string) {
    updateEmployee.mutate({ id, data: { status: 'terminated' } });
  }

  if (showAddForm) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add Employee</h1>
            <p className="text-muted-foreground text-sm">Add a new team member to your company.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowAddForm(false);
            }}
            className="min-h-[44px]"
          >
            Back to Team
          </Button>
        </div>
        <AddEmployeeForm />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Management</h1>
          <p className="text-muted-foreground text-sm">
            Manage your company employees and their verification status.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setShowAddForm(true);
          }}
          className="min-h-[44px]"
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Employee
        </Button>
      </div>

      {isLoading ? (
        <EmployeeListSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12">
            <AlertCircle className="text-destructive h-10 w-10" aria-hidden="true" />
            <p className="text-destructive text-sm">Failed to load team members.</p>
            <p className="text-muted-foreground text-xs">Please try again later.</p>
          </CardContent>
        </Card>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Users className="text-muted-foreground h-12 w-12" aria-hidden="true" />
            <h2 className="text-lg font-semibold">No team members yet</h2>
            <p className="text-muted-foreground text-sm">Add your first employee to get started.</p>
            <Button
              type="button"
              onClick={() => {
                setShowAddForm(true);
              }}
              className="mt-2 min-h-[44px]"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add Employee
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onStatusChange={handleStatusChange}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
