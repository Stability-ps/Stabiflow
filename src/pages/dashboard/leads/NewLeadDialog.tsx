import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createLeadManual, type DuplicateLeadCandidate } from "@/lib/leads";

const SOURCES = ["manual", "website", "referral", "organic", "google_later", "other"];

export function NewLeadDialog({ workspaceId, onCreated }: { workspaceId: string; onCreated: (leadId: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [source, setSource] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateLeadCandidate[] | null>(null);

  const reset = () => {
    setContactName(""); setPhone(""); setEmail(""); setCompanyName(""); setSource("manual"); setDuplicates(null);
  };

  const submit = async (force: boolean) => {
    if (!contactName.trim()) return;
    setBusy(true);
    try {
      const result = await createLeadManual(workspaceId, { contactName: contactName.trim(), phone: phone || undefined, email: email || undefined, companyName: companyName || undefined, source, force });
      if (!result.created && result.duplicates?.length) {
        setDuplicates(result.duplicates);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["leads", workspaceId] });
      toast.success("Lead created");
      setOpen(false);
      reset();
      const lead = result.lead as { id: string } | undefined;
      if (lead?.id) onCreated(lead.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create this lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">New lead</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>Create a lead manually. Unknown fields can be filled in later.</DialogDescription>
        </DialogHeader>

        {duplicates ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Possible existing lead</p>
            <p className="text-xs text-muted-foreground">A lead with a matching phone number already exists.</p>
            {duplicates.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-medium">{d.contact_name || d.phone || d.human_reference}</p>
                  <p className="text-xs text-muted-foreground">{d.human_reference}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setOpen(false); reset(); onCreated(d.id); }}>Open existing</Button>
              </div>
            ))}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDuplicates(null)}>Back</Button>
              <Button variant="outline" onClick={() => submit(true)} disabled={busy}>Create new anyway</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button onClick={() => submit(false)} disabled={busy || !contactName.trim()}>Create lead</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
