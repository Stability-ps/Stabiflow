import { Fragment } from "react";
import { parseLegalMarkdown, type Inline } from "@/lib/legal";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "bold" ? (
          <strong key={i}>{p.text}</strong>
        ) : p.kind === "link" ? (
          <a key={i} href={p.href} className="underline" {...(p.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Renders admin-published legal text as React elements - never as raw HTML. */
export function LegalMarkdown({ source }: { source: string }) {
  return (
    <>
      {parseLegalMarkdown(source).map((b, i) => {
        if (b.kind === "h2") return <h2 key={i}><Inlines parts={b.inline} /></h2>;
        if (b.kind === "h3") return <h3 key={i} className="font-semibold"><Inlines parts={b.inline} /></h3>;
        if (b.kind === "ul")
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}><Inlines parts={it} /></li>
              ))}
            </ul>
          );
        return <p key={i}><Inlines parts={b.inline} /></p>;
      })}
    </>
  );
}
