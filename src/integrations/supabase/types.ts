export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_campaign_metrics: {
        Row: {
          ad_id: string | null
          ad_set_id: string | null
          campaign_id: string
          clicks: number
          cost_per_result_minor_units: number | null
          cpc_minor_units: number | null
          cpm_minor_units: number | null
          created_at: string
          ctr: number | null
          currency: string
          date_start: string
          date_stop: string
          frequency: number | null
          id: string
          impressions: number
          raw_provider_response: Json | null
          reach: number
          results: number | null
          spend_minor_units: number
          synced_at: string
          workspace_id: string
        }
        Insert: {
          ad_id?: string | null
          ad_set_id?: string | null
          campaign_id: string
          clicks?: number
          cost_per_result_minor_units?: number | null
          cpc_minor_units?: number | null
          cpm_minor_units?: number | null
          created_at?: string
          ctr?: number | null
          currency: string
          date_start: string
          date_stop: string
          frequency?: number | null
          id?: string
          impressions?: number
          raw_provider_response?: Json | null
          reach?: number
          results?: number | null
          spend_minor_units?: number
          synced_at?: string
          workspace_id: string
        }
        Update: {
          ad_id?: string | null
          ad_set_id?: string | null
          campaign_id?: string
          clicks?: number
          cost_per_result_minor_units?: number | null
          cpc_minor_units?: number | null
          cpm_minor_units?: number | null
          created_at?: string
          ctr?: number | null
          currency?: string
          date_start?: string
          date_stop?: string
          frequency?: number | null
          id?: string
          impressions?: number
          raw_provider_response?: Json | null
          reach?: number
          results?: number | null
          spend_minor_units?: number
          synced_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaign_metrics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_metrics_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          ad_account_id: string
          audience: Json
          budget_type: Database["public"]["Enums"]["ad_budget_type"]
          buying_type: string
          created_at: string
          created_by: string | null
          currency: string
          daily_budget_minor_units: number | null
          destination_type: Database["public"]["Enums"]["ad_destination_type"]
          draft_creative_id: string | null
          end_at: string | null
          external_campaign_id: string | null
          facebook_page_id: string | null
          id: string
          instagram_account_id: string | null
          integration_id: string
          last_publish_error: Json | null
          last_readiness_check: Json | null
          lifetime_budget_minor_units: number | null
          name: string
          objective: Database["public"]["Enums"]["ad_campaign_objective"]
          placements: Json
          provider_configured_status: string | null
          provider_effective_status: string | null
          provider_state: Json
          source_content_media_asset_id: string | null
          source_content_series_id: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          audience?: Json
          budget_type?: Database["public"]["Enums"]["ad_budget_type"]
          buying_type?: string
          created_at?: string
          created_by?: string | null
          currency: string
          daily_budget_minor_units?: number | null
          destination_type?: Database["public"]["Enums"]["ad_destination_type"]
          draft_creative_id?: string | null
          end_at?: string | null
          external_campaign_id?: string | null
          facebook_page_id?: string | null
          id?: string
          instagram_account_id?: string | null
          integration_id: string
          last_publish_error?: Json | null
          last_readiness_check?: Json | null
          lifetime_budget_minor_units?: number | null
          name: string
          objective: Database["public"]["Enums"]["ad_campaign_objective"]
          placements?: Json
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          provider_state?: Json
          source_content_media_asset_id?: string | null
          source_content_series_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          audience?: Json
          budget_type?: Database["public"]["Enums"]["ad_budget_type"]
          buying_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_budget_minor_units?: number | null
          destination_type?: Database["public"]["Enums"]["ad_destination_type"]
          draft_creative_id?: string | null
          end_at?: string | null
          external_campaign_id?: string | null
          facebook_page_id?: string | null
          id?: string
          instagram_account_id?: string | null
          integration_id?: string
          last_publish_error?: Json | null
          last_readiness_check?: Json | null
          lifetime_budget_minor_units?: number | null
          name?: string
          objective?: Database["public"]["Enums"]["ad_campaign_objective"]
          placements?: Json
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          provider_state?: Json
          source_content_media_asset_id?: string | null
          source_content_series_id?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "workspace_meta_ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_draft_creative_id_fkey"
            columns: ["draft_creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_facebook_page_id_fkey"
            columns: ["facebook_page_id"]
            isOneToOne: false
            referencedRelation: "workspace_facebook_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_instagram_account_id_fkey"
            columns: ["instagram_account_id"]
            isOneToOne: false
            referencedRelation: "workspace_instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_source_content_media_asset_id_fkey"
            columns: ["source_content_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_source_content_series_id_fkey"
            columns: ["source_content_series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_creatives: {
        Row: {
          created_at: string
          created_by: string | null
          cta: string
          description: string | null
          destination_url: string | null
          external_creative_id: string | null
          headline: string | null
          id: string
          media_asset_id: string
          platform_variant_id: string | null
          primary_text: string
          status: Database["public"]["Enums"]["ad_creative_status"]
          updated_at: string
          whatsapp_number_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cta: string
          description?: string | null
          destination_url?: string | null
          external_creative_id?: string | null
          headline?: string | null
          id?: string
          media_asset_id: string
          platform_variant_id?: string | null
          primary_text: string
          status?: Database["public"]["Enums"]["ad_creative_status"]
          updated_at?: string
          whatsapp_number_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cta?: string
          description?: string | null
          destination_url?: string | null
          external_creative_id?: string | null
          headline?: string | null
          id?: string
          media_asset_id?: string
          platform_variant_id?: string | null
          primary_text?: string
          status?: Database["public"]["Enums"]["ad_creative_status"]
          updated_at?: string
          whatsapp_number_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_platform_variant_id_fkey"
            columns: ["platform_variant_id"]
            isOneToOne: false
            referencedRelation: "content_platform_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "workspace_whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_publish_operations: {
        Row: {
          campaign_id: string
          created_at: string
          error: Json | null
          finished_at: string | null
          id: string
          idempotency_key: string
          requested_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["ad_publish_operation_status"]
          steps: Json
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ad_publish_operation_status"]
          steps?: Json
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["ad_publish_operation_status"]
          steps?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_publish_operations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_publish_operations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_publish_operations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_sets: {
        Row: {
          billing_event: string
          campaign_id: string
          created_at: string
          daily_budget_minor_units: number | null
          end_at: string | null
          external_adset_id: string | null
          id: string
          lifetime_budget_minor_units: number | null
          name: string
          optimization_goal: string
          placements: Json
          provider_configured_status: string | null
          provider_effective_status: string | null
          start_at: string
          status: Database["public"]["Enums"]["ad_lifecycle_status"]
          targeting: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_event: string
          campaign_id: string
          created_at?: string
          daily_budget_minor_units?: number | null
          end_at?: string | null
          external_adset_id?: string | null
          id?: string
          lifetime_budget_minor_units?: number | null
          name: string
          optimization_goal: string
          placements?: Json
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          start_at: string
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          targeting?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_event?: string
          campaign_id?: string
          created_at?: string
          daily_budget_minor_units?: number | null
          end_at?: string | null
          external_adset_id?: string | null
          id?: string
          lifetime_budget_minor_units?: number | null
          name?: string
          optimization_goal?: string
          placements?: Json
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          start_at?: string
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          targeting?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_sets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_set_id: string
          created_at: string
          creative_id: string
          external_ad_id: string | null
          id: string
          name: string
          provider_configured_status: string | null
          provider_effective_status: string | null
          status: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ad_set_id: string
          created_at?: string
          creative_id: string
          external_ad_id?: string | null
          id?: string
          name: string
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ad_set_id?: string
          created_at?: string
          creative_id?: string
          external_ad_id?: string | null
          id?: string
          name?: string
          provider_configured_status?: string | null
          provider_effective_status?: string | null
          status?: Database["public"]["Enums"]["ad_lifecycle_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_args: Json | null
          tool_call_id: string | null
          tool_name: string | null
          workspace_id: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_args?: Json | null
          tool_call_id?: string | null
          tool_name?: string | null
          workspace_id: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_args?: Json | null
          tool_call_id?: string | null
          tool_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          estimated_cost: number | null
          feature: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          output_tokens: number
          provider: string
          status: string
          total_tokens: number | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          estimated_cost?: number | null
          feature?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model: string
          output_tokens?: number
          provider?: string
          status: string
          total_tokens?: number | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          estimated_cost?: number | null
          feature?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          output_tokens?: number
          provider?: string
          status?: string
          total_tokens?: number | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attribution_events: {
        Row: {
          ad_id: string | null
          ad_set_id: string | null
          attribution_confidence: string | null
          attribution_method: string | null
          attribution_source: string | null
          campaign_id: string | null
          click_id: string | null
          conversation_id: string | null
          created_at: string
          creative_id: string | null
          customer_id: string | null
          destination: string | null
          event_type: string
          external_ad_id: string | null
          external_adset_id: string | null
          external_campaign_id: string | null
          external_creative_id: string | null
          id: string
          lead_id: string | null
          medium: string | null
          metadata: Json
          occurred_at: string
          opportunity_id: string | null
          platform: string | null
          provider_event_id: string | null
          received_at: string
          referrer: string | null
          source: string | null
          source_type: string | null
          tracking_token: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          workspace_id: string
        }
        Insert: {
          ad_id?: string | null
          ad_set_id?: string | null
          attribution_confidence?: string | null
          attribution_method?: string | null
          attribution_source?: string | null
          campaign_id?: string | null
          click_id?: string | null
          conversation_id?: string | null
          created_at?: string
          creative_id?: string | null
          customer_id?: string | null
          destination?: string | null
          event_type: string
          external_ad_id?: string | null
          external_adset_id?: string | null
          external_campaign_id?: string | null
          external_creative_id?: string | null
          id?: string
          lead_id?: string | null
          medium?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          platform?: string | null
          provider_event_id?: string | null
          received_at?: string
          referrer?: string | null
          source?: string | null
          source_type?: string | null
          tracking_token?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          workspace_id: string
        }
        Update: {
          ad_id?: string | null
          ad_set_id?: string | null
          attribution_confidence?: string | null
          attribution_method?: string | null
          attribution_source?: string | null
          campaign_id?: string | null
          click_id?: string | null
          conversation_id?: string | null
          created_at?: string
          creative_id?: string | null
          customer_id?: string | null
          destination?: string | null
          event_type?: string
          external_ad_id?: string | null
          external_adset_id?: string | null
          external_campaign_id?: string | null
          external_creative_id?: string | null
          id?: string
          lead_id?: string | null
          medium?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          platform?: string | null
          provider_event_id?: string | null
          received_at?: string
          referrer?: string | null
          source?: string | null
          source_type?: string | null
          tracking_token?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribution_events_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_actions: {
        Row: {
          action_config: Json
          action_type: string
          automation_id: string
          created_at: string
          id: string
          sort_order: number
          workspace_id: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          automation_id: string
          created_at?: string
          id?: string
          sort_order?: number
          workspace_id: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          automation_id?: string
          created_at?: string
          id?: string
          sort_order?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_actions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_conditions: {
        Row: {
          automation_id: string
          created_at: string
          field: string
          id: string
          operator: string
          sort_order: number
          value: Json | null
          workspace_id: string
        }
        Insert: {
          automation_id: string
          created_at?: string
          field: string
          id?: string
          operator: string
          sort_order?: number
          value?: Json | null
          workspace_id: string
        }
        Update: {
          automation_id?: string
          created_at?: string
          field?: string
          id?: string
          operator?: string
          sort_order?: number
          value?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_conditions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_conditions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_run_steps: {
        Row: {
          action_type: string
          created_at: string
          error: Json | null
          finished_at: string | null
          id: string
          result: Json | null
          run_id: string
          sort_order: number
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          run_id: string
          sort_order?: number
          started_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          run_id?: string
          sort_order?: number
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_run_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          attempt_count: number
          automation_id: string
          causation_domain_event_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          conditions_result: Json
          correlation_id: string
          created_at: string
          depth: number
          domain_event_id: string
          error: Json | null
          finished_at: string | null
          id: string
          next_retry_at: string | null
          originating_automation_id: string | null
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          automation_id: string
          causation_domain_event_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          conditions_result?: Json
          correlation_id?: string
          created_at?: string
          depth?: number
          domain_event_id: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          next_retry_at?: string | null
          originating_automation_id?: string | null
          started_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          automation_id?: string
          causation_domain_event_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          conditions_result?: Json
          correlation_id?: string
          created_at?: string
          depth?: number
          domain_event_id?: string
          error?: Json | null
          finished_at?: string | null
          id?: string
          next_retry_at?: string | null
          originating_automation_id?: string | null
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_causation_domain_event_id_fkey"
            columns: ["causation_domain_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_domain_event_id_fkey"
            columns: ["domain_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_originating_automation_id_fkey"
            columns: ["originating_automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          idle_timeout_minutes: number | null
          name: string
          status: string
          trigger_event_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          idle_timeout_minutes?: number | null
          name: string
          status?: string
          trigger_event_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          idle_timeout_minutes?: number | null
          name?: string
          status?: string
          trigger_event_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          created_at: string
          email: string
          id: string
          provider: string
          provider_customer_code: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          provider?: string
          provider_customer_code: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          provider?: string
          provider_customer_code?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_email_deliveries: {
        Row: {
          created_at: string
          event_key: string
          id: string
          provider: string
          provider_message_id: string | null
          recipient_email: string
          sent_at: string | null
          status: string
          template_key: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: string
          provider?: string
          provider_message_id?: string | null
          recipient_email: string
          sent_at?: string | null
          status?: string
          template_key: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: string
          provider?: string
          provider_message_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          status?: string
          template_key?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_email_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_public: boolean
          marketing: Json
          name: string
          plan_kind: string
          product_id: string
          sort_order: number
          tier_rank: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          marketing?: Json
          name: string
          plan_kind?: string
          product_id: string
          sort_order?: number
          tier_rank?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          marketing?: Json
          name?: string
          plan_kind?: string
          product_id?: string
          sort_order?: number
          tier_rank?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_plans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "billing_products"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_prices: {
        Row: {
          access_days: number | null
          amount_minor: number
          billing_interval: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          paystack_plan_code: string | null
          plan_id: string
          updated_at: string
        }
        Insert: {
          access_days?: number | null
          amount_minor: number
          billing_interval: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          paystack_plan_code?: string | null
          plan_id: string
          updated_at?: string
        }
        Update: {
          access_days?: number | null
          amount_minor?: number
          billing_interval?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          paystack_plan_code?: string | null
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_products: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_subscription_events: {
        Row: {
          actor: string
          created_at: string
          from_status: string | null
          id: string
          reason: string
          subscription_id: string
          to_status: string
          workspace_id: string
        }
        Insert: {
          actor?: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason: string
          subscription_id: string
          to_status: string
          workspace_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string
          subscription_id?: string
          to_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "workspace_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscription_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          amount_minor: number
          authorization_url: string | null
          created_at: string
          created_by: string | null
          currency: string
          failure_reason: string | null
          id: string
          kind: string
          paid_amount_minor: number | null
          paid_at: string | null
          paid_currency: string | null
          price_id: string | null
          provider: string
          purchase_id: string | null
          reference: string
          status: string
          subscription_id: string | null
          updated_at: string
          verified_via: string | null
          workspace_id: string
        }
        Insert: {
          amount_minor: number
          authorization_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          id?: string
          kind: string
          paid_amount_minor?: number | null
          paid_at?: string | null
          paid_currency?: string | null
          price_id?: string | null
          provider?: string
          purchase_id?: string | null
          reference: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
          verified_via?: string | null
          workspace_id: string
        }
        Update: {
          amount_minor?: number
          authorization_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          id?: string
          kind?: string
          paid_amount_minor?: number | null
          paid_at?: string | null
          paid_currency?: string | null
          price_id?: string | null
          provider?: string
          purchase_id?: string | null
          reference?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
          verified_via?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "billing_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "workspace_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "workspace_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          dedupe_key: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          processing_result: string | null
          processing_status: string
          provider: string
          received_at: string
          signature_valid: boolean
          workspace_id: string | null
        }
        Insert: {
          dedupe_key: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_result?: string | null
          processing_status?: string
          provider?: string
          received_at?: string
          signature_valid: boolean
          workspace_id?: string | null
        }
        Update: {
          dedupe_key?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_result?: string | null
          processing_status?: string
          provider?: string
          received_at?: string
          signature_valid?: boolean
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_certifications: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          credential_id: string | null
          document_media_asset_id: string | null
          expires_on: string | null
          id: string
          is_public: boolean
          issued_on: string | null
          issuer: string | null
          name: string
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          credential_id?: string | null
          document_media_asset_id?: string | null
          expires_on?: string | null
          id?: string
          is_public?: boolean
          issued_on?: string | null
          issuer?: string | null
          name: string
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          credential_id?: string | null
          document_media_asset_id?: string | null
          expires_on?: string | null
          id?: string
          is_public?: boolean
          issued_on?: string | null
          issuer?: string | null
          name?: string
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_certifications_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_certifications_document_media_asset_id_fkey"
            columns: ["document_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_certifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_contacts: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          is_primary: boolean
          is_public: boolean
          kind: string
          label: string | null
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          value: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          is_public?: boolean
          kind: string
          label?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          value: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          is_public?: boolean
          kind?: string
          label?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          value?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_contacts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_documents: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          kind: string
          page_count: number | null
          status: string
          storage_path: string | null
          template_key: string
          title: string
          watermarked: boolean
          workspace_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          page_count?: number | null
          status?: string
          storage_path?: string | null
          template_key: string
          title: string
          watermarked?: boolean
          workspace_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          page_count?: number | null
          status?: string
          storage_path?: string | null
          template_key?: string
          title?: string
          watermarked?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_documents_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "profile_templates"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "business_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_fact_proposals: {
        Row: {
          applied_ref: string | null
          created_at: string
          current_value: Json | null
          evidence: string | null
          evidence_url: string | null
          extraction_method: string
          field: string | null
          id: string
          origin: string
          proposed: Json
          reviewed_at: string | null
          reviewed_by: string | null
          scan_id: string | null
          status: string
          target: string
          workspace_id: string
        }
        Insert: {
          applied_ref?: string | null
          created_at?: string
          current_value?: Json | null
          evidence?: string | null
          evidence_url?: string | null
          extraction_method: string
          field?: string | null
          id?: string
          origin: string
          proposed: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_id?: string | null
          status?: string
          target: string
          workspace_id: string
        }
        Update: {
          applied_ref?: string | null
          created_at?: string
          current_value?: Json | null
          evidence?: string | null
          evidence_url?: string | null
          extraction_method?: string
          field?: string | null
          id?: string
          origin?: string
          proposed?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_id?: string | null
          status?: string
          target?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_fact_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_fact_proposals_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "website_scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_fact_proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_identifiers: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          country_code: string
          created_at: string
          id: string
          is_public: boolean
          scheme: string
          source: string
          source_ref: string | null
          updated_at: string
          value: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          country_code?: string
          created_at?: string
          id?: string
          is_public?: boolean
          scheme: string
          source?: string
          source_ref?: string | null
          updated_at?: string
          value: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          country_code?: string
          created_at?: string
          id?: string
          is_public?: boolean
          scheme?: string
          source?: string
          source_ref?: string | null
          updated_at?: string
          value?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_identifiers_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_identifiers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_identities: {
        Row: {
          brand_profile_id: string | null
          core_values: string[]
          country_code: string
          created_at: string
          employee_count_range: string | null
          field_provenance: Json
          founded_year: number | null
          id: string
          industry: string | null
          legal_name: string | null
          long_description: string | null
          mission: string | null
          short_description: string | null
          tagline: string | null
          trading_name: string | null
          updated_at: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          vision: string | null
          website: string | null
          workspace_id: string
        }
        Insert: {
          brand_profile_id?: string | null
          core_values?: string[]
          country_code?: string
          created_at?: string
          employee_count_range?: string | null
          field_provenance?: Json
          founded_year?: number | null
          id?: string
          industry?: string | null
          legal_name?: string | null
          long_description?: string | null
          mission?: string | null
          short_description?: string | null
          tagline?: string | null
          trading_name?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          vision?: string | null
          website?: string | null
          workspace_id: string
        }
        Update: {
          brand_profile_id?: string | null
          core_values?: string[]
          country_code?: string
          created_at?: string
          employee_count_range?: string | null
          field_provenance?: Json
          founded_year?: number | null
          id?: string
          industry?: string | null
          legal_name?: string | null
          long_description?: string | null
          mission?: string | null
          short_description?: string | null
          tagline?: string | null
          trading_name?: string | null
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          vision?: string | null
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_identities_brand_profile_id_fkey"
            columns: ["brand_profile_id"]
            isOneToOne: false
            referencedRelation: "creative_brand_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_identities_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          country_code: string | null
          created_at: string
          id: string
          is_primary: boolean
          is_public: boolean
          label: string | null
          postal_code: string | null
          region: string | null
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          is_public?: boolean
          label?: string | null
          postal_code?: string | null
          region?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          is_public?: boolean
          label?: string | null
          postal_code?: string | null
          region?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_locations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_offerings: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          description: string | null
          id: string
          is_featured: boolean
          kind: string
          name: string
          price_text: string | null
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          kind?: string
          name: string
          price_text?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          kind?: string
          name?: string
          price_text?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_offerings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_offerings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_profile_section_preferences: {
        Row: {
          reason: string | null
          section: string
          status: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          reason?: string | null
          section: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          reason?: string | null
          section?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_profile_section_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_profile_section_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_projects: {
        Row: {
          client_name: string | null
          completed_year: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          cover_media_asset_id: string | null
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          location: string | null
          sort_order: number
          source: string
          source_ref: string | null
          title: string
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          client_name?: string | null
          completed_year?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          cover_media_asset_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          location?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          title: string
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          client_name?: string | null
          completed_year?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          cover_media_asset_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          location?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          title?: string
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_projects_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_projects_cover_media_asset_id_fkey"
            columns: ["cover_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_social_links: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          platform: string
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          url: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          platform: string
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          url: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          platform?: string
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          url?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_social_links_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_social_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      business_team_members: {
        Row: {
          bio: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          full_name: string
          id: string
          is_public: boolean
          photo_media_asset_id: string | null
          role_title: string | null
          sort_order: number
          source: string
          source_ref: string | null
          updated_at: string
          verification_status: string
          workspace_id: string
        }
        Insert: {
          bio?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          full_name: string
          id?: string
          is_public?: boolean
          photo_media_asset_id?: string | null
          role_title?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id: string
        }
        Update: {
          bio?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_public?: boolean
          photo_media_asset_id?: string | null
          role_title?: string | null
          sort_order?: number
          source?: string
          source_ref?: string | null
          updated_at?: string
          verification_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_team_members_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_team_members_photo_media_asset_id_fkey"
            columns: ["photo_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_team_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "business_identities"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      campaign_entry_tokens: {
        Row: {
          ad_id: string | null
          ad_set_id: string | null
          campaign_id: string | null
          created_at: string
          created_by: string | null
          creative_id: string | null
          destination_type: string | null
          expires_at: string | null
          id: string
          label: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          ad_id?: string | null
          ad_set_id?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          destination_type?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          token: string
          workspace_id: string
        }
        Update: {
          ad_id?: string | null
          ad_set_id?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          destination_type?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_entry_tokens_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_entry_tokens_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_entry_tokens_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_entry_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_entry_tokens_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_entry_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_media_assets: {
        Row: {
          aspect_ratio: number
          asset_role: Database["public"]["Enums"]["content_asset_role"] | null
          checksum_sha256: string
          created_at: string
          created_by: string | null
          default_caption: string | null
          file_size_bytes: number
          height_px: number
          id: string
          mime_type: string
          status: Database["public"]["Enums"]["content_asset_status"]
          storage_path: string
          title: string
          updated_at: string
          width_px: number
          workspace_id: string
        }
        Insert: {
          aspect_ratio: number
          asset_role?: Database["public"]["Enums"]["content_asset_role"] | null
          checksum_sha256: string
          created_at?: string
          created_by?: string | null
          default_caption?: string | null
          file_size_bytes: number
          height_px: number
          id?: string
          mime_type: string
          status?: Database["public"]["Enums"]["content_asset_status"]
          storage_path: string
          title: string
          updated_at?: string
          width_px: number
          workspace_id: string
        }
        Update: {
          aspect_ratio?: number
          asset_role?: Database["public"]["Enums"]["content_asset_role"] | null
          checksum_sha256?: string
          created_at?: string
          created_by?: string | null
          default_caption?: string | null
          file_size_bytes?: number
          height_px?: number
          id?: string
          mime_type?: string
          status?: Database["public"]["Enums"]["content_asset_status"]
          storage_path?: string
          title?: string
          updated_at?: string
          width_px?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_media_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_platform_variants: {
        Row: {
          aspect_ratio: number
          created_at: string
          file_size_bytes: number
          height_px: number
          id: string
          media_asset_id: string
          mime_type: string
          platform: Database["public"]["Enums"]["content_platform"]
          storage_path: string
          transformation_metadata: Json
          width_px: number
          workspace_id: string
        }
        Insert: {
          aspect_ratio: number
          created_at?: string
          file_size_bytes: number
          height_px: number
          id?: string
          media_asset_id: string
          mime_type: string
          platform: Database["public"]["Enums"]["content_platform"]
          storage_path: string
          transformation_metadata?: Json
          width_px: number
          workspace_id: string
        }
        Update: {
          aspect_ratio?: number
          created_at?: string
          file_size_bytes?: number
          height_px?: number
          id?: string
          media_asset_id?: string
          mime_type?: string
          platform?: Database["public"]["Enums"]["content_platform"]
          storage_path?: string
          transformation_metadata?: Json
          width_px?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_platform_variants_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_platform_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_publish_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          error_code: string | null
          error_message: string | null
          finished_at: string
          id: string
          provider_response: Json | null
          scheduled_post_id: string
          started_at: string
          status: Database["public"]["Enums"]["content_publish_attempt_status"]
          workspace_id: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at: string
          id?: string
          provider_response?: Json | null
          scheduled_post_id: string
          started_at: string
          status: Database["public"]["Enums"]["content_publish_attempt_status"]
          workspace_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          finished_at?: string
          id?: string
          provider_response?: Json | null
          scheduled_post_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["content_publish_attempt_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_publish_attempts_scheduled_post_id_fkey"
            columns: ["scheduled_post_id"]
            isOneToOne: false
            referencedRelation: "content_scheduled_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_publish_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_scheduled_posts: {
        Row: {
          attempt_count: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          facebook_page_id: string | null
          failure_code: string | null
          failure_message: string | null
          hashtags: string[]
          id: string
          idempotency_key: string
          instagram_account_id: string | null
          last_attempt_at: string | null
          media_asset_id: string
          next_retry_at: string | null
          platform_variant_id: string | null
          provider_permalink: string | null
          provider_post_id: string | null
          published_at: string | null
          scheduled_at: string
          series_id: string | null
          series_item_id: string | null
          status: Database["public"]["Enums"]["content_post_status"]
          target_platform: Database["public"]["Enums"]["content_platform"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          caption: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          facebook_page_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          hashtags?: string[]
          id?: string
          idempotency_key: string
          instagram_account_id?: string | null
          last_attempt_at?: string | null
          media_asset_id: string
          next_retry_at?: string | null
          platform_variant_id?: string | null
          provider_permalink?: string | null
          provider_post_id?: string | null
          published_at?: string | null
          scheduled_at: string
          series_id?: string | null
          series_item_id?: string | null
          status?: Database["public"]["Enums"]["content_post_status"]
          target_platform: Database["public"]["Enums"]["content_platform"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          caption?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          facebook_page_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          hashtags?: string[]
          id?: string
          idempotency_key?: string
          instagram_account_id?: string | null
          last_attempt_at?: string | null
          media_asset_id?: string
          next_retry_at?: string | null
          platform_variant_id?: string | null
          provider_permalink?: string | null
          provider_post_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          series_id?: string | null
          series_item_id?: string | null
          status?: Database["public"]["Enums"]["content_post_status"]
          target_platform?: Database["public"]["Enums"]["content_platform"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_scheduled_posts_facebook_page_id_fkey"
            columns: ["facebook_page_id"]
            isOneToOne: false
            referencedRelation: "workspace_facebook_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_instagram_account_id_fkey"
            columns: ["instagram_account_id"]
            isOneToOne: false
            referencedRelation: "workspace_instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_platform_variant_id_fkey"
            columns: ["platform_variant_id"]
            isOneToOne: false
            referencedRelation: "content_platform_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_series_item_id_fkey"
            columns: ["series_item_id"]
            isOneToOne: false
            referencedRelation: "content_series_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduled_posts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_scheduler_settings: {
        Row: {
          auto_publish_enabled: boolean
          created_at: string
          id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          auto_publish_enabled?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          auto_publish_enabled?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_scheduler_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scheduler_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_series: {
        Row: {
          activated_at: string | null
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          default_caption_template: string | null
          default_hashtags: string[]
          description: string | null
          id: string
          interval_days: number
          name: string
          paused_at: string | null
          start_at: string
          status: Database["public"]["Enums"]["content_series_status"]
          target_platforms: Database["public"]["Enums"]["content_platform"][]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          default_caption_template?: string | null
          default_hashtags?: string[]
          description?: string | null
          id?: string
          interval_days?: number
          name: string
          paused_at?: string | null
          start_at: string
          status?: Database["public"]["Enums"]["content_series_status"]
          target_platforms?: Database["public"]["Enums"]["content_platform"][]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          default_caption_template?: string | null
          default_hashtags?: string[]
          description?: string | null
          id?: string
          interval_days?: number
          name?: string
          paused_at?: string | null
          start_at?: string
          status?: Database["public"]["Enums"]["content_series_status"]
          target_platforms?: Database["public"]["Enums"]["content_platform"][]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_series_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_series_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_series_excluded_dates: {
        Row: {
          created_at: string
          excluded_date: string
          id: string
          reason: string | null
          series_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          excluded_date: string
          id?: string
          reason?: string | null
          series_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          excluded_date?: string
          id?: string
          reason?: string | null
          series_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_series_excluded_dates_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_series_excluded_dates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_series_items: {
        Row: {
          caption_override: string | null
          created_at: string
          hashtags_override: string[] | null
          id: string
          media_asset_id: string
          position: number
          series_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          caption_override?: string | null
          created_at?: string
          hashtags_override?: string[] | null
          id?: string
          media_asset_id: string
          position: number
          series_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          caption_override?: string | null
          created_at?: string
          hashtags_override?: string[] | null
          id?: string
          media_asset_id?: string
          position?: number
          series_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_series_items_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_series_items_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_series_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_brand_profiles: {
        Row: {
          accent_color: string | null
          address: string | null
          company_name: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          cta_text_color: string | null
          default_cta: string | null
          footer_disclaimer: string | null
          id: string
          is_default: boolean
          logo_media_asset_id: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          updated_at: string
          website: string | null
          whatsapp_number: string | null
          workspace_id: string
        }
        Insert: {
          accent_color?: string | null
          address?: string | null
          company_name: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          cta_text_color?: string | null
          default_cta?: string | null
          footer_disclaimer?: string | null
          id?: string
          is_default?: boolean
          logo_media_asset_id?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
          website?: string | null
          whatsapp_number?: string | null
          workspace_id: string
        }
        Update: {
          accent_color?: string | null
          address?: string | null
          company_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          cta_text_color?: string | null
          default_cta?: string | null
          footer_disclaimer?: string | null
          id?: string
          is_default?: boolean
          logo_media_asset_id?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
          website?: string | null
          whatsapp_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_brand_profiles_logo_media_asset_id_fkey"
            columns: ["logo_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_brand_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_studio_batches: {
        Row: {
          audience: string | null
          brand_profile_id: string | null
          brand_snapshot: Json | null
          business_context: string
          contact_fields: string[]
          created_at: string
          created_by: string | null
          error_detail: string | null
          id: string
          layouts: string[]
          reference_preferences: Json | null
          reference_style: Json | null
          sizes: string[]
          source_media_asset_id: string | null
          status: Database["public"]["Enums"]["creative_studio_batch_status"]
          tone: string | null
          updated_at: string
          user_body_text: string | null
          user_cta: string | null
          user_headline: string | null
          visual_direction: string | null
          workspace_id: string
        }
        Insert: {
          audience?: string | null
          brand_profile_id?: string | null
          brand_snapshot?: Json | null
          business_context: string
          contact_fields?: string[]
          created_at?: string
          created_by?: string | null
          error_detail?: string | null
          id?: string
          layouts?: string[]
          reference_preferences?: Json | null
          reference_style?: Json | null
          sizes?: string[]
          source_media_asset_id?: string | null
          status?: Database["public"]["Enums"]["creative_studio_batch_status"]
          tone?: string | null
          updated_at?: string
          user_body_text?: string | null
          user_cta?: string | null
          user_headline?: string | null
          visual_direction?: string | null
          workspace_id: string
        }
        Update: {
          audience?: string | null
          brand_profile_id?: string | null
          brand_snapshot?: Json | null
          business_context?: string
          contact_fields?: string[]
          created_at?: string
          created_by?: string | null
          error_detail?: string | null
          id?: string
          layouts?: string[]
          reference_preferences?: Json | null
          reference_style?: Json | null
          sizes?: string[]
          source_media_asset_id?: string | null
          status?: Database["public"]["Enums"]["creative_studio_batch_status"]
          tone?: string | null
          updated_at?: string
          user_body_text?: string | null
          user_cta?: string | null
          user_headline?: string | null
          visual_direction?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_studio_batches_brand_profile_id_fkey"
            columns: ["brand_profile_id"]
            isOneToOne: false
            referencedRelation: "creative_brand_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_batches_source_media_asset_id_fkey"
            columns: ["source_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_studio_concepts: {
        Row: {
          batch_id: string
          concept_name: string
          created_at: string
          cta: string
          headline: string
          id: string
          layout_style: string | null
          sort_order: number
          supporting_text: string
          updated_at: string
          visual_error: string | null
          visual_job_id: string | null
          visual_media_asset_id: string | null
          visual_notes: string | null
          visual_prompt: string
          visual_source: Database["public"]["Enums"]["creative_studio_visual_source"]
          visual_status: Database["public"]["Enums"]["creative_studio_visual_status"]
          workspace_id: string
        }
        Insert: {
          batch_id: string
          concept_name: string
          created_at?: string
          cta: string
          headline: string
          id?: string
          layout_style?: string | null
          sort_order?: number
          supporting_text: string
          updated_at?: string
          visual_error?: string | null
          visual_job_id?: string | null
          visual_media_asset_id?: string | null
          visual_notes?: string | null
          visual_prompt: string
          visual_source?: Database["public"]["Enums"]["creative_studio_visual_source"]
          visual_status?: Database["public"]["Enums"]["creative_studio_visual_status"]
          workspace_id: string
        }
        Update: {
          batch_id?: string
          concept_name?: string
          created_at?: string
          cta?: string
          headline?: string
          id?: string
          layout_style?: string | null
          sort_order?: number
          supporting_text?: string
          updated_at?: string
          visual_error?: string | null
          visual_job_id?: string | null
          visual_media_asset_id?: string | null
          visual_notes?: string | null
          visual_prompt?: string
          visual_source?: Database["public"]["Enums"]["creative_studio_visual_source"]
          visual_status?: Database["public"]["Enums"]["creative_studio_visual_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_studio_concepts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "creative_studio_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_concepts_visual_media_asset_id_fkey"
            columns: ["visual_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_concepts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_studio_creatives: {
        Row: {
          batch_id: string
          body_text: string
          concept_id: string
          contact_text: string | null
          created_at: string
          cta: string
          disclaimer_text: string | null
          headline: string
          height_px: number
          id: string
          layout: string
          overflow_warning: boolean
          price_text: string | null
          render_error: string | null
          rendered_media_asset_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size: string
          status: Database["public"]["Enums"]["creative_studio_creative_status"]
          storage_path: string | null
          updated_at: string
          width_px: number
          workspace_id: string
        }
        Insert: {
          batch_id: string
          body_text: string
          concept_id: string
          contact_text?: string | null
          created_at?: string
          cta: string
          disclaimer_text?: string | null
          headline: string
          height_px: number
          id?: string
          layout: string
          overflow_warning?: boolean
          price_text?: string | null
          render_error?: string | null
          rendered_media_asset_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size: string
          status?: Database["public"]["Enums"]["creative_studio_creative_status"]
          storage_path?: string | null
          updated_at?: string
          width_px: number
          workspace_id: string
        }
        Update: {
          batch_id?: string
          body_text?: string
          concept_id?: string
          contact_text?: string | null
          created_at?: string
          cta?: string
          disclaimer_text?: string | null
          headline?: string
          height_px?: number
          id?: string
          layout?: string
          overflow_warning?: boolean
          price_text?: string | null
          render_error?: string | null
          rendered_media_asset_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size?: string
          status?: Database["public"]["Enums"]["creative_studio_creative_status"]
          storage_path?: string | null
          updated_at?: string
          width_px?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_studio_creatives_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "creative_studio_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_creatives_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_studio_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_creatives_rendered_media_asset_id_fkey"
            columns: ["rendered_media_asset_id"]
            isOneToOne: false
            referencedRelation: "content_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_creatives_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_studio_creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          author_id: string
          author_name: string
          body: string
          created_at: string
          id: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          assigned_to: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          customer_since: string
          email: string | null
          id: string
          lead_id: string | null
          name: string
          opportunity_id: string | null
          phone: string | null
          phone_normalized: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_since?: string
          email?: string | null
          id?: string
          lead_id?: string | null
          name: string
          opportunity_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_since?: string
          email?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          opportunity_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          causation_depth: number
          caused_by_automation_id: string | null
          caused_by_run_id: string | null
          correlation_id: string | null
          created_at: string
          dedupe_key: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          processed_at: string | null
          workspace_id: string
        }
        Insert: {
          causation_depth?: number
          caused_by_automation_id?: string | null
          caused_by_run_id?: string | null
          correlation_id?: string | null
          created_at?: string
          dedupe_key: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          workspace_id: string
        }
        Update: {
          causation_depth?: number
          caused_by_automation_id?: string | null
          caused_by_run_id?: string | null
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_caused_by_automation_id_fkey"
            columns: ["caused_by_automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_caused_by_run_id_fkey"
            columns: ["caused_by_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_definitions: {
        Row: {
          created_at: string
          description: string | null
          key: string
          kind: string
          name: string
          reset_period: string
          sort_order: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          kind: string
          name: string
          reset_period?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          kind?: string
          name?: string
          reset_period?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      entitlement_usage: {
        Row: {
          entitlement_key: string
          period_start: string
          updated_at: string
          used: number
          workspace_id: string
        }
        Insert: {
          entitlement_key: string
          period_start: string
          updated_at?: string
          used?: number
          workspace_id: string
        }
        Update: {
          entitlement_key?: string
          period_start?: string
          updated_at?: string
          used?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_usage_entitlement_key_fkey"
            columns: ["entitlement_key"]
            isOneToOne: false
            referencedRelation: "entitlement_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "entitlement_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_workspace_targets: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          flag_key: string
          reason: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled: boolean
          flag_key: string
          reason: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          flag_key?: string
          reason?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_workspace_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_workspace_targets_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "feature_flag_workspace_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          audience: string
          category: string
          created_at: string
          description: string | null
          is_enabled: boolean
          key: string
          name: string
          plan_codes: string[]
          rollout_percentage: number
          updated_at: string
        }
        Insert: {
          audience?: string
          category?: string
          created_at?: string
          description?: string | null
          is_enabled?: boolean
          key: string
          name: string
          plan_codes?: string[]
          rollout_percentage?: number
          updated_at?: string
        }
        Update: {
          audience?: string
          category?: string
          created_at?: string
          description?: string | null
          is_enabled?: boolean
          key?: string
          name?: string
          plan_codes?: string[]
          rollout_percentage?: number
          updated_at?: string
        }
        Relationships: []
      }
      hosted_profiles: {
        Row: {
          created_at: string
          document_id: string | null
          is_published: boolean
          published_at: string | null
          show_enquiry: boolean
          slug: string
          template_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          is_published?: boolean
          published_at?: string | null
          show_enquiry?: boolean
          slug: string
          template_key?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          is_published?: boolean
          published_at?: string | null
          show_enquiry?: boolean
          slug?: string
          template_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hosted_profiles_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "business_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hosted_profiles_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "profile_templates"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "hosted_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_alerts: {
        Row: {
          alert_type: string
          assigned_staff_id: string | null
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          is_resolved: boolean
          message_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          title: string
          workspace_id: string
        }
        Insert: {
          alert_type: string
          assigned_staff_id?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          is_resolved?: boolean
          message_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          title: string
          workspace_id: string
        }
        Update: {
          alert_type?: string
          assigned_staff_id?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          is_resolved?: boolean
          message_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_alerts_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_alerts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_alerts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_alerts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          staff_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          staff_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversation_reads_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          source: string
          tag: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string
          tag: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string
          tag?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversation_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversation_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_conversations: {
        Row: {
          ai_enabled: boolean
          ai_summary: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_staff_id: string | null
          assigned_staff_name: string | null
          created_at: string
          customer_id: string | null
          display_name: string | null
          first_staff_reply_at: string | null
          human_handoff_requested_at: string | null
          id: string
          inbox_status: string
          intake_completed_at: string | null
          intake_missing_fields: string[]
          intake_payload: Json
          intake_schema_id: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          last_outside_hours_ack_period_key: string | null
          last_staff_reply_at: string | null
          lead_id: string | null
          phone_number: string
          priority_level: string
          referral_ad_id: string | null
          referral_click_id: string | null
          referral_headline: string | null
          referral_source: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
          wa_id: string
          whatsapp_number_id: string
          workspace_id: string
        }
        Insert: {
          ai_enabled?: boolean
          ai_summary?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_staff_id?: string | null
          assigned_staff_name?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          first_staff_reply_at?: string | null
          human_handoff_requested_at?: string | null
          id?: string
          inbox_status?: string
          intake_completed_at?: string | null
          intake_missing_fields?: string[]
          intake_payload?: Json
          intake_schema_id?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_outside_hours_ack_period_key?: string | null
          last_staff_reply_at?: string | null
          lead_id?: string | null
          phone_number: string
          priority_level?: string
          referral_ad_id?: string | null
          referral_click_id?: string | null
          referral_headline?: string | null
          referral_source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          wa_id: string
          whatsapp_number_id: string
          workspace_id: string
        }
        Update: {
          ai_enabled?: boolean
          ai_summary?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_staff_id?: string | null
          assigned_staff_name?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          first_staff_reply_at?: string | null
          human_handoff_requested_at?: string | null
          id?: string
          inbox_status?: string
          intake_completed_at?: string | null
          intake_missing_fields?: string[]
          intake_payload?: Json
          intake_schema_id?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_outside_hours_ack_period_key?: string | null
          last_staff_reply_at?: string | null
          lead_id?: string | null
          phone_number?: string
          priority_level?: string
          referral_ad_id?: string | null
          referral_click_id?: string | null
          referral_headline?: string | null
          referral_source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          wa_id?: string
          whatsapp_number_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_conversations_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_intake_schema_id_fkey"
            columns: ["intake_schema_id"]
            isOneToOne: false
            referencedRelation: "workspace_intake_schemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "workspace_whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_internal_notes: {
        Row: {
          author_id: string
          author_name: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          mentioned_staff_ids: string[]
          workspace_id: string
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          mentioned_staff_ids?: string[]
          workspace_id: string
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mentioned_staff_ids?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_internal_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_internal_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          ai_media_processed_at: string | null
          ai_media_status: string | null
          automation_action_index: number | null
          automation_run_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          dead_letter_reason: string | null
          dead_lettered_at: string | null
          delivery_status: string | null
          direction: string
          id: string
          last_failure_category: string | null
          last_failure_code: string | null
          last_retry_at: string | null
          media_filename: string | null
          media_id: string | null
          media_mime_type: string | null
          media_sha256: string | null
          media_size_bytes: number | null
          media_storage_path: string | null
          message_type: string
          next_retry_at: string | null
          provider_message_id: string | null
          retry_claimed_at: string | null
          retry_count: number
          sender_type: string
          staff_sender_id: string | null
          staff_sender_name: string | null
          template_id: string | null
          template_parameters: string[] | null
          transcribed_at: string | null
          transcript: string | null
          transcription_status: string | null
          workspace_id: string
        }
        Insert: {
          ai_media_processed_at?: string | null
          ai_media_status?: string | null
          automation_action_index?: number | null
          automation_run_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          delivery_status?: string | null
          direction: string
          id?: string
          last_failure_category?: string | null
          last_failure_code?: string | null
          last_retry_at?: string | null
          media_filename?: string | null
          media_id?: string | null
          media_mime_type?: string | null
          media_sha256?: string | null
          media_size_bytes?: number | null
          media_storage_path?: string | null
          message_type?: string
          next_retry_at?: string | null
          provider_message_id?: string | null
          retry_claimed_at?: string | null
          retry_count?: number
          sender_type: string
          staff_sender_id?: string | null
          staff_sender_name?: string | null
          template_id?: string | null
          template_parameters?: string[] | null
          transcribed_at?: string | null
          transcript?: string | null
          transcription_status?: string | null
          workspace_id: string
        }
        Update: {
          ai_media_processed_at?: string | null
          ai_media_status?: string | null
          automation_action_index?: number | null
          automation_run_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          dead_letter_reason?: string | null
          dead_lettered_at?: string | null
          delivery_status?: string | null
          direction?: string
          id?: string
          last_failure_category?: string | null
          last_failure_code?: string | null
          last_retry_at?: string | null
          media_filename?: string | null
          media_id?: string | null
          media_mime_type?: string | null
          media_sha256?: string | null
          media_size_bytes?: number | null
          media_storage_path?: string | null
          message_type?: string
          next_retry_at?: string | null
          provider_message_id?: string | null
          retry_claimed_at?: string | null
          retry_count?: number
          sender_type?: string
          staff_sender_id?: string | null
          staff_sender_name?: string | null
          template_id?: string | null
          template_parameters?: string[] | null
          transcribed_at?: string | null
          transcript?: string | null
          transcription_status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_staff_sender_id_fkey"
            columns: ["staff_sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_attachments: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          lead_id: string
          linked_by: string | null
          media_filename: string | null
          media_mime_type: string | null
          media_size_bytes: number | null
          message_id: string | null
          received_at: string | null
          source: string
          storage_bucket: string
          storage_path: string
          workspace_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          linked_by?: string | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          message_id?: string | null
          received_at?: string | null
          source?: string
          storage_bucket?: string
          storage_path: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          linked_by?: string | null
          media_filename?: string | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          message_id?: string | null
          received_at?: string | null
          source?: string
          storage_bucket?: string
          storage_path?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbox_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          company_name: string | null
          contact_name: string | null
          converted_at: string | null
          created_at: string
          created_by: string | null
          created_from_conversation_id: string | null
          email: string | null
          estimated_value: number | null
          follow_up_completed_at: string | null
          follow_up_note: string | null
          human_reference: string
          id: string
          intake: Json
          lost_at: string | null
          lost_reason: string | null
          next_follow_up_at: string | null
          phone: string | null
          phone_normalized: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          qualification_notes: string | null
          qualification_reason: string | null
          qualification_status: string
          source: string
          source_detail: string | null
          status: string
          summary: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          company_name?: string | null
          contact_name?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_conversation_id?: string | null
          email?: string | null
          estimated_value?: number | null
          follow_up_completed_at?: string | null
          follow_up_note?: string | null
          human_reference: string
          id?: string
          intake?: Json
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          phone?: string | null
          phone_normalized?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          qualification_notes?: string | null
          qualification_reason?: string | null
          qualification_status?: string
          source: string
          source_detail?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          company_name?: string | null
          contact_name?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          created_from_conversation_id?: string | null
          email?: string | null
          estimated_value?: number | null
          follow_up_completed_at?: string | null
          follow_up_note?: string | null
          human_reference?: string
          id?: string
          intake?: Json
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up_at?: string | null
          phone?: string | null
          phone_normalized?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          qualification_notes?: string | null
          qualification_reason?: string | null
          qualification_status?: string
          source?: string
          source_detail?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_from_conversation_id_fkey"
            columns: ["created_from_conversation_id"]
            isOneToOne: false
            referencedRelation: "inbox_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          created_at: string
          document_type: string
          document_version: string
          id: string
          policy_url: string | null
          source: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          document_type: string
          document_version: string
          id?: string
          policy_url?: string | null
          source?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          accepted_at?: string
          created_at?: string
          document_type?: string
          document_version?: string
          id?: string
          policy_url?: string | null
          source?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_document_versions: {
        Row: {
          current_version: string
          document_type: string
          effective_at: string
          updated_at: string
        }
        Insert: {
          current_version: string
          document_type: string
          effective_at: string
          updated_at?: string
        }
        Update: {
          current_version?: string
          document_type?: string
          effective_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          body: string
          change_summary: string | null
          created_at: string
          created_by: string | null
          document_type: string
          effective_at: string
          id: string
          published_at: string | null
          published_by: string | null
          status: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          body: string
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          document_type: string
          effective_at: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          body?: string
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string
          effective_at?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_documents_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title: string
          type?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          actual_value: number | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string | null
          estimated_value: number | null
          id: string
          lead_id: string
          lost_at: string | null
          lost_reason: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          probability: number | null
          status: string
          title: string
          updated_at: string
          won_at: string | null
          workspace_id: string
        }
        Insert: {
          actual_value?: number | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          lead_id: string
          lost_at?: string | null
          lost_reason?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          probability?: number | null
          status?: string
          title: string
          updated_at?: string
          won_at?: string | null
          workspace_id: string
        }
        Update: {
          actual_value?: number | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          lead_id?: string
          lost_at?: string | null
          lost_reason?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          probability?: number | null
          status?: string
          title?: string
          updated_at?: string
          won_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_lost_stage: boolean
          is_won_stage: boolean
          name: string
          pipeline_id: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_lost_stage?: boolean
          is_won_stage?: boolean
          name: string
          pipeline_id: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_lost_stage?: boolean
          is_won_stage?: boolean
          name?: string
          pipeline_id?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          bool_value: boolean | null
          entitlement_key: string
          limit_value: number | null
          plan_id: string
        }
        Insert: {
          bool_value?: boolean | null
          entitlement_key: string
          limit_value?: number | null
          plan_id: string
        }
        Update: {
          bool_value?: boolean | null
          entitlement_key?: string
          limit_value?: number | null
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_entitlement_key_fkey"
            columns: ["entitlement_key"]
            isOneToOne: false
            referencedRelation: "entitlement_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_audit: {
        Row: {
          action: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          operator_user_id: string
          reason: string | null
          target_id: string | null
          target_type: string
          workspace_id: string | null
        }
        Insert: {
          action: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          operator_user_id: string
          reason?: string | null
          target_id?: string | null
          target_type: string
          workspace_id?: string | null
        }
        Update: {
          action?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          operator_user_id?: string
          reason?: string | null
          target_id?: string | null
          target_type?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_audit_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_admin_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_admin_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_deletion_log: {
        Row: {
          cleanup_status: Json
          deleted_at: string
          deleted_by: string | null
          id: string
          row_counts: Json
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }
        Insert: {
          cleanup_status?: Json
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          row_counts?: Json
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }
        Update: {
          cleanup_status?: Json
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          row_counts?: Json
          workspace_id?: string
          workspace_name?: string
          workspace_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_deletion_log_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_operator_actions: {
        Row: {
          action: string
          created_at: string
          id: string
          operator_user_id: string
          reason: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          operator_user_id: string
          reason: string
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          operator_user_id?: string
          reason?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_operator_actions_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_operator_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_templates: {
        Row: {
          config: Json
          description: string | null
          is_active: boolean
          is_premium: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          config?: Json
          description?: string | null
          is_active?: boolean
          is_premium?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          description?: string | null
          is_active?: boolean
          is_premium?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          is_platform_operator: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_platform_operator?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_platform_operator?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      revenue_events: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          event_type: string
          id: string
          lead_id: string | null
          metadata: Json
          occurred_at: string
          opportunity_id: string | null
          reference: string | null
          source: string
          workspace_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency: string
          customer_id?: string | null
          event_type: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          reference?: string | null
          source?: string
          workspace_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          event_type?: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          reference?: string | null
          source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      website_monitors: {
        Row: {
          created_at: string
          enabled: boolean
          frequency_days: number
          last_checked_at: string | null
          last_scan_id: string | null
          next_check_at: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          frequency_days?: number
          last_checked_at?: string | null
          last_scan_id?: string | null
          next_check_at?: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          frequency_days?: number
          last_checked_at?: string | null
          last_scan_id?: string | null
          next_check_at?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_monitors_last_scan_id_fkey"
            columns: ["last_scan_id"]
            isOneToOne: false
            referencedRelation: "website_scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_monitors_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      website_scan_pages: {
        Row: {
          content_hash: string | null
          fetched_at: string
          http_status: number | null
          id: string
          scan_id: string
          text_excerpt: string | null
          title: string | null
          url: string
          workspace_id: string
        }
        Insert: {
          content_hash?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          scan_id: string
          text_excerpt?: string | null
          title?: string | null
          url: string
          workspace_id: string
        }
        Update: {
          content_hash?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          scan_id?: string
          text_excerpt?: string | null
          title?: string | null
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_scan_pages_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "website_scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_scan_pages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      website_scans: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          final_url: string | null
          id: string
          pages_fetched: number
          purpose: string
          requested_url: string
          status: string
          summary: Json
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          final_url?: string | null
          id?: string
          pages_fetched?: number
          purpose?: string
          requested_url: string
          status?: string
          summary?: Json
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          final_url?: string | null
          id?: string
          pages_fetched?: number
          purpose?: string
          requested_url?: string
          status?: string
          summary?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_scans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_scans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          category: string | null
          components: Json
          created_at: string
          id: string
          integration_id: string
          language: string
          last_synced_at: string
          name: string
          provider_status: string
          provider_template_id: string
          updated_at: string
          waba_id: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          components?: Json
          created_at?: string
          id?: string
          integration_id: string
          language: string
          last_synced_at?: string
          name: string
          provider_status: string
          provider_template_id: string
          updated_at?: string
          waba_id: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          components?: Json
          created_at?: string
          id?: string
          integration_id?: string
          language?: string
          last_synced_at?: string
          name?: string
          provider_status?: string
          provider_template_id?: string
          updated_at?: string
          waba_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_templates_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_message_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_template_library: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          industry: string
          is_active: boolean
          language: string
          name: string
          sort_order: number
          template_key: string
          updated_at: string
          use_case: string
          variables: Json
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          id?: string
          industry: string
          is_active?: boolean
          language?: string
          name: string
          sort_order?: number
          template_key: string
          updated_at?: string
          use_case: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          industry?: string
          is_active?: boolean
          language?: string
          name?: string
          sort_order?: number
          template_key?: string
          updated_at?: string
          use_case?: string
          variables?: Json
        }
        Relationships: []
      }
      workspace_activity_log: {
        Row: {
          action: string
          actor_role: Database["public"]["Enums"]["workspace_role"] | null
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_type: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_role?: Database["public"]["Enums"]["workspace_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_role?: Database["public"]["Enums"]["workspace_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_activity_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_billing: {
        Row: {
          created_at: string
          id: string
          limits: Json
          plan: string
          status: string
          trial_ends_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          limits?: Json
          plan?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          limits?: Json
          plan?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_billing_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_business_hours: {
        Row: {
          closes_at: string | null
          created_at: string
          day_of_week: number
          id: string
          is_open: boolean
          opens_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_open?: boolean
          opens_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_open?: boolean
          opens_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_business_hours_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_entitlement_overrides: {
        Row: {
          bool_value: boolean | null
          created_at: string
          created_by: string | null
          entitlement_key: string
          expires_at: string | null
          id: string
          limit_value: number | null
          reason: string
          workspace_id: string
        }
        Insert: {
          bool_value?: boolean | null
          created_at?: string
          created_by?: string | null
          entitlement_key: string
          expires_at?: string | null
          id?: string
          limit_value?: number | null
          reason: string
          workspace_id: string
        }
        Update: {
          bool_value?: boolean | null
          created_at?: string
          created_by?: string | null
          entitlement_key?: string
          expires_at?: string | null
          id?: string
          limit_value?: number | null
          reason?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_entitlement_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_entitlement_overrides_entitlement_key_fkey"
            columns: ["entitlement_key"]
            isOneToOne: false
            referencedRelation: "entitlement_definitions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "workspace_entitlement_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_facebook_pages: {
        Row: {
          connected_at: string
          created_at: string
          id: string
          integration_id: string
          is_active: boolean
          page_id: string
          page_name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          id?: string
          integration_id: string
          is_active?: boolean
          page_id: string
          page_name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          id?: string
          integration_id?: string
          is_active?: boolean
          page_id?: string
          page_name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_facebook_pages_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_facebook_pages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_instagram_accounts: {
        Row: {
          connected_at: string
          created_at: string
          id: string
          ig_business_account_id: string
          integration_id: string
          is_active: boolean
          linked_facebook_page_id: string | null
          updated_at: string
          username: string | null
          workspace_id: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          id?: string
          ig_business_account_id: string
          integration_id: string
          is_active?: boolean
          linked_facebook_page_id?: string | null
          updated_at?: string
          username?: string | null
          workspace_id: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          id?: string
          ig_business_account_id?: string
          integration_id?: string
          is_active?: boolean
          linked_facebook_page_id?: string | null
          updated_at?: string
          username?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_instagram_accounts_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_instagram_accounts_linked_facebook_page_id_fkey"
            columns: ["linked_facebook_page_id"]
            isOneToOne: false
            referencedRelation: "workspace_facebook_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_instagram_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_intake_fields: {
        Row: {
          config: Json
          created_at: string
          field_type: string
          help_text: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          question_text: string
          required: boolean
          schema_id: string
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          field_type: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          question_text: string
          required?: boolean
          schema_id: string
          sort_order?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          field_type?: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          question_text?: string
          required?: boolean
          schema_id?: string
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_intake_fields_schema_id_fkey"
            columns: ["schema_id"]
            isOneToOne: false
            referencedRelation: "workspace_intake_schemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_intake_fields_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_intake_schemas: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_intake_schemas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_intake_schemas_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_integration_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          state: string
          used_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          provider: Database["public"]["Enums"]["integration_provider"]
          state: string
          used_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          state?: string
          used_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_integration_oauth_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_integration_oauth_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_integrations: {
        Row: {
          connected_at: string | null
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          id: string
          last_health_check_at: string | null
          last_health_check_message: string | null
          last_health_check_status: string | null
          last_success_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["integration_status"]
          token_expires_at: string | null
          updated_at: string
          vault_secret_id: string | null
          webhook_subscription_checked_at: string | null
          webhook_subscription_detail: string | null
          webhook_subscription_status: string | null
          workspace_id: string
        }
        Insert: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_health_check_at?: string | null
          last_health_check_message?: string | null
          last_health_check_status?: string | null
          last_success_at?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
          vault_secret_id?: string | null
          webhook_subscription_checked_at?: string | null
          webhook_subscription_detail?: string | null
          webhook_subscription_status?: string | null
          workspace_id: string
        }
        Update: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          last_health_check_at?: string | null
          last_health_check_message?: string | null
          last_health_check_status?: string | null
          last_success_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
          vault_secret_id?: string | null
          webhook_subscription_checked_at?: string | null
          webhook_subscription_detail?: string | null
          webhook_subscription_status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_integrations_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_invitation_status"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["workspace_invitation_status"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["workspace_invitation_status"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_lead_counters: {
        Row: {
          last_value: number
          workspace_id: string
        }
        Insert: {
          last_value?: number
          workspace_id: string
        }
        Update: {
          last_value?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_lead_counters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_meta_ad_accounts: {
        Row: {
          ad_account_id: string
          connected_at: string
          created_at: string
          currency: string | null
          id: string
          integration_id: string
          is_active: boolean
          name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          connected_at?: string
          created_at?: string
          currency?: string | null
          id?: string
          integration_id: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          connected_at?: string
          created_at?: string
          currency?: string | null
          id?: string
          integration_id?: string
          is_active?: boolean
          name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_meta_ad_accounts_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_meta_ad_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_purchases: {
        Row: {
          access_expires_at: string | null
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          id: string
          paid_at: string | null
          plan_id: string
          price_id: string
          provider: string
          provider_reference: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_expires_at?: string | null
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          paid_at?: string | null
          plan_id: string
          price_id: string
          provider?: string
          provider_reference?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_expires_at?: string | null
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          paid_at?: string | null
          plan_id?: string
          price_id?: string
          provider?: string
          provider_reference?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_purchases_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_purchases_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "billing_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["workspace_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["workspace_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["workspace_role"]
        }
        Relationships: []
      }
      workspace_settings: {
        Row: {
          ad_footer_disclaimer: string | null
          ai_multimodal_enabled: boolean
          ai_voice_transcription_enabled: boolean
          brand_accent_color: string | null
          brand_cta_text_color: string | null
          brand_primary_color: string | null
          business_description: string | null
          business_hours_enabled: boolean
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          default_ad_cta: string | null
          feature_flags: Json
          handoff_keywords: string[]
          handoff_sla_enabled: boolean
          handoff_sla_minutes: number
          id: string
          industry: string | null
          logo_path: string | null
          match_customer_language: boolean
          outside_hours_auto_reply_enabled: boolean
          outside_hours_auto_reply_message: string | null
          secondary_brand_color: string | null
          terminology: Json
          timezone: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          ad_footer_disclaimer?: string | null
          ai_multimodal_enabled?: boolean
          ai_voice_transcription_enabled?: boolean
          brand_accent_color?: string | null
          brand_cta_text_color?: string | null
          brand_primary_color?: string | null
          business_description?: string | null
          business_hours_enabled?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          default_ad_cta?: string | null
          feature_flags?: Json
          handoff_keywords?: string[]
          handoff_sla_enabled?: boolean
          handoff_sla_minutes?: number
          id?: string
          industry?: string | null
          logo_path?: string | null
          match_customer_language?: boolean
          outside_hours_auto_reply_enabled?: boolean
          outside_hours_auto_reply_message?: string | null
          secondary_brand_color?: string | null
          terminology?: Json
          timezone?: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          ad_footer_disclaimer?: string | null
          ai_multimodal_enabled?: boolean
          ai_voice_transcription_enabled?: boolean
          brand_accent_color?: string | null
          brand_cta_text_color?: string | null
          brand_primary_color?: string | null
          business_description?: string | null
          business_hours_enabled?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          default_ad_cta?: string | null
          feature_flags?: Json
          handoff_keywords?: string[]
          handoff_sla_enabled?: boolean
          handoff_sla_minutes?: number
          id?: string
          industry?: string | null
          logo_path?: string | null
          match_customer_language?: boolean
          outside_hours_auto_reply_enabled?: boolean
          outside_hours_auto_reply_message?: string | null
          secondary_brand_color?: string | null
          terminology?: Json
          timezone?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          current_period_end: string | null
          current_period_start: string | null
          grace_until: string | null
          id: string
          plan_id: string
          price_id: string | null
          provider: string
          provider_customer_code: string | null
          provider_email_token: string | null
          provider_subscription_code: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          grace_until?: string | null
          id?: string
          plan_id: string
          price_id?: string | null
          provider?: string
          provider_customer_code?: string | null
          provider_email_token?: string | null
          provider_subscription_code?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          grace_until?: string | null
          id?: string
          plan_id?: string
          price_id?: string | null
          provider?: string
          provider_customer_code?: string | null
          provider_email_token?: string | null
          provider_subscription_code?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_subscriptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_subscriptions_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "billing_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_whatsapp_numbers: {
        Row: {
          connected_at: string
          created_at: string
          display_phone_number: string | null
          id: string
          intake_schema_id: string | null
          integration_id: string
          is_active: boolean
          phone_number_id: string
          platform_status: string | null
          quality_rating: string | null
          updated_at: string
          verified_name: string | null
          waba_id: string | null
          workspace_id: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          intake_schema_id?: string | null
          integration_id: string
          is_active?: boolean
          phone_number_id: string
          platform_status?: string | null
          quality_rating?: string | null
          updated_at?: string
          verified_name?: string | null
          waba_id?: string | null
          workspace_id: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          intake_schema_id?: string | null
          integration_id?: string
          is_active?: boolean
          phone_number_id?: string
          platform_status?: string | null
          quality_rating?: string | null
          updated_at?: string
          verified_name?: string | null
          waba_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_whatsapp_numbers_intake_schema_id_fkey"
            columns: ["intake_schema_id"]
            isOneToOne: false
            referencedRelation: "workspace_intake_schemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_whatsapp_numbers_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "workspace_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_whatsapp_numbers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_whatsapp_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload_summary: Json
          phone_number_id: string
          provider_event_id: string
          received_at: string
          workspace_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          payload_summary?: Json
          phone_number_id: string
          provider_event_id: string
          received_at?: string
          workspace_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          payload_summary?: Json
          phone_number_id?: string
          provider_event_id?: string
          received_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_whatsapp_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _admin_like: { Args: { p_q: string }; Returns: string }
      _admin_workspace_is_paying: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      _workspace_access_plans: {
        Args: { p_workspace_id: string }
        Returns: {
          plan_code: string
          plan_id: string
          source: string
          tier_rank: number
        }[]
      }
      _workspace_entitlements: {
        Args: { p_workspace_id: string }
        Returns: {
          enabled: boolean
          entitlement_key: string
          kind: string
          limit_value: number
          source: string
          unlimited: boolean
          used: number
        }[]
      }
      accept_business_fact_proposal: {
        Args: { p_edited?: Json; p_proposal_id: string }
        Returns: string
      }
      accept_current_legal_terms: {
        Args: never
        Returns: {
          accepted_at: string
          document_type: string
          document_version: string
        }[]
      }
      accept_workspace_invitation: {
        Args: { p_token: string }
        Returns: string
      }
      admin_activity_feed: { Args: { p_limit?: number }; Returns: Json }
      admin_attention_signals: { Args: never; Returns: Json }
      admin_find_user_by_email: { Args: { p_email: string }; Returns: string }
      admin_overview: { Args: { p_from: string; p_to: string }; Returns: Json }
      admin_revenue: { Args: { p_from: string; p_to: string }; Returns: Json }
      admin_search: { Args: { p_q: string }; Returns: Json }
      admin_staff: { Args: never; Returns: Json }
      admin_user_detail: { Args: { p_user_id: string }; Returns: Json }
      admin_users_page: {
        Args: {
          p_filter: string
          p_limit: number
          p_offset: number
          p_search: string
        }
        Returns: Json
      }
      admin_workspace_detail: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      admin_workspaces_page: {
        Args: {
          p_filter: string
          p_limit: number
          p_offset: number
          p_search: string
        }
        Returns: Json
      }
      ai_list_campaigns: {
        Args: { p_limit?: number; p_status?: string; p_workspace_id: string }
        Returns: {
          created_at: string
          currency: string
          daily_budget_minor_units: number
          end_at: string
          id: string
          lifetime_budget_minor_units: number
          name: string
          objective: string
          start_at: string
          status: string
        }[]
      }
      ai_list_content: {
        Args: { p_limit?: number; p_status?: string; p_workspace_id: string }
        Returns: {
          caption_preview: string
          id: string
          published_at: string
          scheduled_at: string
          status: string
          target_platform: string
        }[]
      }
      ai_list_customers: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_workspace_id: string
        }
        Returns: {
          company_name: string
          customer_since: string
          id: string
          name: string
        }[]
      }
      ai_list_integrations: {
        Args: { p_workspace_id: string }
        Returns: {
          connected_at: string
          last_health_check_at: string
          last_health_check_status: string
          provider: string
          status: string
        }[]
      }
      ai_list_leads: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_qualification_status?: string
          p_status?: string
          p_workspace_id: string
        }
        Returns: {
          company_name: string
          contact_name: string
          created_at: string
          human_reference: string
          id: string
          qualification_status: string
          source: string
          status: string
        }[]
      }
      ai_list_opportunities: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_status?: string
          p_workspace_id: string
        }
        Returns: {
          actual_value: number
          created_at: string
          estimated_value: number
          id: string
          lost_at: string
          probability: number
          status: string
          title: string
          won_at: string
        }[]
      }
      apply_whatsapp_retry_outcome: {
        Args: {
          p_actor?: string
          p_failure_category?: string
          p_failure_code?: string
          p_message_id: string
          p_outcome: string
          p_provider_message_id?: string
          p_source?: string
        }
        Returns: Json
      }
      assert_workspace_billing_reader: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      backfill_lead_pipeline_placement: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      billing_apply_charge_success: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_paid_at: string
          p_reference: string
          p_via: string
        }
        Returns: string
      }
      billing_apply_renewal: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_next_payment_at: string
          p_paid_at: string
          p_reference: string
          p_subscription_code: string
          p_via: string
        }
        Returns: string
      }
      billing_interval_to_interval: {
        Args: { p_interval: string }
        Returns: string
      }
      billing_link_provider_subscription: {
        Args: {
          p_customer_code: string
          p_email_token: string
          p_next_payment_at: string
          p_plan_code: string
          p_subscription_code: string
        }
        Returns: string
      }
      billing_log_subscription_event: {
        Args: {
          p_actor: string
          p_from: string
          p_reason: string
          p_sub: Database["public"]["Tables"]["workspace_subscriptions"]["Row"]
          p_to: string
        }
        Returns: undefined
      }
      billing_transition_subscription: {
        Args: {
          p_actor: string
          p_expected_from: string
          p_grace_until?: string
          p_reason: string
          p_subscription_id: string
          p_to: string
        }
        Returns: boolean
      }
      business_fact_source_valid: {
        Args: { p_source: string }
        Returns: boolean
      }
      business_fact_verification_valid: {
        Args: { p_status: string }
        Returns: boolean
      }
      business_minutes_between: {
        Args: { p_end: string; p_start: string; p_workspace_id: string }
        Returns: number
      }
      business_upsert_primary_contact: {
        Args: { p_kind: string; p_value: string; p_workspace_id: string }
        Returns: undefined
      }
      can_grant_workspace_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      can_manage_member_with_role: {
        Args: {
          p_current_role: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      claim_outside_hours_ack: {
        Args: { p_conversation_id: string; p_period_key: string }
        Returns: boolean
      }
      claim_whatsapp_retry_batch: {
        Args: { p_limit?: number }
        Returns: {
          content: string
          conversation_id: string
          delivery_status: string
          id: string
          message_type: string
          provider_message_id: string
          retry_count: number
          sender_type: string
          template_id: string
          template_parameters: string[]
          workspace_id: string
        }[]
      }
      clear_workspace_integration_secret: {
        Args: { p_integration_id: string }
        Returns: undefined
      }
      consume_entitlement: {
        Args: { p_amount?: number; p_key: string; p_workspace_id: string }
        Returns: boolean
      }
      content_storage_path_workspace_id: {
        Args: { p_name: string }
        Returns: string
      }
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      cron_function_url: { Args: { p_function: string }; Returns: string }
      current_legal_versions: {
        Args: never
        Returns: {
          current_version: string
          document_type: string
          effective_at: string
        }[]
      }
      customer_360: {
        Args: { p_customer_id: string; p_workspace_id: string }
        Returns: Json
      }
      customer_match_candidates: {
        Args: { p_conversation_id: string; p_workspace_id: string }
        Returns: {
          company_name: string
          customer_id: string
          email: string
          match_reason: string
          match_tier: string
          name: string
          phone: string
        }[]
      }
      customers_search: {
        Args: { p_limit?: number; p_query?: string; p_workspace_id: string }
        Returns: {
          assigned_to_name: string
          company_name: string
          customer_since: string
          email: string
          id: string
          last_interaction: string
          name: string
          open_opportunities: number
          phone: string
          revenue_by_currency: Json
          status: string
          total_opportunities: number
        }[]
      }
      ensure_default_pipeline: {
        Args: { p_created_by?: string; p_workspace_id: string }
        Returns: {
          created: boolean
          pipeline_id: string
        }[]
      }
      evaluate_feature_flags: {
        Args: { p_workspace_id: string }
        Returns: {
          enabled: boolean
          flag_key: string
          reason: string
        }[]
      }
      feature_flag_bucket: {
        Args: { p_flag_key: string; p_workspace_id: string }
        Returns: number
      }
      get_analytics_kpis: {
        Args: { p_date_from: string; p_date_to: string; p_workspace_id: string }
        Returns: {
          conversations: number
          customers: number
          leads: number
          opportunities: number
          qualified_leads: number
          revenue_attributed: Json
          revenue_total: Json
          revenue_unattributed: Json
          spend: Json
        }[]
      }
      get_campaign_conversion_counts: {
        Args: { p_campaign_id: string; p_workspace_id: string }
        Returns: {
          conversations: number
          customers: number
          leads: number
          opportunities: number
        }[]
      }
      get_campaign_journey: {
        Args: {
          p_attribution_model?: string
          p_campaign_id: string
          p_workspace_id: string
        }
        Returns: {
          ad_breakdown: Json
          adset_breakdown: Json
          campaign_id: string
          clicks: number
          conversations: number
          conversations_direct: number
          conversations_inferred: number
          creative_breakdown: Json
          currency: string
          customers: number
          customers_direct: number
          customers_inferred: number
          impressions: number
          leads: number
          leads_direct: number
          leads_inferred: number
          metrics_available: boolean
          name: string
          opportunities: number
          opportunities_direct: number
          opportunities_inferred: number
          qualified_leads: number
          reach: number
          revenue: Json
          spend_minor: number
          status: string
        }[]
      }
      get_campaign_journey_entities: {
        Args: {
          p_attribution_model?: string
          p_campaign_id: string
          p_limit?: number
          p_offset?: number
          p_stage: string
          p_workspace_id: string
        }
        Returns: {
          attribution_confidence: string
          attribution_method: string
          conversation_id: string
          customer_id: string
          entity_id: string
          lead_id: string
          occurred_at: string
          opportunity_id: string
          primary_label: string
          secondary_label: string
          status_label: string
        }[]
      }
      get_campaign_performance: {
        Args: {
          p_attribution_model?: string
          p_date_from: string
          p_date_to: string
          p_workspace_id: string
        }
        Returns: {
          campaign_id: string
          clicks: number
          conversations: number
          currency: string
          customers: number
          impressions: number
          leads: number
          name: string
          opportunities: number
          qualified_leads: number
          reach: number
          revenue: Json
          spend_minor: number
          status: string
        }[]
      }
      get_creative_performance: {
        Args: {
          p_attribution_model?: string
          p_date_from: string
          p_date_to: string
          p_workspace_id: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          conversations: number
          creative_id: string
          customers: number
          leads: number
          media_storage_path: string
          primary_text: string
          revenue: Json
        }[]
      }
      get_inbox_conversations: {
        Args: {
          p_assigned_staff_id?: string
          p_assignment?: string
          p_cursor_id?: string
          p_cursor_updated_at?: string
          p_handling?: string
          p_inbox_status?: string
          p_limit?: number
          p_priority?: string
          p_search?: string
          p_unread_only?: boolean
          p_workspace_id: string
        }
        Returns: {
          ai_enabled: boolean
          ai_summary: string
          assigned_staff_id: string
          assigned_staff_name: string
          customer_id: string
          display_name: string
          human_handoff_requested_at: string
          id: string
          inbox_status: string
          intake_completed_at: string
          intake_missing_fields: string[]
          intake_payload: Json
          intake_schema_id: string
          is_unread: boolean
          last_inbound_at: string
          last_outbound_at: string
          last_staff_reply_at: string
          lead_id: string
          phone_number: string
          priority_level: string
          status: string
          updated_at: string
          wa_id: string
        }[]
      }
      get_lead_source_breakdown: {
        Args: { p_date_from: string; p_date_to: string; p_workspace_id: string }
        Returns: {
          lead_count: number
          source_label: string
        }[]
      }
      get_public_business_profile: { Args: { p_slug: string }; Returns: Json }
      get_recent_whatsapp_webhook_events: {
        Args: { p_limit?: number; p_workspace_id: string }
        Returns: {
          event_type: string
          id: string
          is_unresolved: boolean
          message_type: string
          outcome: string
          phone_number_id: string
          received_at: string
          resolved: boolean
        }[]
      }
      get_revenue_breakdown: {
        Args: { p_date_from: string; p_date_to: string; p_workspace_id: string }
        Returns: {
          bucket_key: string
          bucket_label: string
          dimension: string
          event_count: number
          revenue: Json
        }[]
      }
      get_touch_summary: {
        Args: {
          p_target_id: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: {
          ad_id: string
          attribution_confidence: string
          campaign_id: string
          creative_id: string
          event_id: string
          occurred_at: string
          platform: string
          source: string
          source_type: string
          touch_kind: string
        }[]
      }
      get_whatsapp_analytics: {
        Args: { p_date_from: string; p_date_to: string; p_workspace_id: string }
        Returns: {
          ai_reply_count: number
          became_customers: number
          became_leads: number
          became_qualified: number
          conversations_started: number
          staff_reply_count: number
        }[]
      }
      get_whatsapp_operational_analytics: {
        Args: { p_date_from: string; p_date_to: string; p_workspace_id: string }
        Returns: {
          conversations_resolved: number
          conversations_started: number
          conversations_with_handoff: number
          handled_ai_only: number
          handled_human_assisted: number
          handled_human_only: number
          handled_no_agent_reply: number
          handoff_rate: number
          human_response_sample_size: number
          inbound_messages: number
          intake_applicable: number
          intake_completed: number
          intake_completion_rate: number
          median_human_response_seconds: number
          median_resolution_seconds: number
        }[]
      }
      get_workspace_entitlements: {
        Args: { p_workspace_id: string }
        Returns: {
          enabled: boolean
          entitlement_key: string
          kind: string
          limit_value: number
          source: string
          unlimited: boolean
          used: number
        }[]
      }
      get_workspace_integration_secret: {
        Args: { p_integration_id: string }
        Returns: string
      }
      has_workspace_permission: {
        Args: { p_permission: string; p_workspace_id: string }
        Returns: boolean
      }
      has_workspace_permission_for: {
        Args: {
          p_permission: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          p_min_role: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      inbox_storage_path_workspace_id: {
        Args: { p_name: string }
        Returns: string
      }
      is_feature_enabled: {
        Args: { p_flag_key: string; p_workspace_id: string }
        Returns: boolean
      }
      is_hosted_profile_slug_available: {
        Args: { p_slug: string }
        Returns: boolean
      }
      is_platform_operator: { Args: never; Returns: boolean }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_slug_available: {
        Args: { p_exclude_workspace_id?: string; p_slug: string }
        Returns: boolean
      }
      legal_acceptance_stats: {
        Args: never
        Returns: {
          acceptances: number
          document_type: string
          document_version: string
          last_accepted_at: string
        }[]
      }
      my_admin_role: { Args: never; Returns: string }
      my_legal_acceptance_status: { Args: never; Returns: string }
      next_lead_reference: { Args: { p_workspace_id: string }; Returns: string }
      normalize_phone_number: { Args: { p_raw: string }; Returns: string }
      platform_setting_int: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      publish_legal_document: {
        Args: { p_document_id: string; p_operator_id: string }
        Returns: string
      }
      reaccept_current_legal_terms: { Args: never; Returns: string }
      reject_business_fact_proposal: {
        Args: { p_proposal_id: string }
        Returns: string
      }
      set_workspace_inbox_ai_cap: {
        Args: { p_cap?: number; p_workspace_id: string }
        Returns: number
      }
      set_workspace_integration_secret: {
        Args: { p_integration_id: string; p_secret: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sla_sweep: { Args: never; Returns: Json }
      valid_handoff_keywords: { Args: { p: string[] }; Returns: boolean }
      workspace_access_plans: {
        Args: { p_workspace_id: string }
        Returns: {
          plan_code: string
          plan_id: string
          source: string
          tier_rank: number
        }[]
      }
      workspace_ai_token_cap: {
        Args: { p_feature: string; p_workspace_id: string }
        Returns: number
      }
      workspace_assets_path_workspace_id: {
        Args: { p_name: string }
        Returns: string
      }
      workspace_closed_period_key: {
        Args: { p_at: string; p_workspace_id: string }
        Returns: string
      }
      workspace_has_entitlement: {
        Args: { p_key: string; p_workspace_id: string }
        Returns: boolean
      }
      workspace_is_open_at: {
        Args: { p_at: string; p_workspace_id: string }
        Returns: boolean
      }
      workspace_plan_codes: {
        Args: { p_workspace_id: string }
        Returns: string[]
      }
      workspace_role_rank: {
        Args: { p_role: Database["public"]["Enums"]["workspace_role"] }
        Returns: number
      }
    }
    Enums: {
      ad_budget_type: "daily" | "lifetime"
      ad_campaign_objective:
        | "OUTCOME_AWARENESS"
        | "OUTCOME_TRAFFIC"
        | "OUTCOME_ENGAGEMENT"
        | "OUTCOME_SALES"
      ad_creative_status: "draft" | "ready" | "active" | "archived"
      ad_destination_type: "website" | "whatsapp" | "page_profile"
      ad_lifecycle_status:
        | "draft"
        | "ready"
        | "publishing"
        | "active"
        | "paused"
        | "completed"
        | "failed"
      ad_publish_operation_status:
        | "pending"
        | "in_progress"
        | "succeeded"
        | "partial"
        | "failed"
      content_asset_role:
        | "reference_creative"
        | "product_image"
        | "logo"
        | "background"
      content_asset_status: "active" | "archived"
      content_platform: "facebook" | "instagram" | "linkedin"
      content_post_status:
        | "draft"
        | "scheduled"
        | "publishing"
        | "published"
        | "failed"
        | "cancelled"
        | "skipped"
      content_publish_attempt_status:
        | "success"
        | "temporary_failure"
        | "permanent_failure"
      content_series_status:
        | "draft"
        | "approved"
        | "active"
        | "paused"
        | "completed"
        | "archived"
      creative_studio_batch_status:
        | "draft"
        | "generating"
        | "ready"
        | "partial"
        | "failed"
      creative_studio_creative_status:
        | "rendering"
        | "ready"
        | "approved"
        | "rejected"
        | "failed"
      creative_studio_visual_source: "ai" | "media_library"
      creative_studio_visual_status:
        | "pending"
        | "generating"
        | "ready"
        | "failed"
      integration_provider: "meta" | "whatsapp"
      integration_status: "connected" | "disconnected" | "error"
      workspace_invitation_status:
        | "pending"
        | "accepted"
        | "revoked"
        | "expired"
      workspace_role:
        | "owner"
        | "admin"
        | "manager"
        | "marketing"
        | "sales"
        | "support"
        | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ad_budget_type: ["daily", "lifetime"],
      ad_campaign_objective: [
        "OUTCOME_AWARENESS",
        "OUTCOME_TRAFFIC",
        "OUTCOME_ENGAGEMENT",
        "OUTCOME_SALES",
      ],
      ad_creative_status: ["draft", "ready", "active", "archived"],
      ad_destination_type: ["website", "whatsapp", "page_profile"],
      ad_lifecycle_status: [
        "draft",
        "ready",
        "publishing",
        "active",
        "paused",
        "completed",
        "failed",
      ],
      ad_publish_operation_status: [
        "pending",
        "in_progress",
        "succeeded",
        "partial",
        "failed",
      ],
      content_asset_role: [
        "reference_creative",
        "product_image",
        "logo",
        "background",
      ],
      content_asset_status: ["active", "archived"],
      content_platform: ["facebook", "instagram", "linkedin"],
      content_post_status: [
        "draft",
        "scheduled",
        "publishing",
        "published",
        "failed",
        "cancelled",
        "skipped",
      ],
      content_publish_attempt_status: [
        "success",
        "temporary_failure",
        "permanent_failure",
      ],
      content_series_status: [
        "draft",
        "approved",
        "active",
        "paused",
        "completed",
        "archived",
      ],
      creative_studio_batch_status: [
        "draft",
        "generating",
        "ready",
        "partial",
        "failed",
      ],
      creative_studio_creative_status: [
        "rendering",
        "ready",
        "approved",
        "rejected",
        "failed",
      ],
      creative_studio_visual_source: ["ai", "media_library"],
      creative_studio_visual_status: [
        "pending",
        "generating",
        "ready",
        "failed",
      ],
      integration_provider: ["meta", "whatsapp"],
      integration_status: ["connected", "disconnected", "error"],
      workspace_invitation_status: [
        "pending",
        "accepted",
        "revoked",
        "expired",
      ],
      workspace_role: [
        "owner",
        "admin",
        "manager",
        "marketing",
        "sales",
        "support",
        "viewer",
      ],
    },
  },
} as const
