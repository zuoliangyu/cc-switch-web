import { Loader2 } from "lucide-react";
import { SubscriptionQuotaView } from "@/components/SubscriptionQuotaFooter";
import { useCodexOauthQuotaByAccountId } from "@/lib/query/subscription";

export default function CodexOauthAccountQuota({
  accountId,
}: {
  accountId: string;
}) {
  const {
    data: quota,
    isFetching: loading,
    refetch,
  } = useCodexOauthQuotaByAccountId(accountId);

  if (loading && !quota) {
    return (
      <div className="mt-3 flex items-center justify-center rounded-xl border border-border-default bg-card py-5 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SubscriptionQuotaView
      quota={quota}
      loading={loading}
      refetch={refetch}
      appIdForExpiredHint="codex_oauth"
    />
  );
}
