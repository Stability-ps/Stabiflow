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
        "flex min-h-[40px] w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-fast placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/20",
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
