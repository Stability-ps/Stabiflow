import { Toaster as Sonner, toast } from "sonner";
import { useAppliedTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts match the theme actually applied (dark only inside /app; src/lib/theme.ts).
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppliedTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
