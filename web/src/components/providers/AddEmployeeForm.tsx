'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAddEmployee } from '@/hooks/useEmployees';
import { addEmployeeSchema, type AddEmployeeFormValues } from '@/lib/validations';
import { cn } from '@/lib/utils';

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const;

const ACCEPTED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ACCEPTED_DOCUMENT_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.pdf';
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export function AddEmployeeForm() {
  const router = useRouter();
  const addEmployee = useAddEmployee();
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);
  const [idDocumentError, setIdDocumentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const form = useForm<AddEmployeeFormValues>({
    resolver: zodResolver(addEmployeeSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      role: 'technician',
      ssnLastFour: '',
      backgroundCheckConsent: false,
      licenseNumber: '',
      licenseState: '',
      licenseExpiry: '',
      insurancePolicyNumber: '',
      insuranceExpiry: '',
    },
  });

  async function onSubmit(values: AddEmployeeFormValues) {
    await addEmployee.mutateAsync({
      first_name: values.firstName,
      last_name: values.lastName,
      email: values.email || undefined,
      phone: values.phone || undefined,
      date_of_birth: values.dateOfBirth || undefined,
      role: values.role,
      license_number: values.licenseNumber || undefined,
      license_state: values.licenseState || undefined,
      license_expiry: values.licenseExpiry || undefined,
    });
    router.push('/provider/team' as Route);
  }

  function handleCancel() {
    router.push('/provider/team' as Route);
  }

  function handleFileSelect(file: File | undefined) {
    if (!file) return;

    if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
      setIdDocumentError('Please upload a JPG, PNG, WebP, or PDF file.');
      return;
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setIdDocumentError('File exceeds the 10 MB limit.');
      return;
    }

    setIdDocumentError(null);
    setIdDocumentFile(file);
  }

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFileSelect(file);
    },
    [],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      handleFileSelect(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-8">
        {/* Section 1: Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Basic details about the employee.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="given-name" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name *</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="family-name" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        autoComplete="email"
                        placeholder="employee@company.com"
                        className="min-h-[44px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="tel"
                        autoComplete="tel"
                        placeholder="+1 (555) 123-4567"
                        className="min-h-[44px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="technician">Technician</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="apprentice">Apprentice</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Identity Verification */}
        <Card>
          <CardHeader>
            <CardTitle>Identity Verification</CardTitle>
            <CardDescription>
              Required for employees dispatched to customer homes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="ssnLastFour"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSN (Last 4 Digits)</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground" aria-hidden="true">
                        &#8226;&#8226;&#8226;-&#8226;&#8226;-
                      </span>
                      <Input
                        {...field}
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        pattern="\d{4}"
                        placeholder="XXXX"
                        autoComplete="off"
                        className="min-h-[44px] w-24"
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                          field.onChange(digits);
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Only the last 4 digits are stored. Full SSN is never transmitted or saved.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Government ID Upload */}
            <div className="space-y-2">
              <label htmlFor={fileInputId} className="text-sm font-medium leading-none">
                Government-Issued ID
              </label>
              <p className="text-xs text-muted-foreground">
                Upload a driver's license, passport, or state ID. JPG, PNG, WebP, or PDF (max 10
                MB).
              </p>

              {idDocumentFile ? (
                <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
                  <Upload className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{idDocumentFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(idDocumentFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIdDocumentFile(null);
                    }}
                    className="min-h-[44px] min-w-[44px]"
                    aria-label="Remove uploaded file"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload government ID"
                  className={cn(
                    'flex min-h-[80px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-4 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
                  )}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={openFilePicker}
                  onKeyDown={handleKeyDown}
                >
                  <input
                    ref={fileInputRef}
                    id={fileInputId}
                    type="file"
                    accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                    className="sr-only"
                    onChange={handleInputChange}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  <Upload className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    {isDragging ? 'Drop file here' : 'Click or drag file to upload'}
                  </p>
                </div>
              )}

              {idDocumentError ? (
                <p className="text-sm text-destructive" role="alert">
                  {idDocumentError}
                </p>
              ) : null}
            </div>

            <FormField
              control={form.control}
              name="backgroundCheckConsent"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5 min-h-[20px] min-w-[20px]"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="cursor-pointer">Background Check Consent</FormLabel>
                    <FormDescription>
                      I consent to a background check for this employee. A background check is
                      required before they can be dispatched to customer locations.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Section 3: Licenses & Certifications */}
        <Card>
          <CardHeader>
            <CardTitle>Licenses & Certifications</CardTitle>
            <CardDescription>
              Professional licenses and insurance information for this employee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="licenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="LIC-12345" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenseState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License State</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="State" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {US_STATES.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenseExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>License Expiry</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="insurancePolicyNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Policy Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="POL-12345678" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="insuranceExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Expiry</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Actions */}
        <div className="flex gap-3">
          <Button type="submit" disabled={addEmployee.isPending} className="min-h-[44px]">
            {addEmployee.isPending ? 'Adding...' : 'Add Employee'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
