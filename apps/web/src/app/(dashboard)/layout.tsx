import { Shell } from "@/components/Shell";
import { QueryProvider } from "@/lib/query";
import { RealtimeProvider } from "@/lib/realtime";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <RealtimeProvider>
        <Shell>{children}</Shell>
      </RealtimeProvider>
    </QueryProvider>
  );
}
