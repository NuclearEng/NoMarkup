'use client';

import { MapPin } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProperties, type Property } from '@/hooks/useProperties';
import type { JobFormType } from '@/components/forms/job-posting/types';

const NONE_PROPERTY_VALUE = '__none__';

function formatPropertyAddress(property: Property): string {
  const { street, city, state, zip_code } = property.address;
  return `${street}, ${city}, ${state} ${zip_code}`;
}

function applyPropertyToForm(form: JobFormType, property: Property): void {
  form.setValue('locationAddress', formatPropertyAddress(property), {
    shouldDirty: true,
    shouldValidate: true,
  });
  if (property.address.latitude !== undefined) {
    form.setValue('locationLat', property.address.latitude);
  }
  if (property.address.longitude !== undefined) {
    form.setValue('locationLng', property.address.longitude);
  }
}

export function StepLocation({
  form,
  selectedPropertyId,
  onPropertyChange,
}: {
  form: JobFormType;
  selectedPropertyId: string;
  onPropertyChange: (propertyId: string) => void;
}) {
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapboxToken = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';
  const { data: properties, isLoading: propertiesLoading } = useProperties();

  const lat = form.watch('locationLat');
  const lng = form.watch('locationLng');
  const hasCoords = lat !== undefined && lng !== undefined && lat !== 0 && lng !== 0;

  const geocodeAddress = useCallback(
    (address: string) => {
      if (!address || address.length < 5 || !mapboxToken) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void (async () => {
        setGeocoding(true);
        setGeocodeError(null);
        try {
          const encoded = encodeURIComponent(address);
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${mapboxToken}&country=US&limit=1&types=address`,
          );
          if (!res.ok) throw new Error('Geocoding failed');
          const data = (await res.json()) as {
            features: Array<{
              center: [number, number];
              place_name: string;
            }>;
          };
          const feature = data.features[0];
          if (feature) {
            const [lngResult, latResult] = feature.center;
            form.setValue('locationLat', latResult);
            form.setValue('locationLng', lngResult);
            setGeocodeError(null);
          } else {
            setGeocodeError('Address not found. Try a more specific address.');
          }
        } catch {
          setGeocodeError('Could not look up address. Check your connection.');
        } finally {
          setGeocoding(false);
        }
        })();
      }, 600);
    },
    [mapboxToken, form],
  );

  // Inherit address when a property is preselected via ?property_id= and
  // the list arrives (or when the field is still empty).
  useEffect(() => {
    if (!selectedPropertyId || !properties || properties.length === 0) return;
    const property = properties.find((p) => p.id === selectedPropertyId);
    if (!property) return;
    if (form.getValues('locationAddress')) return;
    applyPropertyToForm(form, property);
    if (property.address.latitude === undefined || property.address.longitude === undefined) {
      geocodeAddress(formatPropertyAddress(property));
    }
  }, [selectedPropertyId, properties, form, geocodeAddress]);

  function handlePropertySelect(value: string) {
    if (value === NONE_PROPERTY_VALUE) {
      onPropertyChange('');
      return;
    }
    onPropertyChange(value);
    const property = properties?.find((p) => p.id === value);
    if (!property) return;
    applyPropertyToForm(form, property);
    if (property.address.latitude === undefined || property.address.longitude === undefined) {
      geocodeAddress(formatPropertyAddress(property));
    }
  }

  const hasProperties = (properties?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {propertiesLoading ? (
        <Skeleton className="h-11 w-full" />
      ) : hasProperties ? (
        <div className="space-y-2">
          <label htmlFor="job-property" className="text-sm font-medium">
            Saved property
          </label>
          <Select
            value={selectedPropertyId || NONE_PROPERTY_VALUE}
            onValueChange={handlePropertySelect}
          >
            <SelectTrigger id="job-property" className="min-h-[44px]" aria-label="Saved property">
              <SelectValue placeholder="Use a saved property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_PROPERTY_VALUE}>Enter address manually</SelectItem>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.nickname} — {property.address.street}, {property.address.city}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            Choosing a property fills the service address. You can still edit it.
          </p>
        </div>
      ) : null}

      <FormField
        control={form.control}
        name="locationAddress"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Service Address</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="123 Main St, City, State, ZIP"
                className="min-h-[44px]"
                onChange={(e) => {
                  field.onChange(e);
                  geocodeAddress(e.target.value);
                }}
              />
            </FormControl>
            <FormDescription>
              {geocoding
                ? 'Looking up address...'
                : 'Where should the service provider come? Leave blank for remote work.'}
            </FormDescription>
            {geocodeError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {geocodeError}
              </div>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />

      {geocoding ? (
        <div
          className="space-y-2 rounded-md border p-3"
          role="status"
          aria-label="Looking up address"
        >
          <Skeleton className="h-[200px] w-full" variant="card" />
          <Skeleton className="h-3 w-40" variant="text" />
        </div>
      ) : hasCoords ? (
        <div className="relative overflow-hidden rounded-md border">
          <img
            src={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-l+d4a017(${String(lng)},${String(lat)})/${String(lng)},${String(lat)},14,0/600x300@2x?access_token=${mapboxToken}`}
            alt="Map preview of service location"
            className="h-[200px] w-full object-cover"
            loading="lazy"
          />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-zinc-900/80 px-2.5 py-1 font-mono text-xs tabular-nums text-zinc-200 backdrop-blur-sm">
            <MapPin className="h-3 w-3 text-[var(--brand-gold)]" aria-hidden="true" />
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-md border p-8 text-center text-sm">
          <MapPin className="h-6 w-6 opacity-40" aria-hidden="true" />
          {mapboxToken
            ? 'Enter an address above to see a map preview'
            : 'Map preview unavailable — Mapbox token not configured'}
        </div>
      )}
    </div>
  );
}
