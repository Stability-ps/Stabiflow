import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Plus, UsersRound } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Metric } from "@/components/ui/metric";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addCreatorPost, createCreatorCampaign, creatorMoney, listCreatorCampaignPerformance, type CreatorCampaignPerformance, type CreatorPlatform } from "@/lib/creatorCampaigns";

const PLATFORMS: CreatorPlatform[]=["instagram","youtube","tiktok","facebook","other"];
const number=(v:string)=>Math.max(0,Number(v)||0);
const metric=(v:number|null,suffix="")=>v==null?"—":`${v.toLocaleString(undefined,{maximumFractionDigits:2})}${suffix}`;

export function CreatorCampaignsSection({ workspaceId, canSeeRevenue }: { workspaceId:string; canSeeRevenue:boolean }) {
  const { user, hasPermission }=useAuth();
  const qc=useQueryClient();
  const [newOpen,setNewOpen]=useState(false);
  const [postCampaign,setPostCampaign]=useState<CreatorCampaignPerformance|null>(null);
  const [campaign,setCampaign]=useState({name:"",creator_name:"",creator_handle:"",platform:"instagram" as CreatorPlatform,fee:"",currency:"USD",videos:"30"});
  const [post,setPost]=useState({url:"",title:"",views:"",impressions:"",clicks:"",installs:"",leads:"",customers:"",revenue:""});
  const query=useQuery({queryKey:["creator-campaigns",workspaceId],queryFn:()=>listCreatorCampaignPerformance(workspaceId)});
  const canCreate=hasPermission("campaign.create");

  const create=useMutation({
    mutationFn:()=>createCreatorCampaign({workspace_id:workspaceId,name:campaign.name.trim(),creator_name:campaign.creator_name.trim(),creator_handle:campaign.creator_handle.trim()||null,platform:campaign.platform,fee_minor_units:Math.round(number(campaign.fee)*100),currency:campaign.currency.toUpperCase(),contracted_videos:Math.max(1,Math.round(number(campaign.videos))),start_date:null,end_date:null,status:"active",created_by:user!.id}),
    onSuccess:()=>{qc.invalidateQueries({queryKey:["creator-campaigns",workspaceId]});setNewOpen(false);setCampaign({name:"",creator_name:"",creator_handle:"",platform:"instagram",fee:"",currency:"USD",videos:"30"});toast.success("Creator campaign created");},
    onError:(e:Error)=>toast.error(e.message),
  });
  const addPost=useMutation({
    mutationFn:()=>addCreatorPost({workspace_id:workspaceId,campaign_id:postCampaign!.id,platform:postCampaign!.platform,post_url:post.url.trim()||null,title:post.title.trim()||null,published_at:new Date().toISOString(),views:Math.round(number(post.views)),impressions:Math.round(number(post.impressions)),clicks:Math.round(number(post.clicks)),installs:Math.round(number(post.installs)),leads:Math.round(number(post.leads)),paid_customers:Math.round(number(post.customers)),revenue_minor_units:Math.round(number(post.revenue)*100)}),
    onSuccess:()=>{qc.invalidateQueries({queryKey:["creator-campaigns",workspaceId]});setPostCampaign(null);setPost({url:"",title:"",views:"",impressions:"",clicks:"",installs:"",leads:"",customers:"",revenue:""});toast.success("Creator post added");},
    onError:(e:Error)=>toast.error(e.message),
  });
  const totals=useMemo(()=>(query.data??[]).reduce((a,c)=>({fee:a.fee+c.fee_minor_units,views:a.views+c.views,installs:a.installs+c.installs,customers:a.customers+c.paidCustomers,revenue:a.revenue+c.revenueMinor}),{fee:0,views:0,installs:0,customers:0,revenue:0}),[query.data]);

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h2 className="text-title-section text-foreground">Creator campaigns</h2><p className="text-sm text-muted-foreground">Track creator fees, contracted videos, views and the customers and revenue those videos generate.</p></div>
      {canCreate&&<Button onClick={()=>setNewOpen(true)}><Plus aria-hidden="true"/>New creator campaign</Button>}
    </div>
    {query.isLoading?<div className="h-32 animate-pulse rounded-xl bg-muted"/>:query.isError?
      <EmptyState icon={AlertTriangle} title="Couldn't load creator campaigns" description="Something went wrong fetching your creator deals. Nothing has changed - try again." action={<Button variant="outline" onClick={()=>void query.refetch()}>Try again</Button>} className="rounded-xl border border-border bg-card"/>:query.data?.length===0?
      <EmptyState icon={UsersRound} title="No creator campaigns yet" description="Add a paid creator deal, then record each delivered video and its results." className="rounded-xl border border-border bg-card"/>:
      <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {[["Creator spend",creatorMoney(totals.fee,query.data?.[0]?.currency??"USD")],["Views",totals.views.toLocaleString()],["Installs",totals.installs.toLocaleString()],["Paid customers",totals.customers.toLocaleString()],["Revenue",canSeeRevenue?creatorMoney(totals.revenue,query.data?.[0]?.currency??"USD"):"Restricted"]].map(([l,v])=><Metric key={l} label={l} state={{kind:"value",value:v}}/>)}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">{query.data?.map(c=><Card key={c.id} className="overflow-hidden"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{c.creator_name}<span className="ml-2 text-sm font-normal text-muted-foreground">{c.creator_handle||""}</span></CardTitle><p className="mt-1 text-xs capitalize text-muted-foreground">{c.platform} · {c.name}</p></div><span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{c.status}</span></div></CardHeader><CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm min-[420px]:grid-cols-3"><div><p className="text-muted-foreground">Investment</p><b>{creatorMoney(c.fee_minor_units,c.currency)}</b></div><div><p className="text-muted-foreground">Delivered</p><b>{c.delivered}/{c.contracted_videos}</b></div><div><p className="text-muted-foreground">Views</p><b>{c.views.toLocaleString()}</b></div><div><p className="text-muted-foreground">CPM</p><b>{creatorMoney(c.cpmMinor,c.currency)}</b></div><div><p className="text-muted-foreground">Cost/install</p><b>{creatorMoney(c.cpiMinor,c.currency)}</b></div><div><p className="text-muted-foreground">CAC</p><b>{creatorMoney(c.cacMinor,c.currency)}</b></div>{canSeeRevenue&&<><div><p className="text-muted-foreground">Revenue</p><b>{creatorMoney(c.revenueMinor,c.currency)}</b></div><div><p className="text-muted-foreground">RPM</p><b>{creatorMoney(c.rpmMinor,c.currency)}</b></div><div><p className="text-muted-foreground">Return</p><b>{metric(c.roas,"×")}</b></div></>}</div>
          <div className="rounded-lg border border-border bg-background p-3"><div className="flex items-center justify-between"><p className="text-xs font-medium">Views → installs → paid</p><p className="text-xs text-muted-foreground">{metric(c.viewToInstallRate,"%")} · {metric(c.installToPaidRate,"%")}</p></div><div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground"><span>{c.views.toLocaleString()} views</span><span>→</span><span>{c.installs.toLocaleString()} installs</span><span>→</span><span>{c.paidCustomers.toLocaleString()} paid</span></div></div>
          {c.posts.length>0&&<div className="space-y-2">{c.posts.slice(0,3).map((p,i)=><div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"><span className="truncate">{p.title||`Video ${i+1}`}</span><span className="shrink-0 text-muted-foreground">{p.views.toLocaleString()} views · {p.paid_customers} paid {p.post_url&&<a className="ml-1 inline-block" href={p.post_url} target="_blank" rel="noreferrer" aria-label={`Open ${p.title||`video ${i+1}`}`}><ExternalLink className="h-3 w-3" aria-hidden="true"/></a>}</span></div>)}</div>}
          {canCreate&&<Button variant="outline" size="sm" onClick={()=>setPostCampaign(c)}><Plus aria-hidden="true"/>Add delivered video</Button>}
        </CardContent></Card>)}</div>
      </>}
    <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent><DialogHeader><DialogTitle>New creator campaign</DialogTitle><DialogDescription>The fee is what you pay the creator for the contracted content, not ad spend.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{[["Campaign name","name"],["Creator name","creator_name"],["Creator handle","creator_handle"],["Creator fee","fee"],["Currency","currency"],["Videos contracted","videos"]].map(([l,k])=><div key={k}><Label htmlFor={`cc-${k}`}>{l}</Label><Input id={`cc-${k}`} value={(campaign as any)[k]} onChange={e=>setCampaign({...campaign,[k]:e.target.value})}/></div>)}<div><Label htmlFor="cc-platform">Platform</Label><Select value={campaign.platform} onValueChange={v=>setCampaign({...campaign,platform:v as CreatorPlatform})}><SelectTrigger id="cc-platform"><SelectValue/></SelectTrigger><SelectContent>{PLATFORMS.map(p=><SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button disabled={!campaign.name.trim()||!campaign.creator_name.trim()||create.isPending} onClick={()=>create.mutate()}>Create campaign</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!postCampaign} onOpenChange={o=>!o&&setPostCampaign(null)}><DialogContent><DialogHeader><DialogTitle>Add delivered video</DialogTitle><DialogDescription>Paste the post and its latest performance. API sync can replace manual metric entry once that platform is connected.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{[["Post URL","url"],["Title","title"],["Views","views"],["Impressions","impressions"],["Clicks","clicks"],["Installs","installs"],["Leads","leads"],["Paid customers","customers"],["Revenue","revenue"]].map(([l,k])=><div key={k} className={k==="url"||k==="title"?"sm:col-span-2":""}><Label htmlFor={`cp-${k}`}>{l}</Label><Input id={`cp-${k}`} value={(post as any)[k]} onChange={e=>setPost({...post,[k]:e.target.value})}/></div>)}</div><DialogFooter><Button disabled={addPost.isPending} onClick={()=>addPost.mutate()}>Save video performance</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
