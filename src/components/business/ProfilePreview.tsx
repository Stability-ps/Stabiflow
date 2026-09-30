import type { CSSProperties } from "react";
import { textOn, type ProfileContent } from "@/lib/businessStudio";

function Section({ title, accent, primary, serif, children }: { title: string; accent: string; primary: string; serif: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className={`text-lg font-bold ${serif ? "font-serif" : ""}`} style={{ color: primary }}>
        {title}
      </h3>
      <div className="h-0.5 w-8" style={{ background: accent }} />
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  );
}

/**
 * Live HTML preview of the company profile, built from the SAME content
 * object the PDF renderer uses. Plain text only (React escapes everything);
 * a close visual match to the PDF, not a pixel copy.
 */
export function ProfilePreview({ content: c, layout, serif, watermark }: { content: ProfileContent; layout: "band" | "sidebar" | "minimal"; serif: boolean; watermark: boolean }) {
  const { primary, accent } = c.brand;
  const onPrimary = textOn(primary);
  const coverStyle: CSSProperties = layout === "band" ? { background: primary, color: onPrimary } : {};
  const services = c.offerings.every((o) => o.kind === "product") ? "Our products" : "What we do";

  return (
    <div className="relative overflow-hidden rounded-md border bg-white text-[#212329] shadow-sm" aria-label="Profile preview">
      {watermark && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden="true">
          <span className="-rotate-45 select-none text-7xl font-bold text-gray-400/30">PREVIEW</span>
        </div>
      )}
      <div className={layout === "sidebar" ? "grid grid-cols-[36%_1fr]" : ""}>
        {layout === "sidebar" && <div style={{ background: primary }} />}
        <div className="space-y-2 p-6 sm:p-8" style={coverStyle}>
          {layout === "minimal" && <div className="h-1 w-14" style={{ background: accent }} />}
          <h2 className={`break-words text-3xl font-bold ${serif ? "font-serif" : ""}`} style={{ color: layout === "band" ? onPrimary : primary }}>
            {c.name}
          </h2>
          {c.tagline && <p className="text-base opacity-90">{c.tagline}</p>}
          <p className="text-xs font-bold tracking-wide" style={{ color: layout === "band" ? onPrimary : accent }}>
            COMPANY PROFILE
          </p>
        </div>
      </div>
      {layout === "band" && <div className="h-1.5" style={{ background: accent }} />}
      <div className={`space-y-6 p-6 sm:p-8 ${layout === "sidebar" ? "border-l-[14px]" : ""}`} style={layout === "sidebar" ? { borderColor: primary } : undefined}>
        {c.shortDescription && <p className="font-semibold">{c.shortDescription}</p>}
        {(c.about || c.industry || c.foundedYear) && (
          <Section title="About us" accent={accent} primary={primary} serif={serif}>
            {c.about?.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
            {(c.industry || c.foundedYear) && (
              <p className="text-xs text-gray-500">
                {[c.industry && `Industry: ${c.industry}`, c.foundedYear && `Established: ${c.foundedYear}`].filter(Boolean).join("   ")}
              </p>
            )}
          </Section>
        )}
        {(c.mission || c.vision || c.values.length > 0) && (
          <Section title="Mission, vision and values" accent={accent} primary={primary} serif={serif}>
            {c.mission && <p><span className="font-semibold">Mission: </span>{c.mission}</p>}
            {c.vision && <p><span className="font-semibold">Vision: </span>{c.vision}</p>}
            {c.values.length > 0 && <p><span className="font-semibold">Values: </span>{c.values.join(" · ")}</p>}
          </Section>
        )}
        {c.offerings.length > 0 && (
          <Section title={services} accent={accent} primary={primary} serif={serif}>
            {c.offerings.map((o) => (
              <div key={o.name}>
                <p className="font-semibold">{o.name}</p>
                {o.price && <p className="text-xs text-gray-500">{o.price}</p>}
                {o.description && <p>{o.description}</p>}
              </div>
            ))}
          </Section>
        )}
        {c.projects.length > 0 && (
          <Section title="Selected projects" accent={accent} primary={primary} serif={serif}>
            {c.projects.map((p) => (
              <div key={p.title}>
                <p className="font-semibold">{p.title}</p>
                <p className="text-xs text-gray-500">{[p.client, p.location, p.year].filter(Boolean).join(" | ")}</p>
                {p.description && <p>{p.description}</p>}
              </div>
            ))}
          </Section>
        )}
        {c.team.length > 0 && (
          <Section title="Our team" accent={accent} primary={primary} serif={serif}>
            {c.team.map((t) => (
              <p key={t.name}>
                <span className="font-semibold">{t.name}</span>
                {t.role ? ` - ${t.role}` : ""}
              </p>
            ))}
          </Section>
        )}
        {(c.certifications.length > 0 || c.identifiers.length > 0) && (
          <Section title="Credentials" accent={accent} primary={primary} serif={serif}>
            {c.certifications.map((x) => <p key={x.name}><span className="font-semibold">{x.name}</span>{x.issuer ? ` - ${x.issuer}` : ""}</p>)}
            {c.identifiers.map((x) => <p key={x.label}><span className="font-semibold">{x.label}: </span>{x.value}</p>)}
          </Section>
        )}
        <Section title="Contact us" accent={accent} primary={primary} serif={serif}>
          {c.contacts.map((k) => <p key={`${k.kind}-${k.value}`}>{k.label ?? k.kind}: {k.value}</p>)}
          {c.website && <p>Website: {c.website}</p>}
          {c.locations.map((l) => <p key={l}>{l}</p>)}
        </Section>
      </div>
    </div>
  );
}
