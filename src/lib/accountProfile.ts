import { supabase } from "@/integrations/supabase/client";

export async function updateOwnProfile(userId: string, input: { full_name: string }) {
  const { error } = await supabase.from("profiles").update({ full_name: input.full_name.trim() || null }).eq("id", userId);
  if (error) throw new Error(error.message);
}
