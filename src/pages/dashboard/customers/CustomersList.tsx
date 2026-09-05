import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Contact } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useCustomersSearch } from "@/hooks/useCustomers";
import { formatMinor } from "@/lib/customer";

export default function CustomersList() {
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const canView = roleHasPermission(currentMembership?.role, "opportunity.view");
  const [query, setQuery] = useState("");
  const { data, isLoading } = useCustomersSearch(canView ? currentWorkspaceId : null, query);

  if (!canView) {
    return <EmptyState icon={Contact} title="Customers" description="You don't have permission to view customers in this workspace." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">Everyone who became a customer, with their conversations, opportunities and revenue in one place.</p>
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, email or company..." className="max-w-sm" />

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Contact} title={query ? "No matches" : "No customers yet"} description={query ? "Try a different search." : "A customer record is created when an opportunity is marked won."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Opps</th>
                <th className="px-3 py-2 font-medium">Revenue</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40" onClick={() => navigate(`/app/customers/${c.id}`)}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{c.name}</span>
                    {c.status !== "active" && <span className="ml-1.5 text-xs text-muted-foreground capitalize">({c.status})</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.phone || c.email || "-"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.company_name || "-"}</td>
                  <td className="px-3 py-2 tabular-nums">{c.open_opportunities}/{c.total_opportunities}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.revenue_by_currency.length === 0 ? "-" : c.revenue_by_currency.map((r) => formatMinor(r.currency, r.total_minor)).join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.last_interaction ? new Date(c.last_interaction).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
