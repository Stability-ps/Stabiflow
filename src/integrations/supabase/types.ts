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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      attribution_events: {
        Row: {
          attribution_confidence: string | null
          attribution_source: string | null
          created_at: string
          event_type: string
          external_ad_id: string | null
          external_adset_id: string | null
          external_campaign_id: string | null
          external_creative_id: string | null
          id: string
          metadata: Json
          occurred_at: string
          platform: string | null
          subject_id: string | null
          subject_type: string | null
          workspace_id: string
        }
        Insert: {
          attribution_confidence?: string | null
          attribution_source?: string | null
          created_at?: string
          event_type: string
          external_ad_id?: string | null
          external_adset_id?: string | null
          external_campaign_id?: string | null
          external_creative_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          platform?: string | null
          subject_id?: string | null
          subject_type?: string | null
          workspace_id: string
        }
        Update: {
          attribution_confidence?: string | null
          attribution_source?: string | null
          created_at?: string
          event_type?: string
          external_ad_id?: string | null
          external_adset_id?: string | null
          external_campaign_id?: string | null
          external_creative_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          platform?: string | null
          subject_id?: string | null
          subject_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribution_events_workspace_id_fkey"
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
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
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          limits?: Json
          plan?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          limits?: Json
          plan?: string
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
      workspace_integrations: {
        Row: {
          connected_at: string | null
          connected_by: string | null
          created_at: string
          id: string
          last_health_check_at: string | null
          last_health_check_message: string | null
          last_health_check_status: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
          vault_secret_id: string | null
          workspace_id: string
        }
        Insert: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          id?: string
          last_health_check_at?: string | null
          last_health_check_message?: string | null
          last_health_check_status?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          vault_secret_id?: string | null
          workspace_id: string
        }
        Update: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          id?: string
          last_health_check_at?: string | null
          last_health_check_message?: string | null
          last_health_check_status?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
          vault_secret_id?: string | null
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
          created_at: string
          feature_flags: Json
          id: string
          terminology: Json
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          feature_flags?: Json
          id?: string
          terminology?: Json
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          feature_flags?: Json
          id?: string
          terminology?: Json
          timezone?: string
          updated_at?: string
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
      workspace_whatsapp_numbers: {
        Row: {
          connected_at: string
          created_at: string
          display_phone_number: string | null
          id: string
          integration_id: string
          is_active: boolean
          phone_number_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          integration_id: string
          is_active?: boolean
          phone_number_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          integration_id?: string
          is_active?: boolean
          phone_number_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
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
      accept_workspace_invitation: {
        Args: { p_token: string }
        Returns: string
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
      content_storage_path_workspace_id: {
        Args: { p_name: string }
        Returns: string
      }
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      get_workspace_integration_secret: {
        Args: { p_integration_id: string }
        Returns: string
      }
      has_workspace_permission: {
        Args: { p_permission: string; p_workspace_id: string }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          p_min_role: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      set_workspace_integration_secret: {
        Args: { p_integration_id: string; p_secret: string }
        Returns: undefined
      }
      workspace_role_rank: {
        Args: { p_role: Database["public"]["Enums"]["workspace_role"] }
        Returns: number
      }
    }
    Enums: {
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
