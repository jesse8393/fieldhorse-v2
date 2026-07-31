// mobile/lib/database.types.ts, copy of the web app database types.
// Both are generated from the same Supabase schema. In the monorepo
// extraction (next step) this moves to packages/shared and both apps
// import it. For the spike, a copy keeps mobile self-contained.

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
          phone: string | null
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
          phone?: string | null
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
          phone?: string | null
          total_lifetime_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        ]
      }
      fh_contacts: {
        Row: {
          address: string | null
          amount: number | null
          approved_quote_version_id: string | null
          client_id: string | null
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
        ]
      }
      fh_esign_envelopes: {
        Row: {
          completed_at: string | null
          contact_id: string
          created_at: string
          envelope_id: string
          id: string
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
          total_high?: number | null
          total_low?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        ]
      }
      fh_inspections: {
        Row: {
          contact_id: string | null
          created_at: string | null
          data: Json | null
          id: string
          inspector: string | null
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
        ]
      }
      fh_invoices: {
        Row: {
          amount: number
          contact_id: string
          created_at: string
          due_at: string | null
          id: string
          issued_at: string | null
          notes: string | null
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
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
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
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
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
        ]
      }
      fh_job_todos: {
        Row: {
          completed_at: string | null
          created_at: string
          done: boolean
          due_at: string | null
          id: string
          job_id: string
          text: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          job_id: string
          text: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          job_id?: string
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
        ]
      }
      fh_mileage: {
        Row: {
          contact_id: string | null
          created_at: string | null
          drove_on: string | null
          id: string
          miles: number
          purpose: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          drove_on?: string | null
          id?: string
          miles: number
          purpose?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          drove_on?: string | null
          id?: string
          miles?: number
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
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      fh_payments: {
        Row: {
          amount: number
          contact_id: string | null
          created_at: string | null
          id: string
          kind: string | null
          method: string | null
          paid_on: string | null
          reference: string | null
          user_id: string
        }
        Insert: {
          amount: number
          contact_id?: string | null
          created_at?: string | null
          id?: string
          kind?: string | null
          method?: string | null
          paid_on?: string | null
          reference?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          contact_id?: string | null
          created_at?: string | null
          id?: string
          kind?: string | null
          method?: string | null
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
        ]
      }
      fh_public_links: {
        Row: {
          contact_id: string
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          last_viewed_at: string | null
          revoked_at: string | null
          token: string
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          contact_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          token: string
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          contact_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          token?: string
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "fh_public_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fh_contacts"
            referencedColumns: ["id"]
          },
        ]
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
          rate_high?: number
          rate_low?: number
          trade_key?: string
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fh_schedule: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string | null
          description: string | null
          end_at: string | null
          id: string
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
        ]
      }
      fh_stage_transitions: {
        Row: {
          contact_id: string
          from_stage: string | null
          id: string
          to_stage: string
          transitioned_at: string
          transitioned_by: string | null
          user_id: string
        }
        Insert: {
          contact_id: string
          from_stage?: string | null
          id?: string
          to_stage: string
          transitioned_at?: string
          transitioned_by?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string
          from_stage?: string | null
          id?: string
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
          insurance_carrier: string | null
          insurance_expires_on: string | null
          insurance_policy: string | null
          license_number: string | null
          license_path: string | null
          name: string
          notes: string | null
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
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy?: string | null
          license_number?: string | null
          license_path?: string | null
          name: string
          notes?: string | null
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
          insurance_carrier?: string | null
          insurance_expires_on?: string | null
          insurance_policy?: string | null
          license_number?: string | null
          license_path?: string | null
          name?: string
          notes?: string | null
          payment_handle?: string | null
          payment_method?: string | null
          phone?: string | null
          trades?: string[] | null
          updated_at?: string | null
          user_id?: string
          w9_path?: string | null
        }
        Relationships: []
      }
      fh_subs: {
        Row: {
          contact_id: string | null
          created_at: string | null
          id: string
          name: string | null
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
        ]
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
          full_name: string | null
          greeting: string | null
          insured_text: string | null
          license_number: string | null
          location_lat: number | null
          location_lon: number | null
          logo_uploaded_at: string | null
          logo_url: string | null
          onboarded_at: string | null
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
          full_name?: string | null
          greeting?: string | null
          insured_text?: string | null
          license_number?: string | null
          location_lat?: number | null
          location_lon?: number | null
          logo_uploaded_at?: string | null
          logo_url?: string | null
          onboarded_at?: string | null
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
          full_name?: string | null
          greeting?: string | null
          insured_text?: string | null
          license_number?: string | null
          location_lat?: number | null
          location_lon?: number | null
          logo_uploaded_at?: string | null
          logo_url?: string | null
          onboarded_at?: string | null
          preferences?: Json | null
          role?: string | null
          services?: string[] | null
          subscription_tier?: string | null
          user_id?: string
          warranty_default?: string | null
          webhook_key?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fh_clients_recompute: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      fh_resolve_account_labels: {
        Args: { p_user_ids: string[] }
        Returns: {
          label: string
          role: string
          user_id: string
        }[]
      }
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
      [_ in never]: never
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
    Enums: {},
  },
} as const

