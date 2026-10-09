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
      fh_agent_runs: {
        Row: {
          agent_id: string
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          contact_id: string | null
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          error: string | null
          executed_message_id: string | null
          id: string
          input: Json
          mode: string
          org_id: string
          output: Json | null
          proposal: Json | null
          run_id: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          executed_message_id?: string | null
          id?: string
          input?: Json
          mode?: string
          org_id: string
          output?: Json | null
          proposal?: Json | null
          run_id?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          trigger_kind?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          executed_message_id?: string | null
          id?: string
          input?: Json
          mode?: string
          org_id?: string
          output?: Json | null
          proposal?: Json | null
          run_id?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "fh_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_v_inbox"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "fh_agent_runs_executed_message_id_fkey"
            columns: ["executed_message_id"]
            isOneToOne: false
            referencedRelation: "fh_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_executed_message_id_fkey"
            columns: ["executed_message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_call_log"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fh_agent_runs_executed_message_id_fkey"
            columns: ["executed_message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_response_times"
            referencedColumns: ["inbound_message_id"]
          },
          {
            foreignKeyName: "fh_agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_agent_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_agents: {
        Row: {
          autonomy: string
          created_at: string
          description: string | null
          guardrails: Json
          id: string
          key: string
          model: string
          name: string
          org_id: string
          stats: Json
          status: string
          system_prompt: string
          tools: string[]
          updated_at: string
        }
        Insert: {
          autonomy?: string
          created_at?: string
          description?: string | null
          guardrails?: Json
          id?: string
          key: string
          model?: string
          name: string
          org_id: string
          stats?: Json
          status?: string
          system_prompt: string
          tools?: string[]
          updated_at?: string
        }
        Update: {
          autonomy?: string
          created_at?: string
          description?: string | null
          guardrails?: Json
          id?: string
          key?: string
          model?: string
          name?: string
          org_id?: string
          stats?: Json
          status?: string
          system_prompt?: string
          tools?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      fh_appointments: {
        Row: {
          assigned_to: string | null
          booking_type_id: string | null
          client_id: string
          contact_id: string | null
          created_at: string
          end_at: string
          id: string
          location: string | null
          manage_token: string
          notes: string | null
          org_id: string
          reminders_sent: number[]
          schedule_id: string | null
          source: string
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          booking_type_id?: string | null
          client_id: string
          contact_id?: string | null
          created_at?: string
          end_at: string
          id?: string
          location?: string | null
          manage_token?: string
          notes?: string | null
          org_id: string
          reminders_sent?: number[]
          schedule_id?: string | null
          source?: string
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          booking_type_id?: string | null
          client_id?: string
          contact_id?: string | null
          created_at?: string
          end_at?: string
          id?: string
          location?: string | null
          manage_token?: string
          notes?: string | null
          org_id?: string
          reminders_sent?: number[]
          schedule_id?: string | null
          source?: string
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_appointments_booking_type_id_fkey"
            columns: ["booking_type_id"]
            isOneToOne: false
            referencedRelation: "fh_booking_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_appointments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_appointments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "fh_schedule"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_booking_types: {
        Row: {
          assigned_user_ids: string[]
          availability: Json | null
          block_on_schedule: boolean
          buffer_after_min: number
          buffer_before_min: number
          confirmation_email_body: string | null
          confirmation_email_subject: string | null
          confirmation_sms: string | null
          created_at: string
          description: string | null
          duration_min: number
          id: string
          key: string
          location_mode: string
          max_days_ahead: number
          max_per_day: number
          min_notice_hours: number
          name: string
          org_id: string
          reminder_offsets_min: number[]
          reminder_sms: string | null
          slot_interval_min: number | null
          status: string
          tags: Json
          updated_at: string
        }
        Insert: {
          assigned_user_ids?: string[]
          availability?: Json | null
          block_on_schedule?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          confirmation_email_body?: string | null
          confirmation_email_subject?: string | null
          confirmation_sms?: string | null
          created_at?: string
          description?: string | null
          duration_min?: number
          id?: string
          key: string
          location_mode?: string
          max_days_ahead?: number
          max_per_day?: number
          min_notice_hours?: number
          name: string
          org_id: string
          reminder_offsets_min?: number[]
          reminder_sms?: string | null
          slot_interval_min?: number | null
          status?: string
          tags?: Json
          updated_at?: string
        }
        Update: {
          assigned_user_ids?: string[]
          availability?: Json | null
          block_on_schedule?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          confirmation_email_body?: string | null
          confirmation_email_subject?: string | null
          confirmation_sms?: string | null
          created_at?: string
          description?: string | null
          duration_min?: number
          id?: string
          key?: string
          location_mode?: string
          max_days_ahead?: number
          max_per_day?: number
          min_notice_hours?: number
          name?: string
          org_id?: string
          reminder_offsets_min?: number[]
          reminder_sms?: string | null
          slot_interval_min?: number | null
          status?: string
          tags?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_booking_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_campaign_recipients: {
        Row: {
          campaign_id: string
          client_id: string
          created_at: string
          id: string
          message_id: string | null
          org_id: string
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          org_id: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          org_id?: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "fh_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_campaign_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_campaign_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_campaign_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_call_log"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fh_campaign_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_response_times"
            referencedColumns: ["inbound_message_id"]
          },
          {
            foreignKeyName: "fh_campaign_recipients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_campaigns: {
        Row: {
          audience: Json
          body: string
          body_html: string | null
          channel: string
          created_at: string
          created_by: string | null
          id: string
          launched_at: string | null
          name: string
          org_id: string
          phone_number_id: string | null
          purpose: string
          scheduled_at: string | null
          segment_id: string | null
          stats: Json
          status: string
          subject: string | null
          throttle_per_minute: number
          updated_at: string
        }
        Insert: {
          audience?: Json
          body?: string
          body_html?: string | null
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          launched_at?: string | null
          name: string
          org_id: string
          phone_number_id?: string | null
          purpose?: string
          scheduled_at?: string | null
          segment_id?: string | null
          stats?: Json
          status?: string
          subject?: string | null
          throttle_per_minute?: number
          updated_at?: string
        }
        Update: {
          audience?: Json
          body?: string
          body_html?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          launched_at?: string | null
          name?: string
          org_id?: string
          phone_number_id?: string | null
          purpose?: string
          scheduled_at?: string | null
          segment_id?: string | null
          stats?: Json
          status?: string
          subject?: string | null
          throttle_per_minute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_campaigns_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "fh_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "fh_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_change_orders: {
        Row: {
          amount: number
          approval_method: string | null
          approved_at: string | null
          approved_by_name: string | null
          contact_id: string
          created_at: string
          description: string | null
          id: string
          org_id: string | null
          sequence_number: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          approval_method?: string | null
          approved_at?: string | null
          approved_by_name?: string | null
          contact_id: string
          created_at?: string
          description?: string | null
          id?: string
          org_id?: string | null
          sequence_number: number
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          approval_method?: string | null
          approved_at?: string | null
          approved_by_name?: string | null
          contact_id?: string
          created_at?: string
          description?: string | null
          id?: string
          org_id?: string | null
          sequence_number?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_change_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_change_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_channels: {
        Row: {
          config: Json
          created_at: string
          display_name: string | null
          external_id: string | null
          id: string
          integration_id: string | null
          kind: string
          org_id: string
          provider: string | null
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          display_name?: string | null
          external_id?: string | null
          id?: string
          integration_id?: string | null
          kind: string
          org_id: string
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          display_name?: string | null
          external_id?: string | null
          id?: string
          integration_id?: string | null
          kind?: string
          org_id?: string
          provider?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_channels_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "fh_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_client_attribution: {
        Row: {
          client_id: string
          created_at: string
          first_ad_id: string | null
          first_campaign: string | null
          first_content: string | null
          first_form_key: string | null
          first_landing_url: string | null
          first_medium: string | null
          first_referrer: string | null
          first_source: string | null
          first_term: string | null
          first_touch_at: string | null
          last_ad_id: string | null
          last_campaign: string | null
          last_content: string | null
          last_form_key: string | null
          last_landing_url: string | null
          last_medium: string | null
          last_referrer: string | null
          last_source: string | null
          last_term: string | null
          last_touch_at: string | null
          org_id: string
          raw: Json
          touches: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          first_ad_id?: string | null
          first_campaign?: string | null
          first_content?: string | null
          first_form_key?: string | null
          first_landing_url?: string | null
          first_medium?: string | null
          first_referrer?: string | null
          first_source?: string | null
          first_term?: string | null
          first_touch_at?: string | null
          last_ad_id?: string | null
          last_campaign?: string | null
          last_content?: string | null
          last_form_key?: string | null
          last_landing_url?: string | null
          last_medium?: string | null
          last_referrer?: string | null
          last_source?: string | null
          last_term?: string | null
          last_touch_at?: string | null
          org_id: string
          raw?: Json
          touches?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          first_ad_id?: string | null
          first_campaign?: string | null
          first_content?: string | null
          first_form_key?: string | null
          first_landing_url?: string | null
          first_medium?: string | null
          first_referrer?: string | null
          first_source?: string | null
          first_term?: string | null
          first_touch_at?: string | null
          last_ad_id?: string | null
          last_campaign?: string | null
          last_content?: string | null
          last_form_key?: string | null
          last_landing_url?: string | null
          last_medium?: string | null
          last_referrer?: string | null
          last_source?: string | null
          last_term?: string | null
          last_touch_at?: string | null
          org_id?: string
          raw?: Json
          touches?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_client_attribution_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_client_attribution_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_client_fields: {
        Row: {
          client_id: string
          key: string
          org_id: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          client_id: string
          key: string
          org_id: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          client_id?: string
          key?: string
          org_id?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_client_fields_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_client_fields_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_client_tags: {
        Row: {
          added_at: string
          added_by: string | null
          client_id: string
          org_id: string
          source: string
          tag: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          client_id: string
          org_id: string
          source?: string
          tag: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          client_id?: string
          org_id?: string
          source?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_client_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_client_tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_clients: {
        Row: {
          active_jobs_count: number
          address: string | null
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          last_activity_at: string | null
          name: string
          notes: string | null
          org_id: string | null
          phone: string | null
          source: string | null
          total_lifetime_value: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active_jobs_count?: number
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_activity_at?: string | null
          name: string
          notes?: string | null
          org_id?: string | null
          phone?: string | null
          source?: string | null
          total_lifetime_value?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active_jobs_count?: number
          address?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_activity_at?: string | null
          name?: string
          notes?: string | null
          org_id?: string | null
          phone?: string | null
          source?: string | null
          total_lifetime_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_closeouts: {
        Row: {
          closed_at: string
          contact_id: string
          created_at: string
          final_amount: number
          final_photo_count: number
          id: string
          notes: string | null
          org_id: string | null
          paid_at_close: number
          signoff_at: string
          signoff_method: string
          signoff_name: string | null
          updated_at: string
          user_id: string
          warranty_months: number | null
          warranty_start_date: string | null
        }
        Insert: {
          closed_at?: string
          contact_id: string
          created_at?: string
          final_amount?: number
          final_photo_count?: number
          id?: string
          notes?: string | null
          org_id?: string | null
          paid_at_close?: number
          signoff_at?: string
          signoff_method?: string
          signoff_name?: string | null
          updated_at?: string
          user_id: string
          warranty_months?: number | null
          warranty_start_date?: string | null
        }
        Update: {
          closed_at?: string
          contact_id?: string
          created_at?: string
          final_amount?: number
          final_photo_count?: number
          id?: string
          notes?: string | null
          org_id?: string | null
          paid_at_close?: number
          signoff_at?: string
          signoff_method?: string
          signoff_name?: string | null
          updated_at?: string
          user_id?: string
          warranty_months?: number | null
          warranty_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_closeouts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_closeouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_consent: {
        Row: {
          calls_status: string
          client_id: string
          created_at: string
          dnd_all: boolean
          email_source: string | null
          email_status: string
          email_updated_at: string | null
          notes: string | null
          org_id: string
          sms_source: string | null
          sms_status: string
          sms_updated_at: string | null
          updated_at: string
        }
        Insert: {
          calls_status?: string
          client_id: string
          created_at?: string
          dnd_all?: boolean
          email_source?: string | null
          email_status?: string
          email_updated_at?: string | null
          notes?: string | null
          org_id: string
          sms_source?: string | null
          sms_status?: string
          sms_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          calls_status?: string
          client_id?: string
          created_at?: string
          dnd_all?: boolean
          email_source?: string | null
          email_status?: string
          email_updated_at?: string | null
          notes?: string | null
          org_id?: string
          sms_source?: string | null
          sms_status?: string
          sms_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_consent_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_consent_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_contacts: {
        Row: {
          address: string | null
          amount: number | null
          approved_quote_version_id: string | null
          client_id: string | null
          completed_at: string | null
          cost: number | null
          created_at: string | null
          email: string | null
          exclusions_text: string | null
          follow_up_on: string | null
          has_inspections: boolean | null
          heat_score: number | null
          id: string
          job_title: string | null
          job_type: string | null
          last_contact: string | null
          milestones: Json | null
          name: string | null
          notes: string | null
          org_id: string | null
          partner_shared: boolean | null
          phone: string | null
          photos: Json | null
          proposal_status: string | null
          quote_change_request_note: string | null
          quote_change_requested_at: string | null
          quote_expires_at: string | null
          quote_sent_at: string | null
          referred_by: string | null
          scope_text: string | null
          source: string | null
          stage: string | null
          tags: string[] | null
          terms_text: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          amount?: number | null
          approved_quote_version_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          cost?: number | null
          created_at?: string | null
          email?: string | null
          exclusions_text?: string | null
          follow_up_on?: string | null
          has_inspections?: boolean | null
          heat_score?: number | null
          id?: string
          job_title?: string | null
          job_type?: string | null
          last_contact?: string | null
          milestones?: Json | null
          name?: string | null
          notes?: string | null
          org_id?: string | null
          partner_shared?: boolean | null
          phone?: string | null
          photos?: Json | null
          proposal_status?: string | null
          quote_change_request_note?: string | null
          quote_change_requested_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          referred_by?: string | null
          scope_text?: string | null
          source?: string | null
          stage?: string | null
          tags?: string[] | null
          terms_text?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          amount?: number | null
          approved_quote_version_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          cost?: number | null
          created_at?: string | null
          email?: string | null
          exclusions_text?: string | null
          follow_up_on?: string | null
          has_inspections?: boolean | null
          heat_score?: number | null
          id?: string
          job_title?: string | null
          job_type?: string | null
          last_contact?: string | null
          milestones?: Json | null
          name?: string | null
          notes?: string | null
          org_id?: string | null
          partner_shared?: boolean | null
          phone?: string | null
          photos?: Json | null
          proposal_status?: string | null
          quote_change_request_note?: string | null
          quote_change_requested_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          referred_by?: string | null
          scope_text?: string | null
          source?: string | null
          stage?: string | null
          tags?: string[] | null
          terms_text?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_contacts_approved_quote_version_id_fkey"
            columns: ["approved_quote_version_id"]
            isOneToOne: false
            referencedRelation: "fh_quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_conversations: {
        Row: {
          assigned_to: string | null
          client_id: string
          created_at: string
          email_thread_token: string
          id: string
          last_channel: string | null
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          last_preview: string | null
          org_id: string
          snoozed_until: string | null
          starred: boolean
          status: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          client_id: string
          created_at?: string
          email_thread_token?: string
          id?: string
          last_channel?: string | null
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          last_preview?: string | null
          org_id: string
          snoozed_until?: string | null
          starred?: boolean
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          email_thread_token?: string
          id?: string
          last_channel?: string | null
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_outbound_at?: string | null
          last_preview?: string | null
          org_id?: string
          snoozed_until?: string | null
          starred?: boolean
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_daily_logs: {
        Row: {
          contact_id: string
          created_at: string
          crew_count: number | null
          hours_worked: number | null
          id: string
          log_date: string
          next_steps: string | null
          org_id: string | null
          photos: Json
          summary: string
          updated_at: string
          user_id: string
          weather_text: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          crew_count?: number | null
          hours_worked?: number | null
          id?: string
          log_date?: string
          next_steps?: string | null
          org_id?: string | null
          photos?: Json
          summary: string
          updated_at?: string
          user_id: string
          weather_text?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          crew_count?: number | null
          hours_worked?: number | null
          id?: string
          log_date?: string
          next_steps?: string | null
          org_id?: string | null
          photos?: Json
          summary?: string
          updated_at?: string
          user_id?: string
          weather_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_daily_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_daily_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_esign_envelopes: {
        Row: {
          completed_at: string | null
          contact_id: string
          created_at: string
          envelope_id: string
          id: string
          org_id: string | null
          provider: string
          recipient_email: string | null
          recipient_name: string | null
          sent_at: string
          status: string
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          created_at?: string
          envelope_id: string
          id?: string
          org_id?: string | null
          provider?: string
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          envelope_id?: string
          id?: string
          org_id?: string | null
          provider?: string
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_esign_envelopes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_esign_envelopes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_estimate_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          job_type: string | null
          line_items: Json
          name: string
          org_id: string | null
          total_high: number | null
          total_low: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          job_type?: string | null
          line_items?: Json
          name: string
          org_id?: string | null
          total_high?: number | null
          total_low?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          job_type?: string | null
          line_items?: Json
          name?: string
          org_id?: string | null
          total_high?: number | null
          total_low?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_estimate_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_events: {
        Row: {
          client_id: string | null
          contact_id: string | null
          conversation_id: string | null
          dedupe_key: string | null
          id: string
          occurred_at: string
          org_id: string
          payload: Json
          processed_at: string | null
          processing_error: string | null
          source: string
          type: string
        }
        Insert: {
          client_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          dedupe_key?: string | null
          id?: string
          occurred_at?: string
          org_id: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          source?: string
          type: string
        }
        Update: {
          client_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          dedupe_key?: string | null
          id?: string
          occurred_at?: string
          org_id?: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          source?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_v_inbox"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "fh_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_expenses: {
        Row: {
          amount: number | null
          category: string | null
          contact_id: string | null
          created_at: string | null
          description: string | null
          expense_date: string | null
          id: string
          org_id: string | null
          receipt_url: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          category?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          id?: string
          org_id?: string | null
          receipt_url?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          category?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          id?: string
          org_id?: string | null
          receipt_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_expenses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_external_refs: {
        Row: {
          created_at: string
          entity: string
          external_id: string
          external_number: string | null
          integration_id: string
          local_id: string
          local_table: string
          org_id: string
          raw: Json
          synced_at: string
        }
        Insert: {
          created_at?: string
          entity: string
          external_id: string
          external_number?: string | null
          integration_id: string
          local_id: string
          local_table: string
          org_id: string
          raw?: Json
          synced_at?: string
        }
        Update: {
          created_at?: string
          entity?: string
          external_id?: string
          external_number?: string | null
          integration_id?: string
          local_id?: string
          local_table?: string
          org_id?: string
          raw?: Json
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_external_refs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "fh_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_external_refs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_field_defs: {
        Row: {
          created_at: string
          id: string
          key: string
          kind: string
          label: string
          options: Json
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          kind?: string
          label: string
          options?: Json
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          kind?: string
          label?: string
          options?: Json
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_field_defs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_follow_up_settings: {
        Row: {
          auto_send: boolean
          created_at: string
          day14_days: number
          day14_enabled: boolean
          day3_days: number
          day3_enabled: boolean
          day30_days: number
          day30_enabled: boolean
          day7_days: number
          day7_enabled: boolean
          enabled: boolean
          from_name: string | null
          org_id: string
          review_ask_enabled: boolean
          review_link: string | null
          updated_at: string
        }
        Insert: {
          auto_send?: boolean
          created_at?: string
          day14_days?: number
          day14_enabled?: boolean
          day3_days?: number
          day3_enabled?: boolean
          day30_days?: number
          day30_enabled?: boolean
          day7_days?: number
          day7_enabled?: boolean
          enabled?: boolean
          from_name?: string | null
          org_id: string
          review_ask_enabled?: boolean
          review_link?: string | null
          updated_at?: string
        }
        Update: {
          auto_send?: boolean
          created_at?: string
          day14_days?: number
          day14_enabled?: boolean
          day3_days?: number
          day3_enabled?: boolean
          day30_days?: number
          day30_enabled?: boolean
          day7_days?: number
          day7_enabled?: boolean
          enabled?: boolean
          from_name?: string | null
          org_id?: string
          review_ask_enabled?: boolean
          review_link?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_follow_up_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_follow_ups: {
        Row: {
          anchor_on: string | null
          channel: string
          completed_at: string | null
          completed_by: string | null
          contact_id: string
          created_at: string
          days_quiet: number | null
          draft_body: string | null
          due_on: string
          headline: string
          id: string
          kind: string
          org_id: string
          stage_at_queue: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          anchor_on?: string | null
          channel: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id: string
          created_at?: string
          days_quiet?: number | null
          draft_body?: string | null
          due_on?: string
          headline: string
          id?: string
          kind: string
          org_id: string
          stage_at_queue?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          anchor_on?: string | null
          channel?: string
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string
          created_at?: string
          days_quiet?: number | null
          draft_body?: string | null
          due_on?: string
          headline?: string
          id?: string
          kind?: string
          org_id?: string
          stage_at_queue?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_follow_ups_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_follow_ups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_form_submissions: {
        Row: {
          attribution: Json
          client_id: string | null
          contact_id: string | null
          created_at: string
          data: Json
          form_id: string
          id: string
          ip_hash: string | null
          org_id: string
          user_agent: string | null
        }
        Insert: {
          attribution?: Json
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          data?: Json
          form_id: string
          id?: string
          ip_hash?: string | null
          org_id: string
          user_agent?: string | null
        }
        Update: {
          attribution?: Json
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          data?: Json
          form_id?: string
          id?: string
          ip_hash?: string | null
          org_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_form_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "fh_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_form_submissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_forms: {
        Row: {
          created_at: string
          fields: Json
          id: string
          key: string
          name: string
          org_id: string
          public_key: string
          settings: Json
          status: string
          submissions_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fields?: Json
          id?: string
          key: string
          name: string
          org_id: string
          public_key?: string
          settings?: Json
          status?: string
          submissions_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fields?: Json
          id?: string
          key?: string
          name?: string
          org_id?: string
          public_key?: string
          settings?: Json
          status?: string
          submissions_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_forms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_inspections: {
        Row: {
          contact_id: string | null
          created_at: string | null
          data: Json | null
          id: string
          inspector: string | null
          org_id: string | null
          result: string | null
          trade: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          inspector?: string | null
          org_id?: string | null
          result?: string | null
          trade?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          inspector?: string | null
          org_id?: string | null
          result?: string | null
          trade?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_inspections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_inspections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_insurance_claims: {
        Row: {
          acv: number | null
          adjuster: string | null
          carrier: string | null
          claim_number: string | null
          contact_id: string
          created_at: string
          deductible: number | null
          depreciation: number | null
          id: string
          mortgage_company: string | null
          org_id: string | null
          rcv: number | null
          supplement_amount: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acv?: number | null
          adjuster?: string | null
          carrier?: string | null
          claim_number?: string | null
          contact_id: string
          created_at?: string
          deductible?: number | null
          depreciation?: number | null
          id?: string
          mortgage_company?: string | null
          org_id?: string | null
          rcv?: number | null
          supplement_amount?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acv?: number | null
          adjuster?: string | null
          carrier?: string | null
          claim_number?: string | null
          contact_id?: string
          created_at?: string
          deductible?: number | null
          depreciation?: number | null
          id?: string
          mortgage_company?: string | null
          org_id?: string | null
          rcv?: number | null
          supplement_amount?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_insurance_claims_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_insurance_claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_integration_secrets: {
        Row: {
          access_token: string | null
          created_at: string
          expires_at: string | null
          integration_id: string
          org_id: string | null
          realm_id: string | null
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          integration_id: string
          org_id?: string | null
          realm_id?: string | null
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          integration_id?: string
          org_id?: string | null
          realm_id?: string | null
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_integration_secrets_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "fh_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_integration_secrets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_integrations: {
        Row: {
          connected_at: string | null
          created_at: string
          display_name: string | null
          external_account_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          metadata: Json
          org_id: string | null
          provider: string
          scopes: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          metadata?: Json
          org_id?: string | null
          provider: string
          scopes?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          metadata?: Json
          org_id?: string | null
          provider?: string
          scopes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_invoices: {
        Row: {
          amount: number
          contact_id: string
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          issued_at: string | null
          notes: string | null
          org_id: string | null
          sequence_number: number
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          contact_id: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          org_id?: string | null
          sequence_number: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          contact_id?: string
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          org_id?: string | null
          sequence_number?: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_job_files: {
        Row: {
          caption: string | null
          filename: string
          id: string
          job_id: string
          kind: string
          mime_type: string | null
          org_id: string | null
          section_tag: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          filename: string
          id?: string
          job_id: string
          kind?: string
          mime_type?: string | null
          org_id?: string | null
          section_tag?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          filename?: string
          id?: string
          job_id?: string
          kind?: string
          mime_type?: string | null
          org_id?: string | null
          section_tag?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_job_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_job_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_job_partners: {
        Row: {
          accepted_at: string | null
          deleted_by_invited_at: string | null
          deleted_by_partner_at: string | null
          id: string
          invite_token: string | null
          invited_at: string | null
          invited_by_user_id: string
          job_id: string
          org_id: string | null
          partner_email: string
          partner_name: string | null
          partner_role: string | null
          partner_user_id: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          deleted_by_invited_at?: string | null
          deleted_by_partner_at?: string | null
          id?: string
          invite_token?: string | null
          invited_at?: string | null
          invited_by_user_id: string
          job_id: string
          org_id?: string | null
          partner_email: string
          partner_name?: string | null
          partner_role?: string | null
          partner_user_id?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          deleted_by_invited_at?: string | null
          deleted_by_partner_at?: string | null
          id?: string
          invite_token?: string | null
          invited_at?: string | null
          invited_by_user_id?: string
          job_id?: string
          org_id?: string | null
          partner_email?: string
          partner_name?: string | null
          partner_role?: string | null
          partner_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_job_partners_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_job_partners_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_job_todos: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          done: boolean
          due_at: string | null
          id: string
          job_id: string
          org_id: string | null
          text: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          job_id: string
          org_id?: string | null
          text: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          job_id?: string
          org_id?: string | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_job_todos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_job_todos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_jobber_events: {
        Row: {
          account_id: string
          app_id: string | null
          attempts: number
          id: string
          integration_id: string | null
          item_id: string | null
          last_error: string | null
          occurred_at: string | null
          org_id: string | null
          processed_at: string | null
          raw: Json
          received_at: string
          result: Json | null
          status: string
          topic: string
        }
        Insert: {
          account_id: string
          app_id?: string | null
          attempts?: number
          id?: string
          integration_id?: string | null
          item_id?: string | null
          last_error?: string | null
          occurred_at?: string | null
          org_id?: string | null
          processed_at?: string | null
          raw?: Json
          received_at?: string
          result?: Json | null
          status?: string
          topic: string
        }
        Update: {
          account_id?: string
          app_id?: string | null
          attempts?: number
          id?: string
          integration_id?: string | null
          item_id?: string | null
          last_error?: string | null
          occurred_at?: string | null
          org_id?: string | null
          processed_at?: string | null
          raw?: Json
          received_at?: string
          result?: Json | null
          status?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_jobber_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "fh_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_lead_sources: {
        Row: {
          created_at: string
          id: string
          key: string
          kind: string
          monthly_cost: number
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          kind?: string
          monthly_cost?: number
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          kind?: string
          monthly_cost?: number
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_lead_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_materials: {
        Row: {
          category: string | null
          contact_id: string
          created_at: string
          id: string
          installed_at: string | null
          name: string
          notes: string | null
          ordered_at: string | null
          ordered_qty: number | null
          org_id: string | null
          po_number: string | null
          qty_needed: number
          received_at: string | null
          received_qty: number
          source: Json
          supplier: string | null
          unit: string | null
          unit_cost: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          contact_id: string
          created_at?: string
          id?: string
          installed_at?: string | null
          name: string
          notes?: string | null
          ordered_at?: string | null
          ordered_qty?: number | null
          org_id?: string | null
          po_number?: string | null
          qty_needed?: number
          received_at?: string | null
          received_qty?: number
          source?: Json
          supplier?: string | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          installed_at?: string | null
          name?: string
          notes?: string | null
          ordered_at?: string | null
          ordered_qty?: number | null
          org_id?: string | null
          po_number?: string | null
          qty_needed?: number
          received_at?: string | null
          received_qty?: number
          source?: Json
          supplier?: string | null
          unit?: string | null
          unit_cost?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_materials_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_materials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_message_templates: {
        Row: {
          body: string
          body_html: string | null
          category: string | null
          channel: string
          created_at: string
          created_by: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          org_id: string
          purpose: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          body_html?: string | null
          category?: string | null
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          org_id: string
          purpose?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          body_html?: string | null
          category?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          purpose?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_message_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_messages: {
        Row: {
          agent_run_id: string | null
          body: string | null
          body_html: string | null
          call_duration_sec: number | null
          call_status: string | null
          campaign_id: string | null
          channel: string
          client_id: string
          contact_id: string | null
          conversation_id: string
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          direction: string
          error: string | null
          from_address: string | null
          hold_reason: string | null
          id: string
          media: Json
          org_id: string
          phone_number_id: string | null
          provider: string | null
          provider_message_id: string | null
          provider_status: string | null
          purpose: string
          read_at: string | null
          recording_url: string | null
          sent_at: string | null
          sent_by_kind: string
          sent_by_user: string | null
          status: string
          subject: string | null
          to_address: string | null
          transcript: string | null
          updated_at: string
          workflow_run_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          body?: string | null
          body_html?: string | null
          call_duration_sec?: number | null
          call_status?: string | null
          campaign_id?: string | null
          channel: string
          client_id: string
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          direction: string
          error?: string | null
          from_address?: string | null
          hold_reason?: string | null
          id?: string
          media?: Json
          org_id: string
          phone_number_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          purpose?: string
          read_at?: string | null
          recording_url?: string | null
          sent_at?: string | null
          sent_by_kind?: string
          sent_by_user?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          transcript?: string | null
          updated_at?: string
          workflow_run_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          body?: string | null
          body_html?: string | null
          call_duration_sec?: number | null
          call_status?: string | null
          campaign_id?: string | null
          channel?: string
          client_id?: string
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          direction?: string
          error?: string | null
          from_address?: string | null
          hold_reason?: string | null
          id?: string
          media?: Json
          org_id?: string
          phone_number_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          provider_status?: string | null
          purpose?: string
          read_at?: string | null
          recording_url?: string | null
          sent_at?: string | null
          sent_by_kind?: string
          sent_by_user?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
          transcript?: string | null
          updated_at?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_messages_agent_run_fk"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "fh_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "fh_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_v_inbox"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "fh_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "fh_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_workflow_run_fk"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_mileage: {
        Row: {
          contact_id: string | null
          created_at: string | null
          drove_on: string | null
          id: string
          miles: number
          org_id: string | null
          purpose: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          drove_on?: string | null
          id?: string
          miles: number
          org_id?: string | null
          purpose?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          drove_on?: string | null
          id?: string
          miles?: number
          org_id?: string | null
          purpose?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_mileage_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_mileage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_notes: {
        Row: {
          action: string | null
          audio_url: string | null
          category: string | null
          contact_id: string | null
          created_at: string | null
          done: boolean | null
          id: string
          org_id: string | null
          parsed: Json | null
          text: string | null
          user_id: string
          when_text: string | null
        }
        Insert: {
          action?: string | null
          audio_url?: string | null
          category?: string | null
          contact_id?: string | null
          created_at?: string | null
          done?: boolean | null
          id?: string
          org_id?: string | null
          parsed?: Json | null
          text?: string | null
          user_id: string
          when_text?: string | null
        }
        Update: {
          action?: string | null
          audio_url?: string | null
          category?: string | null
          contact_id?: string | null
          created_at?: string | null
          done?: boolean | null
          id?: string
          org_id?: string | null
          parsed?: Json | null
          text?: string | null
          user_id?: string
          when_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_notifications: {
        Row: {
          actor_user_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          org_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          org_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          org_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_oauth_states: {
        Row: {
          code_verifier: string
          created_at: string
          expires_at: string
          org_id: string
          provider: string
          redirect_to: string | null
          state: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          code_verifier: string
          created_at?: string
          expires_at?: string
          org_id: string
          provider?: string
          redirect_to?: string | null
          state: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          code_verifier?: string
          created_at?: string
          expires_at?: string
          org_id?: string
          provider?: string
          redirect_to?: string | null
          state?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_oauth_states_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_org_settings: {
        Row: {
          app_base_url: string
          brand: Json
          business_hours: Json
          created_at: string
          default_from_email: string | null
          default_from_name: string | null
          engine_enabled: boolean
          hold_all_outside_window: boolean
          org_id: string
          owner_notify_user_ids: string[]
          public_key: string
          reply_domain: string | null
          review_links: Json
          send_window_end: string
          send_window_start: string
          sms_policy: string
          timezone: string
          updated_at: string
          vertical: string
        }
        Insert: {
          app_base_url?: string
          brand?: Json
          business_hours?: Json
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          engine_enabled?: boolean
          hold_all_outside_window?: boolean
          org_id: string
          owner_notify_user_ids?: string[]
          public_key?: string
          reply_domain?: string | null
          review_links?: Json
          send_window_end?: string
          send_window_start?: string
          sms_policy?: string
          timezone?: string
          updated_at?: string
          vertical?: string
        }
        Update: {
          app_base_url?: string
          brand?: Json
          business_hours?: Json
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          engine_enabled?: boolean
          hold_all_outside_window?: boolean
          org_id?: string
          owner_notify_user_ids?: string[]
          public_key?: string
          reply_domain?: string | null
          review_links?: Json
          send_window_end?: string
          send_window_start?: string
          sms_policy?: string
          timezone?: string
          updated_at?: string
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_outbox: {
        Row: {
          agent_run_id: string | null
          attempts: number
          campaign_id: string | null
          client_id: string | null
          created_at: string
          done_at: string | null
          hold_reason: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          org_id: string
          payload: Json
          phone_number_id: string | null
          result: Json | null
          run_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          attempts?: number
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          done_at?: string | null
          hold_reason?: string | null
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          message_id?: string | null
          next_attempt_at?: string
          org_id: string
          payload?: Json
          phone_number_id?: string | null
          result?: Json | null
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          attempts?: number
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          done_at?: string | null
          hold_reason?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          message_id?: string | null
          next_attempt_at?: string
          org_id?: string
          payload?: Json
          phone_number_id?: string | null
          result?: Json | null
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_outbox_agent_run_fk"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "fh_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_call_log"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fh_outbox_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_response_times"
            referencedColumns: ["inbound_message_id"]
          },
          {
            foreignKeyName: "fh_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_outbox_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "fh_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_outbox_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_payments: {
        Row: {
          amount: number
          contact_id: string | null
          created_at: string | null
          id: string
          invoice_id: string | null
          kind: string | null
          method: string | null
          org_id: string | null
          paid_on: string | null
          reference: string | null
          user_id: string
        }
        Insert: {
          amount: number
          contact_id?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string | null
          method?: string | null
          org_id?: string | null
          paid_on?: string | null
          reference?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          contact_id?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string | null
          method?: string | null
          org_id?: string | null
          paid_on?: string | null
          reference?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fh_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_phone_numbers: {
        Row: {
          capabilities: Json
          created_at: string
          daily_sms_cap: number
          e164: string
          id: string
          is_default: boolean
          kind: string
          label: string | null
          missed_call_text_back: boolean
          org_id: string
          provider: string
          provider_sid: string | null
          sms_registration: Json
          sms_status: string
          source_tag: string | null
          status: string
          updated_at: string
          voice_forward_to: string | null
          voice_record: boolean
          voice_timeout_sec: number
          voice_whisper: string | null
          voicemail_greeting: string | null
        }
        Insert: {
          capabilities?: Json
          created_at?: string
          daily_sms_cap?: number
          e164: string
          id?: string
          is_default?: boolean
          kind?: string
          label?: string | null
          missed_call_text_back?: boolean
          org_id: string
          provider?: string
          provider_sid?: string | null
          sms_registration?: Json
          sms_status?: string
          source_tag?: string | null
          status?: string
          updated_at?: string
          voice_forward_to?: string | null
          voice_record?: boolean
          voice_timeout_sec?: number
          voice_whisper?: string | null
          voicemail_greeting?: string | null
        }
        Update: {
          capabilities?: Json
          created_at?: string
          daily_sms_cap?: number
          e164?: string
          id?: string
          is_default?: boolean
          kind?: string
          label?: string | null
          missed_call_text_back?: boolean
          org_id?: string
          provider?: string
          provider_sid?: string | null
          sms_registration?: Json
          sms_status?: string
          source_tag?: string | null
          status?: string
          updated_at?: string
          voice_forward_to?: string | null
          voice_record?: boolean
          voice_timeout_sec?: number
          voice_whisper?: string | null
          voicemail_greeting?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_phone_numbers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_public_link_events: {
        Row: {
          contact_id: string | null
          created_at: string
          event_type: string
          id: string
          ip_hash: string | null
          kind: string
          metadata: Json
          org_id: string | null
          public_link_id: string
          referer: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          kind: string
          metadata?: Json
          org_id?: string | null
          public_link_id: string
          referer?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          kind?: string
          metadata?: Json
          org_id?: string | null
          public_link_id?: string
          referer?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_public_link_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_public_link_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_public_link_events_public_link_id_fkey"
            columns: ["public_link_id"]
            isOneToOne: false
            referencedRelation: "fh_public_links"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_public_links: {
        Row: {
          change_order_id: string | null
          client_id: string | null
          contact_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          last_viewed_at: string | null
          org_id: string | null
          revoked_at: string | null
          token: string
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          change_order_id?: string | null
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          last_viewed_at?: string | null
          org_id?: string | null
          revoked_at?: string | null
          token: string
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          change_order_id?: string | null
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          last_viewed_at?: string | null
          org_id?: string | null
          revoked_at?: string | null
          token?: string
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "fh_public_links_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "fh_change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_public_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_public_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_public_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fh_quote_items: {
        Row: {
          amount: number
          contact_id: string
          created_at: string
          description: string
          id: string
          is_excluded: boolean
          is_optional: boolean
          notes: string | null
          org_id: string | null
          qty: number
          rate: number
          section: string | null
          sort_order: number
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          contact_id: string
          created_at?: string
          description: string
          id?: string
          is_excluded?: boolean
          is_optional?: boolean
          notes?: string | null
          org_id?: string | null
          qty?: number
          rate?: number
          section?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          contact_id?: string
          created_at?: string
          description?: string
          id?: string
          is_excluded?: boolean
          is_optional?: boolean
          notes?: string | null
          org_id?: string | null
          qty?: number
          rate?: number
          section?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_quote_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_quote_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_quote_versions: {
        Row: {
          approval_method: string
          approval_note: string | null
          approval_token: string | null
          approved_at: string
          approved_by_email: string | null
          approved_by_name: string
          base_total: number
          client_ip: unknown
          client_user_agent: string | null
          contact_id: string
          created_at: string
          excluded_count: number
          id: string
          optional_total: number
          org_id: string | null
          pdf_file_id: string | null
          signature_data: string | null
          signature_file_id: string | null
          signature_kind: string | null
          snapshot: Json
          status: string
          superseded_at: string | null
          superseded_by: string | null
          token_expires_at: string | null
          user_id: string
          version_number: number
        }
        Insert: {
          approval_method: string
          approval_note?: string | null
          approval_token?: string | null
          approved_at?: string
          approved_by_email?: string | null
          approved_by_name: string
          base_total?: number
          client_ip?: unknown
          client_user_agent?: string | null
          contact_id: string
          created_at?: string
          excluded_count?: number
          id?: string
          optional_total?: number
          org_id?: string | null
          pdf_file_id?: string | null
          signature_data?: string | null
          signature_file_id?: string | null
          signature_kind?: string | null
          snapshot: Json
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          token_expires_at?: string | null
          user_id: string
          version_number: number
        }
        Update: {
          approval_method?: string
          approval_note?: string | null
          approval_token?: string | null
          approved_at?: string
          approved_by_email?: string | null
          approved_by_name?: string
          base_total?: number
          client_ip?: unknown
          client_user_agent?: string | null
          contact_id?: string
          created_at?: string
          excluded_count?: number
          id?: string
          optional_total?: number
          org_id?: string | null
          pdf_file_id?: string | null
          signature_data?: string | null
          signature_file_id?: string | null
          signature_kind?: string | null
          snapshot?: Json
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          token_expires_at?: string | null
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "fh_quote_versions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_quote_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_quote_versions_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "fh_job_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_quote_versions_signature_file_id_fkey"
            columns: ["signature_file_id"]
            isOneToOne: false
            referencedRelation: "fh_job_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_quote_versions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "fh_quote_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_rate_cards: {
        Row: {
          created_at: string
          id: string
          label: string | null
          notes: string | null
          org_id: string | null
          rate_high: number
          rate_low: number
          trade_key: string
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          notes?: string | null
          org_id?: string | null
          rate_high?: number
          rate_low?: number
          trade_key: string
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          notes?: string | null
          org_id?: string | null
          rate_high?: number
          rate_low?: number
          trade_key?: string
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_rate_cards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_rate_limits: {
        Row: {
          bucket_start: string
          first_seen_at: string
          id: string
          identifier: string
          request_count: number
          scope: string
          updated_at: string
          window_seconds: number
        }
        Insert: {
          bucket_start: string
          first_seen_at?: string
          id?: string
          identifier: string
          request_count?: number
          scope: string
          updated_at?: string
          window_seconds?: number
        }
        Update: {
          bucket_start?: string
          first_seen_at?: string
          id?: string
          identifier?: string
          request_count?: number
          scope?: string
          updated_at?: string
          window_seconds?: number
        }
        Relationships: []
      }
      fh_review_requests: {
        Row: {
          channel: string
          clicked_at: string | null
          client_id: string
          contact_id: string | null
          created_at: string
          id: string
          message_id: string | null
          org_id: string
          platform: string
          review_url: string | null
          reviewed_at: string | null
          sent_at: string
          status: string
          track_key: string | null
        }
        Insert: {
          channel: string
          clicked_at?: string | null
          client_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          org_id: string
          platform?: string
          review_url?: string | null
          reviewed_at?: string | null
          sent_at?: string
          status?: string
          track_key?: string | null
        }
        Update: {
          channel?: string
          clicked_at?: string | null
          client_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          org_id?: string
          platform?: string
          review_url?: string | null
          reviewed_at?: string | null
          sent_at?: string
          status?: string
          track_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_review_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_review_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_review_requests_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_review_requests_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_call_log"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "fh_review_requests_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "fh_v_response_times"
            referencedColumns: ["inbound_message_id"]
          },
          {
            foreignKeyName: "fh_review_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_reviews: {
        Row: {
          author_name: string | null
          body: string | null
          client_id: string | null
          created_at: string
          external_id: string | null
          id: string
          org_id: string
          platform: string
          rating: number | null
          received_at: string
          replied_at: string | null
          replied_by: string | null
          reply_body: string | null
          review_url: string | null
          sentiment: string | null
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          body?: string | null
          client_id?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          org_id: string
          platform?: string
          rating?: number | null
          received_at?: string
          replied_at?: string | null
          replied_by?: string | null
          reply_body?: string | null
          review_url?: string | null
          sentiment?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          body?: string | null
          client_id?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          org_id?: string
          platform?: string
          rating?: number | null
          received_at?: string
          replied_at?: string | null
          replied_by?: string | null
          reply_body?: string | null
          review_url?: string | null
          sentiment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_schedule: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string | null
          description: string | null
          end_at: string | null
          id: string
          org_id: string | null
          recurring: string | null
          start_at: string | null
          title: string | null
          user_id: string
          weather_locked: boolean | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          org_id?: string | null
          recurring?: string | null
          start_at?: string | null
          title?: string | null
          user_id: string
          weather_locked?: boolean | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          org_id?: string | null
          recurring?: string | null
          start_at?: string | null
          title?: string | null
          user_id?: string
          weather_locked?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_schedule_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_schedule_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_segments: {
        Row: {
          created_at: string
          description: string | null
          filter: Json
          id: string
          is_system: boolean
          key: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          filter?: Json
          id?: string
          is_system?: boolean
          key: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          filter?: Json
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_segments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_selections: {
        Row: {
          category: string | null
          client_id: string | null
          contact_id: string
          created_at: string
          decision_at: string | null
          decision_by: string | null
          description: string | null
          due_at: string | null
          id: string
          notes: string | null
          options: Json
          org_id: string | null
          room: string | null
          selected_option_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          contact_id: string
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          options?: Json
          org_id?: string | null
          room?: string | null
          selected_option_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          client_id?: string | null
          contact_id?: string
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          options?: Json
          org_id?: string | null
          room?: string | null
          selected_option_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_selections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_selections_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_selections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_snapshot_library: {
        Row: {
          created_at: string
          key: string
          name: string
          snapshot: Json
          updated_at: string
          vertical: string
        }
        Insert: {
          created_at?: string
          key: string
          name: string
          snapshot: Json
          updated_at?: string
          vertical: string
        }
        Update: {
          created_at?: string
          key?: string
          name?: string
          snapshot?: Json
          updated_at?: string
          vertical?: string
        }
        Relationships: []
      }
      fh_stage_transitions: {
        Row: {
          contact_id: string
          from_stage: string | null
          id: string
          org_id: string | null
          to_stage: string
          transitioned_at: string
          transitioned_by: string | null
          user_id: string
        }
        Insert: {
          contact_id: string
          from_stage?: string | null
          id?: string
          org_id?: string | null
          to_stage: string
          transitioned_at?: string
          transitioned_by?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string
          from_stage?: string | null
          id?: string
          org_id?: string | null
          to_stage?: string
          transitioned_at?: string
          transitioned_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_stage_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_stage_transitions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_sub_profiles: {
        Row: {
          address: string | null
          coi_path: string | null
          company: string | null
          created_at: string | null
          ein: string | null
          email: string | null
          id: string
          identity_key: string | null
          insurance_carrier: string | null
          insurance_expires_on: string | null
          insurance_policy: string | null
          license_number: string | null
          license_path: string | null
          name: string
          notes: string | null
          org_id: string | null
          payment_handle: string | null
          payment_method: string | null
          phone: string | null
          trades: string[] | null
          updated_at: string | null
          user_id: string
          w9_path: string | null
        }
        Insert: {
          address?: string | null
          coi_path?: string | null
          company?: string | null
          created_at?: string | null
          ein?: string | null
          email?: string | null
          id?: string
          identity_key?: string | null
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy?: string | null
          license_number?: string | null
          license_path?: string | null
          name: string
          notes?: string | null
          org_id?: string | null
          payment_handle?: string | null
          payment_method?: string | null
          phone?: string | null
          trades?: string[] | null
          updated_at?: string | null
          user_id: string
          w9_path?: string | null
        }
        Update: {
          address?: string | null
          coi_path?: string | null
          company?: string | null
          created_at?: string | null
          ein?: string | null
          email?: string | null
          id?: string
          identity_key?: string | null
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy?: string | null
          license_number?: string | null
          license_path?: string | null
          name?: string
          notes?: string | null
          org_id?: string | null
          payment_handle?: string | null
          payment_method?: string | null
          phone?: string | null
          trades?: string[] | null
          updated_at?: string | null
          user_id?: string
          w9_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_sub_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_subs: {
        Row: {
          contact_id: string | null
          created_at: string | null
          id: string
          name: string | null
          org_id: string | null
          phone: string | null
          rate: number | null
          status: string | null
          trade: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          org_id?: string | null
          phone?: string | null
          rate?: number | null
          status?: string | null
          trade?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          org_id?: string | null
          phone?: string | null
          rate?: number | null
          status?: string | null
          trade?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_subs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_subs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_tag_defs: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          org_id: string
          tag: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          org_id: string
          tag: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          org_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_tag_defs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_time_punches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          contact_id: string | null
          created_at: string
          flag_reason: string | null
          flagged: boolean
          hourly_rate: number | null
          id: string
          notes: string | null
          org_id: string | null
          punch_in_accuracy_m: number | null
          punch_in_at: string
          punch_in_lat: number | null
          punch_in_lon: number | null
          punch_out_accuracy_m: number | null
          punch_out_at: string | null
          punch_out_lat: number | null
          punch_out_lon: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          contact_id?: string | null
          created_at?: string
          flag_reason?: string | null
          flagged?: boolean
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          org_id?: string | null
          punch_in_accuracy_m?: number | null
          punch_in_at: string
          punch_in_lat?: number | null
          punch_in_lon?: number | null
          punch_out_accuracy_m?: number | null
          punch_out_at?: string | null
          punch_out_lat?: number | null
          punch_out_lon?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          contact_id?: string | null
          created_at?: string
          flag_reason?: string | null
          flagged?: boolean
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          org_id?: string | null
          punch_in_accuracy_m?: number | null
          punch_in_at?: string
          punch_in_lat?: number | null
          punch_in_lon?: number | null
          punch_out_accuracy_m?: number | null
          punch_out_at?: string | null
          punch_out_lat?: number | null
          punch_out_lon?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_time_punches_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_time_punches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_webhook_rate_limits: {
        Row: {
          bucket_start: string
          first_seen_at: string
          id: string
          org_id: string | null
          request_count: number
          updated_at: string
          user_id: string
          webhook_key_hash: string
          window_seconds: number
        }
        Insert: {
          bucket_start: string
          first_seen_at?: string
          id?: string
          org_id?: string | null
          request_count?: number
          updated_at?: string
          user_id: string
          webhook_key_hash: string
          window_seconds?: number
        }
        Update: {
          bucket_start?: string
          first_seen_at?: string
          id?: string
          org_id?: string | null
          request_count?: number
          updated_at?: string
          user_id?: string
          webhook_key_hash?: string
          window_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "fh_webhook_rate_limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_workflow_run_events: {
        Row: {
          detail: Json
          id: number
          occurred_at: string
          org_id: string
          run_id: string
          status: string
          step_id: string | null
          step_type: string | null
        }
        Insert: {
          detail?: Json
          id?: number
          occurred_at?: string
          org_id: string
          run_id: string
          status?: string
          step_id?: string | null
          step_type?: string | null
        }
        Update: {
          detail?: Json
          id?: number
          occurred_at?: string
          org_id?: string
          run_id?: string
          status?: string
          step_id?: string | null
          step_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_workflow_run_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_workflow_runs: {
        Row: {
          client_id: string
          contact_id: string | null
          context: Json
          current_step_id: string | null
          ended_at: string | null
          ended_reason: string | null
          exclusive: boolean
          id: string
          last_error: string | null
          on_timeout_step_id: string | null
          org_id: string
          source: string
          started_at: string
          status: string
          steps_executed: number
          trigger_event_id: string | null
          updated_at: string
          version_id: string
          wait_until: string | null
          waiting_for_event: string | null
          workflow_id: string
        }
        Insert: {
          client_id: string
          contact_id?: string | null
          context?: Json
          current_step_id?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          exclusive?: boolean
          id?: string
          last_error?: string | null
          on_timeout_step_id?: string | null
          org_id: string
          source?: string
          started_at?: string
          status?: string
          steps_executed?: number
          trigger_event_id?: string | null
          updated_at?: string
          version_id: string
          wait_until?: string | null
          waiting_for_event?: string | null
          workflow_id: string
        }
        Update: {
          client_id?: string
          contact_id?: string | null
          context?: Json
          current_step_id?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          exclusive?: boolean
          id?: string
          last_error?: string | null
          on_timeout_step_id?: string | null
          org_id?: string
          source?: string
          started_at?: string
          status?: string
          steps_executed?: number
          trigger_event_id?: string | null
          updated_at?: string
          version_id?: string
          wait_until?: string | null
          waiting_for_event?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_workflow_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fh_v_workflow_stats"
            referencedColumns: ["workflow_id"]
          },
          {
            foreignKeyName: "fh_workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fh_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_workflow_versions: {
        Row: {
          definition: Json
          id: string
          org_id: string
          published_at: string
          published_by: string | null
          version: number
          workflow_id: string
        }
        Insert: {
          definition: Json
          id?: string
          org_id: string
          published_at?: string
          published_by?: string | null
          version: number
          workflow_id: string
        }
        Update: {
          definition?: Json
          id?: string
          org_id?: string
          published_at?: string
          published_by?: string | null
          version?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_workflow_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fh_v_workflow_stats"
            referencedColumns: ["workflow_id"]
          },
          {
            foreignKeyName: "fh_workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fh_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_workflows: {
        Row: {
          active_version_id: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          draft_definition: Json
          id: string
          key: string
          name: string
          org_id: string
          stats: Json
          status: string
          trigger_types: string[]
          updated_at: string
        }
        Insert: {
          active_version_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          draft_definition?: Json
          id?: string
          key: string
          name: string
          org_id: string
          stats?: Json
          status?: string
          trigger_types?: string[]
          updated_at?: string
        }
        Update: {
          active_version_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          draft_definition?: Json
          id?: string
          key?: string
          name?: string
          org_id?: string
          stats?: Json
          status?: string
          trigger_types?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fh_workflows_active_version_fk"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "fh_workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          default_hourly_rate: number | null
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          default_hourly_rate?: number | null
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          default_hourly_rate?: number | null
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_email: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          brand_accent_hex: string | null
          company_address: string | null
          company_email: string | null
          company_name: string | null
          company_phone: string | null
          company_website: string | null
          created_at: string | null
          estimate_template: string
          full_name: string | null
          greeting: string | null
          insured_text: string | null
          license_number: string | null
          location_lat: number | null
          location_lon: number | null
          logo_uploaded_at: string | null
          logo_url: string | null
          onboarded_at: string | null
          org_id: string | null
          payment_instructions: string | null
          payment_link: string | null
          preferences: Json | null
          role: string | null
          services: string[] | null
          subscription_tier: string | null
          user_id: string
          warranty_default: string | null
          webhook_key: string | null
        }
        Insert: {
          brand_accent_hex?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string | null
          estimate_template?: string
          full_name?: string | null
          greeting?: string | null
          insured_text?: string | null
          license_number?: string | null
          location_lat?: number | null
          location_lon?: number | null
          logo_uploaded_at?: string | null
          logo_url?: string | null
          onboarded_at?: string | null
          org_id?: string | null
          payment_instructions?: string | null
          payment_link?: string | null
          preferences?: Json | null
          role?: string | null
          services?: string[] | null
          subscription_tier?: string | null
          user_id: string
          warranty_default?: string | null
          webhook_key?: string | null
        }
        Update: {
          brand_accent_hex?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string | null
          estimate_template?: string
          full_name?: string | null
          greeting?: string | null
          insured_text?: string | null
          license_number?: string | null
          location_lat?: number | null
          location_lon?: number | null
          logo_uploaded_at?: string | null
          logo_url?: string | null
          onboarded_at?: string | null
          org_id?: string | null
          payment_instructions?: string | null
          payment_link?: string | null
          preferences?: Json | null
          role?: string | null
          services?: string[] | null
          subscription_tier?: string | null
          user_id?: string
          warranty_default?: string | null
          webhook_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      fh_v_attribution: {
        Row: {
          leads: number | null
          lost: number | null
          month: string | null
          org_id: string | null
          quoted: number | null
          revenue: number | null
          source: string | null
          won: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_v_call_log: {
        Row: {
          call_duration_sec: number | null
          call_status: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          direction: string | null
          from_address: string | null
          message_id: string | null
          number_label: string | null
          org_id: string | null
          recording_url: string | null
          source_tag: string | null
          to_address: string | null
          transcript: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_v_inbox: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          client_name: string | null
          company_name: string | null
          conversation_id: string | null
          email: string | null
          held_messages: number | null
          last_channel: string | null
          last_inbound_at: string | null
          last_message_at: string | null
          last_outbound_at: string | null
          last_preview: string | null
          latest_stage: string | null
          org_id: string | null
          pending_drafts: number | null
          phone: string | null
          snoozed_until: string | null
          starred: boolean | null
          status: string | null
          tags: Json | null
          unread_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_v_response_times: {
        Row: {
          channel: string | null
          client_id: string | null
          conversation_id: string | null
          inbound_at: string | null
          inbound_message_id: string | null
          minutes_to_reply: number | null
          org_id: string | null
          replied_at: string | null
          replied_by_kind: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fh_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fh_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "fh_v_inbox"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "fh_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fh_v_workflow_stats: {
        Row: {
          active_runs: number | null
          completed: number | null
          failed: number | null
          goal_met: number | null
          key: string | null
          last_run_at: string | null
          name: string | null
          org_id: string | null
          replied: number | null
          runs: number | null
          status: string | null
          workflow_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fh_workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_user_org_ids: { Args: never; Returns: string[] }
      create_own_org: { Args: { p_name: string }; Returns: string }
      fh_advance_run: {
        Args: { p_max_steps?: number; p_run_id: string }
        Returns: string
      }
      fh_advance_runs: { Args: { p_limit?: number }; Returns: number }
      fh_agent_request: {
        Args: {
          p_agent_key: string
          p_client_id: string
          p_contact_id?: string
          p_instructions?: string
        }
        Returns: string
      }
      fh_agent_run_approve: {
        Args: { p_agent_run_id: string; p_body?: string; p_channel?: string }
        Returns: string
      }
      fh_agent_run_reject: {
        Args: { p_agent_run_id: string; p_reason?: string }
        Returns: undefined
      }
      fh_appointment_cancel_public: {
        Args: { p_manage_token: string; p_reason?: string }
        Returns: Json
      }
      fh_appointment_reminders_sweep: { Args: never; Returns: number }
      fh_attribution_touch: {
        Args: { p_attr: Json; p_client_id: string; p_org_id: string }
        Returns: undefined
      }
      fh_automation_tick: { Args: never; Returns: Json }
      fh_book_appointment: {
        Args: {
          p_address?: string
          p_attribution?: Json
          p_email?: string
          p_name: string
          p_notes?: string
          p_org_public_key: string
          p_phone: string
          p_sms_consent?: boolean
          p_start: string
          p_type_key: string
        }
        Returns: Json
      }
      fh_booking_slots: {
        Args: {
          p_days?: number
          p_from?: string
          p_org_public_key: string
          p_type_key: string
        }
        Returns: Json
      }
      fh_booking_windows: {
        Args: {
          p_day: string
          p_org_id: string
          p_type: Database["public"]["Tables"]["fh_booking_types"]["Row"]
        }
        Returns: Json
      }
      fh_campaign_cancel: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      fh_campaign_launch: {
        Args: { p_campaign_id: string; p_dry_run?: boolean }
        Returns: Json
      }
      fh_campaigns_launch_due: { Args: { p_limit?: number }; Returns: number }
      fh_can_read_org_members: { Args: { p_org_id: string }; Returns: boolean }
      fh_client_ctx: {
        Args: { p_client_id: string; p_contact_id?: string; p_event?: Json }
        Returns: Json
      }
      fh_client_ctx_app: {
        Args: { p_client_id: string; p_contact_id?: string; p_event?: Json }
        Returns: Json
      }
      fh_clients_recompute: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      fh_consent_set: {
        Args: {
          p_channel: string
          p_client_id: string
          p_org_id: string
          p_source: string
          p_status: string
        }
        Returns: undefined
      }
      fh_conversation_for_client: {
        Args: { p_client_id: string; p_org_id: string }
        Returns: string
      }
      fh_conversation_mark_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      fh_daily_sweep: { Args: never; Returns: Json }
      fh_dispatch_events: { Args: { p_limit?: number }; Returns: number }
      fh_emit_event: {
        Args: {
          p_client_id?: string
          p_contact_id?: string
          p_dedupe_key?: string
          p_org_id: string
          p_payload?: Json
          p_source?: string
          p_type: string
        }
        Returns: string
      }
      fh_engine_enabled: { Args: { p_org_id: string }; Returns: boolean }
      fh_enqueue_message: {
        Args: {
          p_agent_run_id?: string
          p_body: string
          p_body_html?: string
          p_campaign_id?: string
          p_channel: string
          p_client_id: string
          p_contact_id: string
          p_extra?: Json
          p_immediate?: boolean
          p_media?: Json
          p_org_id: string
          p_phone_number_id?: string
          p_purpose?: string
          p_run_id?: string
          p_sent_by_kind?: string
          p_sent_by_user?: string
          p_subject?: string
        }
        Returns: string
      }
      fh_enroll: {
        Args: {
          p_client_id: string
          p_contact_id?: string
          p_event?: Json
          p_event_id?: string
          p_source?: string
          p_workflow_id: string
        }
        Returns: string
      }
      fh_enroll_manual: {
        Args: { p_client_ids: string[]; p_workflow_id: string }
        Returns: number
      }
      fh_eval_filter: {
        Args: { p_ctx: Json; p_filter: Json }
        Returns: boolean
      }
      fh_first_name: { Args: { p_name: string }; Returns: string }
      fh_form_submit: {
        Args: {
          p_attribution?: Json
          p_data: Json
          p_form_key: string
          p_ip_hash?: string
          p_org_public_key: string
          p_user_agent?: string
        }
        Returns: Json
      }
      fh_get_path: { Args: { p_ctx: Json; p_path: string }; Returns: Json }
      fh_in_send_window: {
        Args: { p_at?: string; p_org_id: string }
        Returns: boolean
      }
      fh_increment_rate_limit: {
        Args: {
          p_bucket_start: string
          p_identifier: string
          p_limit: number
          p_scope: string
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          request_count: number
        }[]
      }
      fh_increment_webhook_rate_limit: {
        Args: {
          p_bucket_start: string
          p_key_hash: string
          p_limit: number
          p_org_id: string
          p_user_id: string
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          request_count: number
        }[]
      }
      fh_is_org_manager: { Args: { p_org_id: string }; Returns: boolean }
      fh_is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      fh_jobber_account_claim: {
        Args: { p_account_id: string }
        Returns: string
      }
      fh_jobber_addr: { Args: { p: Json }; Returns: string }
      fh_jobber_apply: {
        Args: {
          p_entity: string
          p_integration: string
          p_obj: Json
          p_opts?: Json
        }
        Returns: Json
      }
      fh_jobber_apply_client: {
        Args: { p_integration: string; p_obj: Json; p_suppress?: boolean }
        Returns: Json
      }
      fh_jobber_apply_invoice: {
        Args: { p_integration: string; p_obj: Json; p_suppress?: boolean }
        Returns: Json
      }
      fh_jobber_apply_job: {
        Args: {
          p_closed?: boolean
          p_integration: string
          p_obj: Json
          p_suppress?: boolean
        }
        Returns: Json
      }
      fh_jobber_apply_quote: {
        Args: { p_integration: string; p_obj: Json; p_suppress?: boolean }
        Returns: Json
      }
      fh_jobber_apply_request: {
        Args: { p_integration: string; p_obj: Json; p_suppress?: boolean }
        Returns: Json
      }
      fh_jobber_apply_visit: {
        Args: { p_integration: string; p_obj: Json; p_suppress?: boolean }
        Returns: Json
      }
      fh_jobber_connect_start: {
        Args: { p_org_id: string; p_redirect_to?: string }
        Returns: Json
      }
      fh_jobber_connection_upsert: {
        Args: {
          p_access: string
          p_account_id: string
          p_display_name: string
          p_expires_at: string
          p_meta?: Json
          p_org_id: string
          p_refresh: string
          p_scopes: string
          p_user_id: string
        }
        Returns: string
      }
      fh_jobber_contact_for: {
        Args: {
          p_client: string
          p_integration: string
          p_link_entity: string
          p_link_ext: string
          p_stages: string[]
          p_window: string
        }
        Returns: string
      }
      fh_jobber_disconnect: {
        Args: { p_integration: string; p_reason?: string }
        Returns: undefined
      }
      fh_jobber_drain_tick: { Args: never; Returns: Json }
      fh_jobber_event_finish: {
        Args: {
          p_error?: string
          p_id: string
          p_result?: Json
          p_status: string
        }
        Returns: undefined
      }
      fh_jobber_events_claim: {
        Args: { p_account_id?: string; p_limit?: number }
        Returns: {
          account_id: string
          app_id: string | null
          attempts: number
          id: string
          integration_id: string | null
          item_id: string | null
          last_error: string | null
          occurred_at: string | null
          org_id: string | null
          processed_at: string | null
          raw: Json
          received_at: string
          result: Json | null
          status: string
          topic: string
        }[]
        SetofOptions: {
          from: "*"
          to: "fh_jobber_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fh_jobber_events_enqueue: {
        Args: {
          p_account_id: string
          p_app_id: string
          p_item_id: string
          p_occurred_at: string
          p_raw: Json
          p_topic: string
        }
        Returns: string
      }
      fh_jobber_integration_for_account: {
        Args: { p_account_id: string }
        Returns: Json
      }
      fh_jobber_integration_for_org: {
        Args: { p_org_id: string }
        Returns: Json
      }
      fh_jobber_kick: {
        Args: { p_body: Json; p_path: string }
        Returns: number
      }
      fh_jobber_mark_error: {
        Args: { p_error: string; p_integration: string; p_status: string }
        Returns: undefined
      }
      fh_jobber_num: { Args: { p: string }; Returns: number }
      fh_jobber_oauth_state_take: { Args: { p_state: string }; Returns: Json }
      fh_jobber_org_for: {
        Args: { p_integration: string; p_tags: string[] }
        Returns: string
      }
      fh_jobber_owner: { Args: { p_org_id: string }; Returns: string }
      fh_jobber_redirect_uri: { Args: never; Returns: string }
      fh_jobber_ref: {
        Args: { p_entity: string; p_ext: string; p_integration: string }
        Returns: string
      }
      fh_jobber_ref_set: {
        Args: {
          p_entity: string
          p_ext: string
          p_integration: string
          p_local: string
          p_number?: string
          p_org: string
          p_raw?: Json
          p_table: string
        }
        Returns: undefined
      }
      fh_jobber_refresh_lease: {
        Args: { p_integration: string; p_seconds?: number }
        Returns: boolean
      }
      fh_jobber_settings_set: {
        Args: { p_org_id: string; p_patch: Json }
        Returns: Json
      }
      fh_jobber_status: { Args: { p_org_id: string }; Returns: Json }
      fh_jobber_sync_lease: {
        Args: { p_integration: string; p_seconds?: number }
        Returns: boolean
      }
      fh_jobber_sync_request: {
        Args: { p_mode?: string; p_org_id: string }
        Returns: Json
      }
      fh_jobber_sync_state_set: {
        Args: { p_integration: string; p_patch: Json }
        Returns: Json
      }
      fh_jobber_tokens_get: { Args: { p_integration: string }; Returns: Json }
      fh_jobber_tokens_set: {
        Args: {
          p_access: string
          p_expires_at: string
          p_integration: string
          p_refresh: string
        }
        Returns: undefined
      }
      fh_jobber_ts: { Args: { p: string }; Returns: string }
      fh_jobber_upsert_appointment: {
        Args: {
          p_cancelled: boolean
          p_client: string
          p_completed: boolean
          p_contact: string
          p_end: string
          p_entity: string
          p_ext: string
          p_integration: string
          p_location: string
          p_notes: string
          p_org: string
          p_schedule: string
          p_start: string
        }
        Returns: string
      }
      fh_jobber_visit_booking_type: {
        Args: { p_org_id: string }
        Returns: string
      }
      fh_jsonb_to_num: { Args: { p: Json }; Returns: number }
      fh_jsonb_to_ts: { Args: { p: Json }; Returns: string }
      fh_lead_capture: {
        Args: {
          p_address?: string
          p_attribution?: Json
          p_data?: Json
          p_dedupe_key?: string
          p_email: string
          p_message?: string
          p_name: string
          p_org_id: string
          p_phone: string
          p_sms_consent?: boolean
          p_via: string
        }
        Returns: Json
      }
      fh_message_hold: {
        Args: {
          p_channel: string
          p_client_id: string
          p_immediate: boolean
          p_org_id: string
          p_phone_number_id: string
          p_purpose: string
        }
        Returns: Record<string, unknown>
      }
      fh_message_provider_status: {
        Args: {
          p_error?: string
          p_extra?: Json
          p_provider: string
          p_provider_message_id: string
          p_status: string
        }
        Returns: string
      }
      fh_money_visible: { Args: { p_org_id: string }; Returns: boolean }
      fh_next_local_time: {
        Args: {
          p_after?: string
          p_days?: string[]
          p_org_id: string
          p_time: string
        }
        Returns: string
      }
      fh_next_send_window_start: {
        Args: { p_at?: string; p_org_id: string }
        Returns: string
      }
      fh_normalize_email: { Args: { p_raw: string }; Returns: string }
      fh_normalize_phone: { Args: { p_raw: string }; Returns: string }
      fh_notify_org: {
        Args: {
          p_body?: string
          p_kind: string
          p_link?: string
          p_org_id: string
          p_title: string
          p_to?: string
          p_user_ids?: string[]
        }
        Returns: number
      }
      fh_org_can_read_sub_doc: { Args: { p_path: string }; Returns: boolean }
      fh_org_can_write_sub_doc: { Args: { p_path: string }; Returns: boolean }
      fh_org_ctx: { Args: { p_org_id: string }; Returns: Json }
      fh_org_tz: { Args: { p_org_id: string }; Returns: string }
      fh_outbox_claim: {
        Args: { p_limit?: number; p_worker: string }
        Returns: {
          agent_run_id: string | null
          attempts: number
          campaign_id: string | null
          client_id: string | null
          created_at: string
          done_at: string | null
          hold_reason: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          message_id: string | null
          next_attempt_at: string
          org_id: string
          payload: Json
          phone_number_id: string | null
          result: Json | null
          run_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "fh_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fh_outbox_complete: {
        Args: {
          p_error?: string
          p_id: string
          p_ok: boolean
          p_result?: Json
          p_retryable?: boolean
        }
        Returns: undefined
      }
      fh_outbox_release_holds: { Args: never; Returns: number }
      fh_pick_phone_number: {
        Args: { p_org_id: string; p_tag?: string }
        Returns: string
      }
      fh_random_key: { Args: { p_len?: number }; Returns: string }
      fh_record_public_link_view: {
        Args: {
          p_contact_id: string
          p_ip_hash?: string
          p_kind: string
          p_metadata?: Json
          p_org_id: string
          p_public_link_id: string
          p_referer?: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: undefined
      }
      fh_render_template: {
        Args: { p_ctx: Json; p_text: string }
        Returns: string
      }
      fh_resolve_account_labels: {
        Args: { p_user_ids: string[] }
        Returns: {
          label: string
          role: string
          user_id: string
        }[]
      }
      fh_resolve_client: {
        Args: {
          p_address?: string
          p_email: string
          p_name?: string
          p_org_id: string
          p_phone: string
          p_source?: string
        }
        Returns: Record<string, unknown>
      }
      fh_review_click: { Args: { p_track_key: string }; Returns: string }
      fh_run_cancel: {
        Args: { p_reason?: string; p_run_id: string }
        Returns: undefined
      }
      fh_run_follow_up_engine: { Args: { p_org_id?: string }; Returns: Json }
      fh_run_log: {
        Args: {
          p_detail?: Json
          p_org: string
          p_run: string
          p_status: string
          p_step: string
          p_type: string
        }
        Returns: undefined
      }
      fh_seed_growth_defaults: {
        Args: { p_mode?: string; p_org_id: string; p_vertical?: string }
        Returns: Json
      }
      fh_segment_count: {
        Args: { p_filter: Json; p_org_id: string }
        Returns: number
      }
      fh_segment_members: {
        Args: { p_filter: Json; p_limit?: number; p_org_id: string }
        Returns: {
          client_id: string
        }[]
      }
      fh_send_message: {
        Args: {
          p_body: string
          p_channel: string
          p_client_id: string
          p_contact_id?: string
          p_media?: Json
          p_phone_number_id?: string
          p_subject?: string
        }
        Returns: string
      }
      fh_slugify: { Args: { p_text: string }; Returns: string }
      fh_snapshot_export: { Args: { p_org_id: string }; Returns: Json }
      fh_snapshot_import: {
        Args: { p_mode?: string; p_org_id: string; p_snapshot: Json }
        Returns: Json
      }
      fh_sub_can_read_doc: { Args: { p_path: string }; Returns: boolean }
      fh_sub_profile_ids_for_caller: { Args: never; Returns: string[] }
      fh_tag_add: {
        Args: {
          p_client_id: string
          p_org_id: string
          p_source?: string
          p_tag: string
          p_user?: string
        }
        Returns: boolean
      }
      fh_tag_remove: {
        Args: { p_client_id: string; p_org_id: string; p_tag: string }
        Returns: boolean
      }
      fh_workflow_publish: {
        Args: { p_activate?: boolean; p_workflow_id: string }
        Returns: string
      }
      fh_workflow_validate: { Args: { p_def: Json }; Returns: string[] }
      fn_approve_quote_version: {
        Args: {
          p_approval_method: string
          p_approval_note?: string
          p_approved_by_email?: string
          p_approved_by_name: string
          p_base_total: number
          p_contact_id: string
          p_excluded_count: number
          p_optional_total: number
          p_signature_data?: string
          p_signature_kind?: string
          p_snapshot: Json
          p_user_id: string
        }
        Returns: {
          approval_method: string
          approval_note: string | null
          approval_token: string | null
          approved_at: string
          approved_by_email: string | null
          approved_by_name: string
          base_total: number
          client_ip: unknown
          client_user_agent: string | null
          contact_id: string
          created_at: string
          excluded_count: number
          id: string
          optional_total: number
          org_id: string | null
          pdf_file_id: string | null
          signature_data: string | null
          signature_file_id: string | null
          signature_kind: string | null
          snapshot: Json
          status: string
          superseded_at: string | null
          superseded_by: string | null
          token_expires_at: string | null
          user_id: string
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "fh_quote_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      org_role: "owner" | "admin" | "manager" | "foreman" | "crew"
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
      org_role: ["owner", "admin", "manager", "foreman", "crew"],
    },
  },
} as const
