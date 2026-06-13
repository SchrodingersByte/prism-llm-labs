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
      account_members: {
        Row: {
          account_id: string | null
          created_at: string | null
          id: string
          role: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string | null
          id: string
          name: string
          plan: string | null
          slug: string
          sso_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          plan?: string | null
          slug: string
          sso_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          plan?: string | null
          slug?: string
          sso_enabled?: boolean | null
        }
        Relationships: []
      }
      action_definitions: {
        Row: {
          action_tag: string
          cost_per_action: number | null
          created_at: string
          currency: string
          feature_tag: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          action_tag: string
          cost_per_action?: number | null
          created_at?: string
          currency?: string
          feature_tag?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          action_tag?: string
          cost_per_action?: number | null
          created_at?: string
          currency?: string
          feature_tag?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_definitions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          channels: string[]
          created_at: string
          custom_webhook: string | null
          id: string
          is_active: boolean
          last_fired_at: string | null
          name: string
          org_id: string
          project_id: string | null
          slack_webhook: string | null
          threshold_value: number
          trigger_type: string
        }
        Insert: {
          channels?: string[]
          created_at?: string
          custom_webhook?: string | null
          id?: string
          is_active?: boolean
          last_fired_at?: string | null
          name: string
          org_id: string
          project_id?: string | null
          slack_webhook?: string | null
          threshold_value: number
          trigger_type: string
        }
        Update: {
          channels?: string[]
          created_at?: string
          custom_webhook?: string | null
          id?: string
          is_active?: boolean
          last_fired_at?: string | null
          name?: string
          org_id?: string
          project_id?: string | null
          slack_webhook?: string | null
          threshold_value?: number
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          auto_pause_reason: string | null
          auto_paused_at: string | null
          created_at: string
          environment: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string
          project_id: string | null
          prompt_logging_enabled: boolean
          tags: Json
        }
        Insert: {
          auto_pause_reason?: string | null
          auto_paused_at?: string | null
          created_at?: string
          environment?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id: string
          project_id?: string | null
          prompt_logging_enabled?: boolean
          tags?: Json
        }
        Update: {
          auto_pause_reason?: string | null
          auto_paused_at?: string | null
          created_at?: string
          environment?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          project_id?: string | null
          prompt_logging_enabled?: boolean
          tags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          org_id: string
          resource_id: string | null
          resource_name: string | null
          resource_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          org_id: string
          resource_id?: string | null
          resource_name?: string | null
          resource_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          org_id?: string
          resource_id?: string | null
          resource_name?: string | null
          resource_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          alert_threshold_pct: number
          amount_usd: number
          created_at: string
          enforce_hard_cap: boolean
          id: string
          is_active: boolean
          name: string | null
          org_id: string
          period: string
          project_id: string | null
          provider: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          alert_threshold_pct?: number
          amount_usd: number
          created_at?: string
          enforce_hard_cap?: boolean
          id?: string
          is_active?: boolean
          name?: string | null
          org_id: string
          period: string
          project_id?: string | null
          provider?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          alert_threshold_pct?: number
          amount_usd?: number
          created_at?: string
          enforce_hard_cap?: boolean
          id?: string
          is_active?: boolean
          name?: string | null
          org_id?: string
          period?: string
          project_id?: string | null
          provider?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_billing_connections: {
        Row: {
          created_at: string
          credentials_encrypted: Json
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          org_id: string
          provider: string
          sync_error: string | null
        }
        Insert: {
          created_at?: string
          credentials_encrypted?: Json
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          org_id: string
          provider: string
          sync_error?: string | null
        }
        Update: {
          created_at?: string
          credentials_encrypted?: Json
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          org_id?: string
          provider?: string
          sync_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cloud_billing_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_quota_profiles: {
        Row: {
          created_at: string
          customer_id: string
          display_name: string | null
          id: string
          is_active: boolean
          monthly_spend_usd: number | null
          monthly_token_limit: number | null
          org_id: string
          soft_cap_model: string | null
          soft_cap_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          monthly_spend_usd?: number | null
          monthly_token_limit?: number | null
          org_id: string
          soft_cap_model?: string | null
          soft_cap_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          monthly_spend_usd?: number | null
          monthly_token_limit?: number | null
          org_id?: string
          soft_cap_model?: string | null
          soft_cap_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_quota_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enforce_checkins: {
        Row: {
          api_key_id: string | null
          app_name: string | null
          checked_in_at: string
          environment: string | null
          git_branch: string | null
          git_commit: string | null
          id: string
          language: string | null
          org_id: string
          raw_module: string
          service_name: string | null
        }
        Insert: {
          api_key_id?: string | null
          app_name?: string | null
          checked_in_at?: string
          environment?: string | null
          git_branch?: string | null
          git_commit?: string | null
          id?: string
          language?: string | null
          org_id: string
          raw_module: string
          service_name?: string | null
        }
        Update: {
          api_key_id?: string | null
          app_name?: string | null
          checked_in_at?: string
          environment?: string | null
          git_branch?: string | null
          git_commit?: string | null
          id?: string
          language?: string | null
          org_id?: string
          raw_module?: string
          service_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enforce_checkins_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforce_checkins_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_policies: {
        Row: {
          allowed_models: string[]
          blocked_models: string[]
          created_at: string
          daily_budget_usd: number | null
          data_residency_region: string | null
          gateway_required: boolean
          id: string
          model_policy: string
          monthly_budget_usd: number | null
          name: string
          pii_action: string
          pii_detection_enabled: boolean
          requests_per_minute: number | null
          scope_id: string
          scope_type: string
          soft_cap_fallback_model: string | null
          soft_cap_pct: number | null
          tokens_per_day: number | null
          updated_at: string
        }
        Insert: {
          allowed_models?: string[]
          blocked_models?: string[]
          created_at?: string
          daily_budget_usd?: number | null
          data_residency_region?: string | null
          gateway_required?: boolean
          id?: string
          model_policy?: string
          monthly_budget_usd?: number | null
          name: string
          pii_action?: string
          pii_detection_enabled?: boolean
          requests_per_minute?: number | null
          scope_id: string
          scope_type: string
          soft_cap_fallback_model?: string | null
          soft_cap_pct?: number | null
          tokens_per_day?: number | null
          updated_at?: string
        }
        Update: {
          allowed_models?: string[]
          blocked_models?: string[]
          created_at?: string
          daily_budget_usd?: number | null
          data_residency_region?: string | null
          gateway_required?: boolean
          id?: string
          model_policy?: string
          monthly_budget_usd?: number | null
          name?: string
          pii_action?: string
          pii_detection_enabled?: boolean
          requests_per_minute?: number | null
          scope_id?: string
          scope_type?: string
          soft_cap_fallback_model?: string | null
          soft_cap_pct?: number | null
          tokens_per_day?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      eval_scores: {
        Row: {
          cost_usd: number | null
          created_at: string
          eval_run_id: string | null
          id: string
          judge_model: string | null
          latency_ms: number | null
          model: string | null
          org_id: string
          passed: boolean | null
          reason: string | null
          score: number | null
          scorer_type: string
          span_id: string | null
          trace_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          eval_run_id?: string | null
          id?: string
          judge_model?: string | null
          latency_ms?: number | null
          model?: string | null
          org_id: string
          passed?: boolean | null
          reason?: string | null
          score?: number | null
          scorer_type?: string
          span_id?: string | null
          trace_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          eval_run_id?: string | null
          id?: string
          judge_model?: string | null
          latency_ms?: number | null
          model?: string | null
          org_id?: string
          passed?: boolean | null
          reason?: string | null
          score?: number | null
          scorer_type?: string
          span_id?: string | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eval_scores_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "evaluation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_datasets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          samples: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          samples?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          samples?: Json
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_datasets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          current_model: string | null
          dataset_id: string | null
          edge_cases: number | null
          id: string
          mode: string
          n_samples: number | null
          org_id: string
          overall_score: number | null
          rec_id: string | null
          samples: Json | null
          started_at: string | null
          status: string
          target_model: string | null
          trace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          current_model?: string | null
          dataset_id?: string | null
          edge_cases?: number | null
          id?: string
          mode: string
          n_samples?: number | null
          org_id: string
          overall_score?: number | null
          rec_id?: string | null
          samples?: Json | null
          started_at?: string | null
          status?: string
          target_model?: string | null
          trace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          current_model?: string | null
          dataset_id?: string | null
          edge_cases?: number | null
          id?: string
          mode?: string
          n_samples?: number | null
          org_id?: string
          overall_score?: number | null
          rec_id?: string | null
          samples?: Json | null
          started_at?: string | null
          status?: string
          target_model?: string | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "evaluation_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      export_destinations: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          secret_token: string | null
          type: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          secret_token?: string | null
          type: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          secret_token?: string | null
          type?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_destinations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_connections: {
        Row: {
          access_token: string
          github_login: string
          github_user_id: number
          id: string
          installed_at: string
          org_id: string
          scope: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          github_login: string
          github_user_id: number
          id?: string
          installed_at?: string
          org_id: string
          scope?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          github_login?: string
          github_user_id?: number
          id?: string
          installed_at?: string
          org_id?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_repo_branches: {
        Row: {
          branch_name: string
          commit_author: string | null
          commit_date: string | null
          commit_sha: string
          id: string
          pr_number: number | null
          pr_title: string | null
          repo_id: number
          synced_at: string
        }
        Insert: {
          branch_name: string
          commit_author?: string | null
          commit_date?: string | null
          commit_sha: string
          id?: string
          pr_number?: number | null
          pr_title?: string | null
          repo_id: number
          synced_at?: string
        }
        Update: {
          branch_name?: string
          commit_author?: string | null
          commit_date?: string | null
          commit_sha?: string
          id?: string
          pr_number?: number | null
          pr_title?: string | null
          repo_id?: number
          synced_at?: string
        }
        Relationships: []
      }
      gpu_inference_runs: {
        Row: {
          api_key_id: string | null
          cost_usd: number
          created_at: string
          duration_seconds: number | null
          end_time: string | null
          endpoint_name: string
          id: string
          instance_type: string | null
          org_id: string
          provider: string
          requests: number | null
          session_id: string | null
          start_time: string | null
          tags: Json | null
        }
        Insert: {
          api_key_id?: string | null
          cost_usd: number
          created_at?: string
          duration_seconds?: number | null
          end_time?: string | null
          endpoint_name: string
          id?: string
          instance_type?: string | null
          org_id: string
          provider: string
          requests?: number | null
          session_id?: string | null
          start_time?: string | null
          tags?: Json | null
        }
        Update: {
          api_key_id?: string | null
          cost_usd?: number
          created_at?: string
          duration_seconds?: number | null
          end_time?: string | null
          endpoint_name?: string
          id?: string
          instance_type?: string | null
          org_id?: string
          provider?: string
          requests?: number | null
          session_id?: string | null
          start_time?: string | null
          tags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "gpu_inference_runs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gpu_inference_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guardrail_profiles: {
        Row: {
          config: Json
          created_at: string
          custom_patterns: Json
          id: string
          name: string
          org_id: string
          pii_types: string[] | null
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          custom_patterns?: Json
          id?: string
          name: string
          org_id: string
          pii_types?: string[] | null
          type?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          custom_patterns?: Json
          id?: string
          name?: string
          org_id?: string
          pii_types?: string[] | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardrail_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      guardrail_rules: {
        Row: {
          action: string
          apply_to: string
          condition: Json | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          priority: number
          profile_id: string
          sampling_rate: number
          updated_at: string
        }
        Insert: {
          action: string
          apply_to?: string
          condition?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          priority?: number
          profile_id: string
          sampling_rate?: number
          updated_at?: string
        }
        Update: {
          action?: string
          apply_to?: string
          condition?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          priority?: number
          profile_id?: string
          sampling_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardrail_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardrail_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "guardrail_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_log: {
        Row: {
          api_key_id: string | null
          error_code: string | null
          event_count: number
          id: number
          key_prefix: string | null
          latency_ms: number | null
          org_id: string
          project_id: string | null
          source_ip: string | null
          status: string
          total_cost: number
          ts: string
        }
        Insert: {
          api_key_id?: string | null
          error_code?: string | null
          event_count?: number
          id?: number
          key_prefix?: string | null
          latency_ms?: number | null
          org_id: string
          project_id?: string | null
          source_ip?: string | null
          status: string
          total_cost?: number
          ts?: string
        }
        Update: {
          api_key_id?: string | null
          error_code?: string | null
          event_count?: number
          id?: number
          key_prefix?: string | null
          latency_ms?: number | null
          org_id?: string
          project_id?: string | null
          source_ip?: string | null
          status?: string
          total_cost?: number
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      key_caps: {
        Row: {
          amount_usd: number
          api_key_id: string
          created_at: string
          id: string
          period: string
        }
        Insert: {
          amount_usd: number
          api_key_id: string
          created_at?: string
          id?: string
          period: string
        }
        Update: {
          amount_usd?: number
          api_key_id?: string
          created_at?: string
          id?: string
          period?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_caps_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      key_extension_requests: {
        Row: {
          api_key_id: string
          approved_by: string | null
          created_at: string
          current_value: string | null
          id: string
          org_id: string
          reason: string | null
          request_type: string
          requested_value: string | null
          requester_id: string
          resolved_at: string | null
          status: string
          urgency: string | null
        }
        Insert: {
          api_key_id: string
          approved_by?: string | null
          created_at?: string
          current_value?: string | null
          id?: string
          org_id: string
          reason?: string | null
          request_type: string
          requested_value?: string | null
          requester_id: string
          resolved_at?: string | null
          status?: string
          urgency?: string | null
        }
        Update: {
          api_key_id?: string
          approved_by?: string | null
          created_at?: string
          current_value?: string | null
          id?: string
          org_id?: string
          reason?: string | null
          request_type?: string
          requested_value?: string | null
          requester_id?: string
          resolved_at?: string | null
          status?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "key_extension_requests_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_extension_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      key_provider_links: {
        Row: {
          api_key_id: string
          created_at: string
          id: string
          is_primary: boolean
          provider_key_id: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          provider_key_id: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          provider_key_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_provider_links_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_provider_links_provider_key_id_fkey"
            columns: ["provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_reconciliation: {
        Row: {
          actual_cost: number
          cost_source: string
          environment: string | null
          estimated_cost: number
          event_id: string
          id: string
          operation_type: string | null
          org_id: string
          reconciled_at: string | null
          resource_name: string | null
          session_id: string
        }
        Insert: {
          actual_cost: number
          cost_source: string
          environment?: string | null
          estimated_cost?: number
          event_id: string
          id?: string
          operation_type?: string | null
          org_id: string
          reconciled_at?: string | null
          resource_name?: string | null
          session_id: string
        }
        Update: {
          actual_cost?: number
          cost_source?: string
          environment?: string | null
          estimated_cost?: number
          event_id?: string
          id?: string
          operation_type?: string | null
          org_id?: string
          reconciled_at?: string | null
          resource_name?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_reconciliation_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_project_roles: {
        Row: {
          created_at: string
          id: string
          member_id: string
          project_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          project_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "member_project_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_project_roles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"] | null
          scope_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"] | null
          scope_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"] | null
          scope_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      model_approval_requests: {
        Row: {
          created_at: string
          enforcement_policy_id: string | null
          id: string
          model: string
          org_id: string
          project_id: string | null
          provider: string
          reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          enforcement_policy_id?: string | null
          id?: string
          model: string
          org_id: string
          project_id?: string | null
          provider: string
          reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          enforcement_policy_id?: string | null
          id?: string
          model?: string
          org_id?: string
          project_id?: string | null
          provider?: string
          reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_approval_requests_enforcement_policy_id_fkey"
            columns: ["enforcement_policy_id"]
            isOneToOne: false
            referencedRelation: "enforcement_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_approval_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_approval_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      model_routing_rules: {
        Row: {
          created_at: string | null
          fallback_models: string[]
          id: string
          is_active: boolean | null
          org_id: string
          primary_model: string
          trigger_on_codes: number[]
        }
        Insert: {
          created_at?: string | null
          fallback_models?: string[]
          id?: string
          is_active?: boolean | null
          org_id: string
          primary_model: string
          trigger_on_codes?: number[]
        }
        Update: {
          created_at?: string | null
          fallback_models?: string[]
          id?: string
          is_active?: boolean | null
          org_id?: string
          primary_model?: string
          trigger_on_codes?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "model_routing_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          read_at: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          read_at?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_model_policies: {
        Row: {
          created_at: string
          created_by: string | null
          environments: string[] | null
          id: string
          model_pattern: string
          org_id: string
          policy: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environments?: string[] | null
          id?: string
          model_pattern: string
          org_id: string
          policy: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environments?: string[] | null
          id?: string
          model_pattern?: string
          org_id?: string
          policy?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_model_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_region: string
          cache_conversation_history_threshold: number
          cache_enabled: boolean
          cache_mode: string
          cache_ttl_seconds: number
          created_at: string
          data_residency_policy: string
          gateway_mode: string
          id: string
          name: string
          onboarding_step: number
          pii_custom_patterns: Json | null
          pii_detection_action: string
          pii_detection_enabled: boolean
          pii_mask_patterns: string[]
          pii_masking_enabled: boolean
          plan: string
          razorpay_customer_id: string | null
          razorpay_subscription_id: string | null
          similarity_threshold: number
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_region?: string
          cache_conversation_history_threshold?: number
          cache_enabled?: boolean
          cache_mode?: string
          cache_ttl_seconds?: number
          created_at?: string
          data_residency_policy?: string
          gateway_mode?: string
          id?: string
          name: string
          onboarding_step?: number
          pii_custom_patterns?: Json | null
          pii_detection_action?: string
          pii_detection_enabled?: boolean
          pii_mask_patterns?: string[]
          pii_masking_enabled?: boolean
          plan?: string
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          similarity_threshold?: number
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_region?: string
          cache_conversation_history_threshold?: number
          cache_enabled?: boolean
          cache_mode?: string
          cache_ttl_seconds?: number
          created_at?: string
          data_residency_policy?: string
          gateway_mode?: string
          id?: string
          name?: string
          onboarding_step?: number
          pii_custom_patterns?: Json | null
          pii_detection_action?: string
          pii_detection_enabled?: boolean
          pii_mask_patterns?: string[]
          pii_masking_enabled?: boolean
          plan?: string
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          similarity_threshold?: number
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      outcome_events: {
        Row: {
          action_tag: string | null
          api_key_id: string | null
          created_at: string
          feature_tag: string
          id: string
          metadata: Json | null
          occurred_at: string
          org_id: string
          session_id: string | null
          success: boolean
          value_usd: number | null
        }
        Insert: {
          action_tag?: string | null
          api_key_id?: string | null
          created_at?: string
          feature_tag: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          org_id: string
          session_id?: string | null
          success?: boolean
          value_usd?: number | null
        }
        Update: {
          action_tag?: string | null
          api_key_id?: string | null
          created_at?: string
          feature_tag?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          org_id?: string
          session_id?: string | null
          success?: boolean
          value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_events_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_rules: {
        Row: {
          action_tag: string | null
          created_at: string
          event_source: string
          feature_tag: string
          id: string
          is_active: boolean
          org_id: string
          success: boolean
          value_usd: number | null
        }
        Insert: {
          action_tag?: string | null
          created_at?: string
          event_source: string
          feature_tag: string
          id?: string
          is_active?: boolean
          org_id: string
          success?: boolean
          value_usd?: number | null
        }
        Update: {
          action_tag?: string | null
          created_at?: string
          event_source?: string
          feature_tag?: string
          id?: string
          is_active?: boolean
          org_id?: string
          success?: boolean
          value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_invite_projects: {
        Row: {
          id: string
          invite_id: string
          project_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          id?: string
          invite_id: string
          project_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          id?: string
          invite_id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "pending_invite_projects_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "pending_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_invite_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"] | null
          scope_type: string
          sso_only: boolean
          sso_provider: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"] | null
          scope_type?: string
          sso_only?: boolean
          sso_provider?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"] | null
          scope_type?: string
          sso_only?: boolean
          sso_provider?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_incidents: {
        Row: {
          action_taken: string
          api_key_id: string | null
          created_at: string
          field_paths: string[] | null
          id: string
          model: string
          org_id: string
          pii_types: string[]
          provider: string
          user_id: string | null
        }
        Insert: {
          action_taken: string
          api_key_id?: string | null
          created_at?: string
          field_paths?: string[] | null
          id?: string
          model: string
          org_id: string
          pii_types: string[]
          provider: string
          user_id?: string | null
        }
        Update: {
          action_taken?: string
          api_key_id?: string | null
          created_at?: string
          field_paths?: string[] | null
          id?: string
          model?: string
          org_id?: string
          pii_types?: string[]
          provider?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pii_incidents_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pii_incidents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_features: {
        Row: {
          category: string
          description: string | null
          key: string
          min_plan: string
          name: string
          override_orgs: string[]
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          description?: string | null
          key: string
          min_plan?: string
          name: string
          override_orgs?: string[]
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          description?: string | null
          key?: string
          min_plan?: string
          name?: string
          override_orgs?: string[]
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      project_github_repos: {
        Row: {
          connected_at: string
          connection_id: string
          default_branch: string
          id: string
          is_private: boolean | null
          project_id: string
          repo_id: number
          repo_name: string
          repo_owner: string
        }
        Insert: {
          connected_at?: string
          connection_id: string
          default_branch?: string
          id?: string
          is_private?: boolean | null
          project_id: string
          repo_id: number
          repo_name: string
          repo_owner: string
        }
        Update: {
          connected_at?: string
          connection_id?: string
          default_branch?: string
          id?: string
          is_private?: boolean | null
          project_id?: string
          repo_id?: number
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_github_repos_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "github_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_github_repos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_repos: {
        Row: {
          connected_at: string
          connection_id: string
          default_branch: string
          full_name: string | null
          id: string
          is_private: boolean | null
          project_id: string
          provider: string
          repo_id: number
          repo_name: string
          repo_owner: string
        }
        Insert: {
          connected_at?: string
          connection_id: string
          default_branch?: string
          full_name?: string | null
          id?: string
          is_private?: boolean | null
          project_id: string
          provider: string
          repo_id: number
          repo_name: string
          repo_owner: string
        }
        Update: {
          connected_at?: string
          connection_id?: string
          default_branch?: string
          full_name?: string | null
          id?: string
          is_private?: boolean | null
          project_id?: string
          provider?: string
          repo_id?: number
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_repos_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "scm_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_repos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          cost_center_code: string | null
          created_at: string
          description: string | null
          id: string
          monthly_budget_usd: number | null
          name: string
          org_id: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          monthly_budget_usd?: number | null
          name: string
          org_id: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          cost_center_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          monthly_budget_usd?: number | null
          name?: string
          org_id?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_keys: {
        Row: {
          allowed_models: string[]
          aws_region: string | null
          azure_endpoint: string | null
          created_at: string
          custom_endpoint: string | null
          data_region: string
          id: string
          is_active: boolean
          key_encrypted: string
          key_hint: string
          name: string
          org_id: string
          project_id: string | null
          provider: string
          use_for_reconciliation: boolean
        }
        Insert: {
          allowed_models?: string[]
          aws_region?: string | null
          azure_endpoint?: string | null
          created_at?: string
          custom_endpoint?: string | null
          data_region?: string
          id?: string
          is_active?: boolean
          key_encrypted: string
          key_hint: string
          name: string
          org_id: string
          project_id?: string | null
          provider: string
          use_for_reconciliation?: boolean
        }
        Update: {
          allowed_models?: string[]
          aws_region?: string | null
          azure_endpoint?: string | null
          created_at?: string
          custom_endpoint?: string | null
          data_region?: string
          id?: string
          is_active?: boolean
          key_encrypted?: string
          key_hint?: string
          name?: string
          org_id?: string
          project_id?: string | null
          provider?: string
          use_for_reconciliation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "provider_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_snapshots: {
        Row: {
          fetched_at: string
          id: string
          input_tokens: number | null
          model: string
          org_id: string
          output_tokens: number | null
          provider: string
          provider_key_id: string
          raw_cost_usd: number | null
          requests: number | null
          snapshot_date: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          input_tokens?: number | null
          model?: string
          org_id: string
          output_tokens?: number | null
          provider: string
          provider_key_id: string
          raw_cost_usd?: number | null
          requests?: number | null
          snapshot_date: string
        }
        Update: {
          fetched_at?: string
          id?: string
          input_tokens?: number | null
          model?: string
          org_id?: string
          output_tokens?: number | null
          provider?: string
          provider_key_id?: string
          raw_cost_usd?: number | null
          requests?: number | null
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_snapshots_provider_key_id_fkey"
            columns: ["provider_key_id"]
            isOneToOne: false
            referencedRelation: "provider_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_actions: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string
          current_model: string | null
          feature: string | null
          id: string
          org_id: string
          rec_id: string
          rec_type: string
          rejected_at: string | null
          staged_at: string | null
          status: string
          suggested_model: string | null
          title: string | null
          updated_at: string
          validation_result: Json | null
          validation_score: number | null
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          current_model?: string | null
          feature?: string | null
          id?: string
          org_id: string
          rec_id: string
          rec_type: string
          rejected_at?: string | null
          staged_at?: string | null
          status?: string
          suggested_model?: string | null
          title?: string | null
          updated_at?: string
          validation_result?: Json | null
          validation_score?: number | null
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          current_model?: string | null
          feature?: string | null
          id?: string
          org_id?: string
          rec_id?: string
          rec_type?: string
          rejected_at?: string | null
          staged_at?: string | null
          status?: string
          suggested_model?: string | null
          title?: string | null
          updated_at?: string
          validation_result?: Json | null
          validation_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_narratives: {
        Row: {
          generated_at: string
          id: string
          narrative: string
          org_id: string
          rec_key: string
          stats_hash: string | null
        }
        Insert: {
          generated_at?: string
          id?: string
          narrative: string
          org_id: string
          rec_key: string
          stats_hash?: string | null
        }
        Update: {
          generated_at?: string
          id?: string
          narrative?: string
          org_id?: string
          rec_key?: string
          stats_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_narratives_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          created_at: string
          filters: Json
          format: string
          id: string
          is_active: boolean
          last_sent_at: string | null
          name: string
          org_id: string
          recipients: string[]
          report_type: string
          schedule_cron: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          format?: string
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name: string
          org_id: string
          recipients?: string[]
          report_type?: string
          schedule_cron: string
        }
        Update: {
          created_at?: string
          filters?: Json
          format?: string
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name?: string
          org_id?: string
          recipients?: string[]
          report_type?: string
          schedule_cron?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      request_logs: {
        Row: {
          api_key_id: string | null
          completion: string | null
          cost_usd: number | null
          created_at: string
          git_author: string | null
          git_branch: string | null
          id: string
          input_tokens: number | null
          key_type: string | null
          latency_ms: number | null
          model: string
          org_id: string
          output_tokens: number | null
          project_id: string | null
          prompt: Json | null
          provider: string
          routed_from: string | null
          session_id: string | null
          span_id: string | null
          status_code: number | null
          trace_id: string | null
        }
        Insert: {
          api_key_id?: string | null
          completion?: string | null
          cost_usd?: number | null
          created_at?: string
          git_author?: string | null
          git_branch?: string | null
          id?: string
          input_tokens?: number | null
          key_type?: string | null
          latency_ms?: number | null
          model: string
          org_id: string
          output_tokens?: number | null
          project_id?: string | null
          prompt?: Json | null
          provider?: string
          routed_from?: string | null
          session_id?: string | null
          span_id?: string | null
          status_code?: number | null
          trace_id?: string | null
        }
        Update: {
          api_key_id?: string | null
          completion?: string | null
          cost_usd?: number | null
          created_at?: string
          git_author?: string | null
          git_branch?: string | null
          id?: string
          input_tokens?: number | null
          key_type?: string | null
          latency_ms?: number | null
          model?: string
          org_id?: string
          output_tokens?: number | null
          project_id?: string | null
          prompt?: Json | null
          provider?: string
          routed_from?: string | null
          session_id?: string | null
          span_id?: string | null
          status_code?: number | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_policies: {
        Row: {
          action: Json
          condition: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          priority: number
          updated_at: string
        }
        Insert: {
          action: Json
          condition: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          priority?: number
          updated_at?: string
        }
        Update: {
          action?: Json
          condition?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routing_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scm_connections: {
        Row: {
          access_token: string
          avatar_url: string | null
          connected_at: string
          display_name: string | null
          id: string
          installation_id: string | null
          org_id: string
          provider: string
          provider_account_id: string
          provider_login: string
          scope: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          avatar_url?: string | null
          connected_at?: string
          display_name?: string | null
          id?: string
          installation_id?: string | null
          org_id: string
          provider: string
          provider_account_id: string
          provider_login: string
          scope?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          avatar_url?: string | null
          connected_at?: string
          display_name?: string | null
          id?: string
          installation_id?: string | null
          org_id?: string
          provider?: string
          provider_account_id?: string
          provider_login?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scm_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sdk_bypass_events: {
        Row: {
          app_name: string | null
          assigned_user_email: string | null
          environment: string | null
          git_branch: string | null
          git_commit: string | null
          id: string
          key_id: string | null
          key_name: string | null
          occurred_at: string | null
          org_id: string
          raw_module: string
        }
        Insert: {
          app_name?: string | null
          assigned_user_email?: string | null
          environment?: string | null
          git_branch?: string | null
          git_commit?: string | null
          id?: string
          key_id?: string | null
          key_name?: string | null
          occurred_at?: string | null
          org_id: string
          raw_module: string
        }
        Update: {
          app_name?: string | null
          assigned_user_email?: string | null
          environment?: string | null
          git_branch?: string | null
          git_commit?: string | null
          id?: string
          key_id?: string | null
          key_name?: string | null
          occurred_at?: string | null
          org_id?: string
          raw_module?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdk_bypass_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_installations: {
        Row: {
          bot_token: string
          bot_user_id: string
          created_at: string
          id: string
          installed_by: string | null
          org_id: string
          slack_team_id: string
          slack_team_name: string | null
        }
        Insert: {
          bot_token: string
          bot_user_id: string
          created_at?: string
          id?: string
          installed_by?: string | null
          org_id: string
          slack_team_id: string
          slack_team_name?: string | null
        }
        Update: {
          bot_token?: string
          bot_user_id?: string
          created_at?: string
          id?: string
          installed_by?: string | null
          org_id?: string
          slack_team_id?: string
          slack_team_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slack_installations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_configs: {
        Row: {
          account_id: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          domain: string
          id: string
          idp_metadata: string | null
          is_active: boolean | null
          issuer: string | null
          jackson_client_id: string | null
          provider: string
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          domain: string
          id?: string
          idp_metadata?: string | null
          is_active?: boolean | null
          issuer?: string | null
          jackson_client_id?: string | null
          provider: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          domain?: string
          id?: string
          idp_metadata?: string | null
          is_active?: boolean | null
          issuer?: string | null
          jackson_client_id?: string | null
          provider?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_configs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_cost_catalog: {
        Row: {
          created_at: string
          description: string | null
          estimated_cost_usd: number
          id: string
          org_id: string
          pattern: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimated_cost_usd: number
          id?: string
          org_id: string
          pattern: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimated_cost_usd?: number
          id?: string
          org_id?: string
          pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_cost_catalog_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      traces: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          metadata: Json | null
          org_id: string
          root_session_id: string | null
          root_span_id: string | null
          started_at: string | null
          status: string
          total_cost_usd: number | null
          trace_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          org_id: string
          root_session_id?: string | null
          root_span_id?: string | null
          started_at?: string | null
          status?: string
          total_cost_usd?: number | null
          trace_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          org_id?: string
          root_session_id?: string | null
          root_span_id?: string | null
          started_at?: string | null
          status?: string
          total_cost_usd?: number | null
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          external_job_id: string | null
          id: string
          model_base: string | null
          model_output: string | null
          name: string | null
          org_id: string
          project_id: string | null
          provider: string
          started_at: string | null
          status: string
          tokens_trained: number | null
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          external_job_id?: string | null
          id?: string
          model_base?: string | null
          model_output?: string | null
          name?: string | null
          org_id: string
          project_id?: string | null
          provider: string
          started_at?: string | null
          status?: string
          tokens_trained?: number | null
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          external_job_id?: string | null
          id?: string
          model_base?: string | null
          model_output?: string | null
          name?: string | null
          org_id?: string
          project_id?: string | null
          provider?: string
          started_at?: string | null
          status?: string
          tokens_trained?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          created_at: string
          marketing_consent: boolean
          marketing_updated_at: string | null
          tos_accepted: boolean
          tos_accepted_at: string | null
          tos_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          marketing_consent?: boolean
          marketing_updated_at?: string | null
          tos_accepted?: boolean
          tos_accepted_at?: string | null
          tos_version?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          marketing_consent?: boolean
          marketing_updated_at?: string | null
          tos_accepted?: boolean
          tos_accepted_at?: string | null
          tos_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          comment: string | null
          created_at: string
          end_user_id: string | null
          id: string
          org_id: string
          rating: number | null
          span_id: string | null
          trace_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          end_user_id?: string | null
          id?: string
          org_id: string
          rating?: number | null
          span_id?: string | null
          trace_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          end_user_id?: string | null
          id?: string
          org_id?: string
          rating?: number | null
          span_id?: string | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          active_org_id: string | null
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_org_id?: string | null
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_org_id?: string | null
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_active_org_id_fkey"
            columns: ["active_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_project: { Args: { p_project_id: string }; Returns: boolean }
      can_read_project: { Args: { p_project_id: string }; Returns: boolean }
      can_write_org: { Args: { p_org_id: string }; Returns: boolean }
      can_write_project: { Args: { p_project_id: string }; Returns: boolean }
      is_account_member: { Args: { p_account_id: string }; Returns: boolean }
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_org_owner: { Args: { p_org_id: string }; Returns: boolean }
      org_role_for: {
        Args: { p_org_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      project_role_for: {
        Args: { p_project_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      transfer_org_ownership: {
        Args: { p_current_owner: string; p_new_owner: string; p_org_id: string }
        Returns: undefined
      }
      upsert_trace_rollup: {
        Args: {
          p_cost_usd: number
          p_ended_at: string
          p_org_id: string
          p_root_session_id?: string
          p_root_span_id?: string
          p_started_at: string
          p_status: string
          p_trace_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      org_role: "owner" | "administrator" | "developer" | "read_only"
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
      org_role: ["owner", "administrator", "developer", "read_only"],
    },
  },
} as const