'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  useCreateProperty,
  useDeleteProperty,
  useProperties,
} from '@/hooks/useProperties';
import { propertySchema } from '@/lib/validations';
import { formatCents } from '@/lib/utils';
import type { PropertyFormValues } from '@/lib/validations';

export default function PropertiesPage() {
  const { data: properties, isLoading, isError } = useProperties();
  const createProperty = useCreateProperty();
  const deleteProperty = useDeleteProperty();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      nickname: '',
      address: '',
      city: '',
      state: '',
      zip_code: '',
      notes: '',
    },
  });

  async function onSubmit(values: PropertyFormValues) {
    await createProperty.mutateAsync(values);
    form.reset();
    setShowForm(false);
  }

  function handleDelete(id: string) {
    if (deletingId === id) {
      void deleteProperty.mutateAsync(id).then(() => {
        setDeletingId(null);
      });
    } else {
      setDeletingId(id);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Properties</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your service locations
          </p>
        </div>
        <Button
          onClick={() => { setShowForm(!showForm); }}
          className="min-h-[44px]"
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Property
        </Button>
      </div>

      {/* Add Property Form */}
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add New Property</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="nickname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nickname</FormLabel>
                      <FormControl>
                        <Input placeholder='e.g., "Lake House"' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="WA" maxLength={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="zip_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zip Code</FormLabel>
                        <FormControl>
                          <Input placeholder="98101" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Gate code, access instructions, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    className="min-h-[44px]"
                    disabled={createProperty.isPending}
                  >
                    {createProperty.isPending ? 'Adding...' : 'Add Property'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => {
                      setShowForm(false);
                      form.reset();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : null}

      {/* Properties List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border bg-muted"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 p-8 text-center">
          <p className="text-destructive">
            Failed to load properties. Please try again.
          </p>
        </div>
      ) : !properties?.length ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            No properties added yet. Add your first property to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <Card key={property.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="font-semibold">{property.nickname}</h3>
                  <Button
                    variant={deletingId === property.id ? 'destructive' : 'ghost'}
                    size="sm"
                    className="min-h-[44px] min-w-[44px]"
                    onClick={() => { handleDelete(property.id); }}
                    aria-label={
                      deletingId === property.id
                        ? `Confirm delete ${property.nickname}`
                        : `Delete ${property.nickname}`
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {property.address}, {property.city}, {property.state}{' '}
                  {property.zip_code}
                </p>
                {property.notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {property.notes}
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-3">
                  <Badge variant="secondary">
                    {String(property.active_jobs)} active job
                    {property.active_jobs !== 1 ? 's' : ''}
                  </Badge>
                  <span className="text-sm font-medium">
                    {formatCents(property.total_spend_cents)} spent
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
