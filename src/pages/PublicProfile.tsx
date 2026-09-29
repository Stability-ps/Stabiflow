import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Globe, Loader2, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchPublicProfile, safeHref, textOn, whatsappHref } from "@/lib/businessStudio";

const HEX = /^#[0-9a-f]{6}$/i;

// Public hosted business profile. Renders only what the server-side
// get_public_business_profile() returned (published + entitled + public
// facts). All text is rendered as text by React; only validated http(s),
// mailto:, tel: and wa.me links are produced.
export default function PublicProfile() {
  const { slug = "" } = useParams();
  const q = useQuery({ queryKey: ["public-profile", slug], queryFn: () => fetchPublicProfile(slug), retry: false });
  const name = q.data?.profile.identity.name;

  useEffect(() => {
    if (name) document.title = `${name} - Company Profile`;
  }, [name]);

  if (q.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Profile not found</h1>
        <p className="text-sm text-muted-foreground">This business profile doesn't exist or isn't published.</p>
      </div>
    );
  }

  const { profile: p, logoUrl, documentUrl } = q.data;
  const primary = p.brand?.primary && HEX.test(p.brand.primary) ? p.brand.primary : "#1F3A5F";
  const accent = p.brand?.accent && HEX.test(p.brand.accent) ? p.brand.accent : "#E0A526";
  const onPrimary = textOn(primary);
  const website = safeHref(p.identity.website);
  const phone = p.contacts.find((c) => c.kind === "phone")?.value;
  const email = p.contacts.find((c) => c.kind === "email" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.value))?.value;
  const wa = p.contacts.find((c) => c.kind === "whatsapp")?.value;
  const waHref = wa ? whatsappHref(wa, `Hi ${p.identity.name ?? ""}, I found your business profile and would like to enquire.`) : null;
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="min-h-screen bg-white text-[#212329]">
      <header style={{ background: primary, color: onPrimary }}>
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
          {logoUrl && <img src={logoUrl} alt={`${p.identity.name} logo`} className="h-20 w-auto max-w-[160px] rounded bg-white object-contain p-2" />}
          <div className="min-w-0">
            <h1 className="break-words text-3xl font-bold sm:text-4xl">{p.identity.name}</h1>
            {p.identity.tagline && <p className="mt-1 text-lg opacity-90">{p.identity.tagline}</p>}
          </div>
        </div>
        <div className="h-1.5" style={{ background: accent }} />
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:px-6">
        {p.show_enquiry && (waHref || email || telHref) && (
          <div className="flex flex-wrap gap-2">
            {waHref && (
              <Button asChild style={{ background: primary, color: onPrimary }}>
                <a href={waHref} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" /> WhatsApp us</a>
              </Button>
            )}
            {email && (
              <Button asChild variant="outline">
                <a href={`mailto:${email}?subject=${encodeURIComponent("Enquiry")}`}><Mail className="mr-2 h-4 w-4" /> Email us</a>
              </Button>
            )}
            {telHref && (
              <Button asChild variant="outline">
                <a href={telHref}><Phone className="mr-2 h-4 w-4" /> Call us</a>
              </Button>
            )}
            {documentUrl && (
              <Button asChild variant="outline">
                <a href={documentUrl} rel="noopener noreferrer"><Download className="mr-2 h-4 w-4" /> Download company profile</a>
              </Button>
            )}
          </div>
        )}

        {(p.identity.short_description || p.identity.long_description) && (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold" style={{ color: primary }}>About us</h2>
            {p.identity.short_description && <p className="text-lg font-medium">{p.identity.short_description}</p>}
            {p.identity.long_description?.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
            <p className="text-sm text-gray-500">
              {[p.identity.industry, p.identity.founded_year && `Established ${p.identity.founded_year}`].filter(Boolean).join(" · ")}
            </p>
          </section>
        )}

        {(p.identity.mission || p.identity.vision || (p.identity.core_values ?? []).length > 0) && (
          <section className="grid gap-4 sm:grid-cols-3">
            {p.identity.mission && <div><h3 className="font-semibold" style={{ color: primary }}>Mission</h3><p className="text-sm">{p.identity.mission}</p></div>}
            {p.identity.vision && <div><h3 className="font-semibold" style={{ color: primary }}>Vision</h3><p className="text-sm">{p.identity.vision}</p></div>}
            {(p.identity.core_values ?? []).length > 0 && <div><h3 className="font-semibold" style={{ color: primary }}>Values</h3><p className="text-sm">{p.identity.core_values!.join(" · ")}</p></div>}
          </section>
        )}

        {p.offerings.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold" style={{ color: primary }}>{p.offerings.every((o) => o.kind === "product") ? "Our products" : "What we do"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {p.offerings.map((o) => (
                <div key={o.name} className="rounded-md border p-4" style={{ borderTop: `3px solid ${accent}` }}>
                  <h3 className="font-semibold">{o.name}</h3>
                  {o.price_text && <p className="text-sm text-gray-500">{o.price_text}</p>}
                  {o.description && <p className="mt-1 text-sm">{o.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {p.projects.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold" style={{ color: primary }}>Projects</h2>
            {p.projects.map((x) => (
              <div key={x.title}>
                <h3 className="font-semibold">{x.title}</h3>
                <p className="text-sm text-gray-500">{[x.client_name, x.location, x.completed_year].filter(Boolean).join(" · ")}</p>
                {x.description && <p className="text-sm">{x.description}</p>}
              </div>
            ))}
          </section>
        )}

        {p.team.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold" style={{ color: primary }}>Our team</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {p.team.map((t) => (
                <div key={t.full_name}>
                  <p className="font-semibold">{t.full_name}</p>
                  {t.role_title && <p className="text-sm text-gray-500">{t.role_title}</p>}
                  {t.bio && <p className="text-sm">{t.bio}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {(p.certifications.length > 0 || p.identifiers.length > 0) && (
          <section className="space-y-2">
            <h2 className="text-2xl font-semibold" style={{ color: primary }}>Credentials</h2>
            {p.certifications.map((c) => <p key={c.name}><span className="font-semibold">{c.name}</span>{c.issuer ? ` - ${c.issuer}` : ""}</p>)}
            {p.identifiers.map((i) => <p key={i.scheme} className="text-sm">{i.scheme.replace(/^za_/, "").replace(/_/g, " ").toUpperCase()}: {i.value}</p>)}
          </section>
        )}

        <section className="space-y-2 rounded-md p-5" style={{ background: "#f6f7f9" }}>
          <h2 className="text-2xl font-semibold" style={{ color: primary }}>Contact</h2>
          {p.contacts.map((c) => <p key={`${c.kind}-${c.value}`} className="text-sm">{c.label ?? c.kind}: {c.value}</p>)}
          {p.locations.map((l, i) => (
            <p key={i} className="flex items-start gap-1 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{[l.label, l.address_line1, l.address_line2, l.city, l.region, l.postal_code].filter(Boolean).join(", ")}</p>
          ))}
          {website && <p className="flex items-center gap-1 text-sm"><Globe className="h-4 w-4" /><a className="underline" href={website} target="_blank" rel="noopener noreferrer nofollow">{p.identity.website}</a></p>}
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {p.social_links.map((s) => {
              const href = safeHref(s.url);
              return href ? <a key={s.url} className="underline" href={href} target="_blank" rel="noopener noreferrer nofollow">{s.platform}</a> : null;
            })}
          </div>
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-gray-500">
        Business profile hosted by <a className="underline" href="/">StabiFlow</a>
      </footer>
    </div>
  );
}
