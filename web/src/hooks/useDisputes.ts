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

interface DisputeRecord {
  dispute_id: string;
  contract_id: string;
  reason: string;
  description: string;
  evidence_urls: string[];
  created_by: string;
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
