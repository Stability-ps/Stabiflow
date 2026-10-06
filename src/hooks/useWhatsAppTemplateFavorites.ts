import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useWhatsAppTemplateFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ["whatsapp-template-favorites", user?.id];

  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_template_favorites").select("template_id").eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return new Set((data || []).map((row) => row.template_id));
    },
  });

  const toggle = useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error("Sign in required");
      const isFavorite = query.data?.has(templateId) ?? false;
      if (isFavorite) {
        const { error } = await supabase.from("whatsapp_template_favorites").delete().eq("user_id", user.id).eq("template_id", templateId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("whatsapp_template_favorites").insert({ user_id: user.id, template_id: templateId });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return { favorites: query.data ?? new Set<string>(), isLoading: query.isLoading, toggleFavorite: toggle.mutateAsync, isToggling: toggle.isPending };
}
