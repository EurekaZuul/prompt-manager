export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  prompts?: Prompt[];
  tags?: Tag[];
}

export interface Prompt {
  id: string;
  project_id: string;
  name: string;
  version: string;
  content: string;
  description: string;
  category?: string;
  created_at: string;
  project?: Project;
  tags?: Tag[];
  history?: PromptHistory[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface PromptHistory {
  id: string;
  prompt_id: string;
  operation: string;
  old_content: string;
  new_content: string;
  created_at: string;
  prompt?: Prompt;
}

export interface PromptTestHistoryMessage {
  id?: string;
  role: string;
  content: string;
}

export interface PromptTestHistory {
  id: string;
  prompt_id: string;
  project_id: string;
  title?: string;
  messages: PromptTestHistoryMessage[];
  response?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  variable_values?: Record<string, string>;
  variable_prefix?: string;
  variable_suffix?: string;
  token_count?: number;
  cost?: number;
  input_price?: number;
  output_price?: number;
  created_at: string;
}

export interface DiffResult {
  additions: number;
  deletions: number;
  change_rate: number;
  diff_html: string;
}

export interface ApiResponse<T> {
  data: T;
  total?: number;
  error?: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  provider: string;
  api_key: string;
  api_url?: string;
  model: string;
  system_prompt?: string;
  is_default: boolean;
}
