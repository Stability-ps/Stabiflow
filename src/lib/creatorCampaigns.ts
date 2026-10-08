import { supabase } from "@/integrations/supabase/client";

export type CreatorPlatform = "instagram" | "youtube" | "tiktok" | "facebook" | "other";

export type CreatorCampaign = {
  id: string; workspace_id: string; name: string; creator_name: string; creator_handle: string | null;
  platform: CreatorPlatform; fee_minor_units: number; currency: string; contracted_videos: number;
  start_date: string | null; end_date: string | null; status: "draft" | "active" | "completed" | "paused";
  created_at: string;
};

export type CreatorPost = {
  id: string; workspace_id: string; campaign_id: string; platform: string; post_url: string | null;
  title: string | null; published_at: string | null; views: number; impressions: number; clicks: number;
  installs: number; leads: number; paid_customers: number; revenue_minor_units: number; last_synced_at: string | null;
};

export type CreatorCampaignPerformance = CreatorCampaign & {
  posts: CreatorPost[]; delivered: number; views: number; impressions: number; clicks: number; installs: number;
  leads: number; paidCustomers: number; revenueMinor: number; costPerVideoMinor: number | null; cpmMinor: number | null;
  cpiMinor: number | null; cacMinor: number | null; rpmMinor: number | null; roas: number | null;
  viewToInstallRate: number | null; installToPaidRate: number | null;
};

const db = supabase as any;

export async function listCreatorCampaignPerformance(workspaceId: string): Promise<CreatorCampaignPerformance[]> {
  const [{ data: campaigns, error: ce }, { data: posts, error: pe }] = await Promise.all([
    db.from("creator_campaigns").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    db.from("creator_campaign_posts").select("*").eq("workspace_id", workspaceId),
  ]);
  if (ce) throw new Error(ce.message);
  if (pe) throw new Error(pe.message);
  return (campaigns ?? []).map((campaign: CreatorCampaign) => {
    const rows = (posts ?? []).filter((p: CreatorPost) => p.campaign_id === campaign.id);
    const sum = (key: keyof CreatorPost) => rows.reduce((n: number, p: CreatorPost) => n + Number(p[key] ?? 0), 0);
    const views=sum("views"), installs=sum("installs"), paidCustomers=sum("paid_customers"), revenueMinor=sum("revenue_minor_units");
    const fee=Number(campaign.fee_minor_units);
    return {
      ...campaign, posts: rows, delivered: rows.length, views, impressions: sum("impressions"), clicks: sum("clicks"),
      installs, leads: sum("leads"), paidCustomers, revenueMinor,
      costPerVideoMinor: campaign.contracted_videos ? fee / campaign.contracted_videos : null,
      cpmMinor: views ? fee / views * 1000 : null,
      cpiMinor: installs ? fee / installs : null,
      cacMinor: paidCustomers ? fee / paidCustomers : null,
      rpmMinor: views ? revenueMinor / views * 1000 : null,
      roas: fee ? revenueMinor / fee : null,
      viewToInstallRate: views ? installs / views * 100 : null,
      installToPaidRate: installs ? paidCustomers / installs * 100 : null,
    };
  });
}

export async function createCreatorCampaign(input: Omit<CreatorCampaign, "id"|"created_at"> & { created_by: string }) {
  const { data, error } = await db.from("creator_campaigns").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CreatorCampaign;
}

export async function addCreatorPost(input: Omit<CreatorPost, "id"|"last_synced_at">) {
  const { data, error } = await db.from("creator_campaign_posts").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CreatorPost;
}

export function creatorMoney(minor: number | null, currency: string) {
  if (minor == null) return "—";
  try { return new Intl.NumberFormat(undefined,{style:"currency",currency,maximumFractionDigits:2}).format(minor/100); }
  catch { return `${currency} ${(minor/100).toFixed(2)}`; }
}
