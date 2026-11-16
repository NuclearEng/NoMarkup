import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';

interface FileDisputeInput {
  contract_id: string;
  reason: string;
  description: string;
  evidence_urls: string[];
}

interface FileDisputeResponse {
  dispute_id: string;
  status: string;
}

// Mirrors the gateway's standalone GET /api/v1/disputes/{id} response, which
// marshals the contract-service Dispute (id, opened_by, dispute_type,
// description) plus the legacy aliases (initiated_by, reason) the UI reads.
interface DisputeRecord {
  id: string;
  contract_id: string;
  opened_by: string;
  initiated_by: string;
  dispute_type: string;
  reason: string;
  description: string;
  evidence_urls: string[];
  status: string;
  created_at: string;
}

interface GetDisputeResponse {
  dispute: DisputeRecord;
}

export function useFileDispute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FileDisputeInput) =>
      api.post<FileDisputeResponse>('/api/v1/disputes', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to file dispute. Please try again.'));
    },
  });
}

export function useDispute(id: string) {
  return useQuery({
    queryKey: ['dispute', id],
    queryFn: () =>
      api.get<GetDisputeResponse>(`/api/v1/disputes/${id}`),
    enabled: !!id,
  });
}
