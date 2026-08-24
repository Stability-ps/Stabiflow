import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  maxAutoResizeHeight?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({
  className,
  autoResize = false,
  maxAutoResizeHeight = 360,
  onInput,
  ...props
}, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = React.useCallback(() => {
    if (!autoResize || !innerRef.current) {
      return;
    }

    const nextHeight = Math.min(innerRef.current.scrollHeight, maxAutoResizeHeight);
    innerRef.current.style.height = "0px";
    innerRef.current.style.height = `${nextHeight}px`;
    innerRef.current.style.overflowY = innerRef.current.scrollHeight > maxAutoResizeHeight ? "auto" : "hidden";
  }, [autoResize, maxAutoResizeHeight]);

  React.useEffect(() => {
    resizeTextarea();
  }, [props.value, resizeTextarea]);

  const handleRef = React.useCallback((node: HTMLTextAreaElement | null) => {
    innerRef.current = node;

    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);

  return (
    <textarea
      className={cn(
        "flex min-h-[40px] w-full rounded-xl border border-input/90 bg-white/92 px-3.5 py-3 text-sm text-foreground shadow-[0_6px_24px_-22px_rgba(15,23,42,0.28)] ring-offset-background transition-all duration-200 placeholder:text-muted-foreground/80 focus-visible:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        autoResize ? "resize-none" : null,
        className,
      )}
      ref={handleRef}
      onInput={(event) => {
        resizeTextarea();
        onInput?.(event);
      }}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
