import type { ProviderMeta } from "@/types";
import { useXaiOauthQuota } from "@/lib/query/subscription";
import { SubscriptionQuotaView } from "@/components/SubscriptionQuotaFooter";

interface XaiOauthQuotaFooterProps {
  meta?: ProviderMeta;
  inline?: boolean;
  isCurrent?: boolean;
}

export default function XaiOauthQuotaFooter({
  meta,
  inline = false,
  isCurrent = false,
}: XaiOauthQuotaFooterProps) {
  const {
    data: quota,
    isFetching: loading,
    refetch,
  } = useXaiOauthQuota(meta, { enabled: true, autoQuery: isCurrent });

  return (
    <SubscriptionQuotaView
      quota={quota}
      loading={loading}
      refetch={refetch}
      appIdForExpiredHint="xai_oauth"
      inline={inline}
    />
  );
}
