import { Project, Prompt, Tag, ApiResponse, DiffResult, LLMProvider } from '../types/models';

interface Env {
  API_URL: string;
}

declare global {
  interface Window {
    ENV: Env;
  }
}

const apiOrigin = (window.ENV?.API_URL || window.location.origin || '').replace(/\/$/, '');
const API_BASE_URL = `${apiOrigin || ''}/api`;

export interface LLMRequestOptions {
  providerId?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

class ApiService {
  private buildLLMPayload(options?: LLMRequestOptions): Record<string, unknown> {
    if (!options) return {};
    const payload: Record<string, unknown> = {};
    if (options.providerId) payload.provider_id = options.providerId;
    if (options.model) payload.model = options.model;
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;
    if (typeof options.topP === 'number') payload.top_p = options.topP;
    if (typeof options.maxTokens === 'number') payload.max_tokens = options.maxTokens;
    return payload;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
  }

  // 设置管理
  async getSettings(): Promise<Record<string, string>> {
    return this.request<Record<string, string>>('/settings');
  }

  async updateSettings(settings: Record<string, string>): Promise<void> {
    return this.request<void>('/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  private async buildLegacyProvidersFromSettings(): Promise<LLMProvider[]> {
    const settings = await this.getSettings();
    if (settings.llm_providers) {
      try {
        const parsed = JSON.parse(settings.llm_providers);
        if (Array.isArray(parsed)) {
          return parsed as LLMProvider[];
        }
      } catch (_err) {
        console.warn('Failed to parse llm_providers from settings, falling back to Aliyun config');
      }
    }

    const apiKey = settings.aliyun_api_key || '';
    if (!apiKey) {
      return [];
    }
    return [
      {
        id: settings.aliyun_provider_id || 'aliyun-default',
        name: settings.aliyun_display_name || '阿里云默认模型',
        provider: 'aliyun',
        api_key: apiKey,
        api_url: settings.aliyun_api_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: settings.aliyun_model || 'qwen-turbo',
        system_prompt: settings.aliyun_system_prompt || '',
        is_default: true,
      },
    ];
  }

  async getLLMProviders(): Promise<LLMProvider[]> {
    const url = `${API_BASE_URL}/llm-providers`;
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (response.ok) {
      return response.json();
    }
    if (response.status === 404) {
      return this.buildLegacyProvidersFromSettings();
    }
    throw new Error(`API request failed: ${response.statusText}`);
  }

  async saveLLMProviders(providers: LLMProvider[]): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/llm-providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providers }),
    });
    if (response.ok) {
      return;
    }
    if (response.status === 404) {
      return this.updateSettings({
        llm_providers: JSON.stringify(providers),
      });
    }
    throw new Error(`API request failed: ${response.statusText}`);
  }

  async optimizePrompt(prompt: string, options?: LLMRequestOptions): Promise<{ optimized_prompt: string }> {
    return this.request<{ optimized_prompt: string }>('/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt, ...this.buildLLMPayload(options) }),
    });
  }

  async testPrompt(messages: { role: string; content: string }[], options?: LLMRequestOptions): Promise<{ response: string }> {
    return this.request<{ response: string }>('/test-prompt', {
      method: 'POST',
      body: JSON.stringify({ messages, ...this.buildLLMPayload(options) }),
    });
  }

  testPromptStream(messages: { role: string; content: string }[], onData: (text: string) => void, onError: (error: string) => void, onComplete?: () => void, options?: LLMRequestOptions): () => void {
    const controller = new AbortController();
    const signal = controller.signal;

    fetch(`${API_BASE_URL}/test-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, stream: true, ...this.buildLLMPayload(options) }),
      signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.startsWith('data:')) {
              try {
                 const data = trimmedLine.substring(5);
                 let content = data;
                 if (content.startsWith(' ')) {
                   content = content.substring(1);
                 }
                 
                 if (content) {
                    try {
                      const json = JSON.parse(content);
                      if (json && typeof json === 'object' && 'text' in json) {
                        onData(json.text);
                        continue;
                      }
                    } catch (e) {
                      // Not JSON, fall back to raw text
                    }
                    onData(content);
                 }
              } catch (e) {
                console.error('Error parsing SSE data:', e);
              }
            }
          }
        }
        if (onComplete) onComplete();
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          console.log('Stream aborted');
        } else {
          onError(err.message);
        }
      });

    return () => controller.abort();
  }

  optimizePromptStream(prompt: string, onData: (text: string) => void, onError: (error: string) => void, onComplete?: () => void, options?: LLMRequestOptions): () => void {
    const controller = new AbortController();
    const signal = controller.signal;

    fetch(`${API_BASE_URL}/optimize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, stream: true, ...this.buildLLMPayload(options) }),
      signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            // Trim whitespace to handle various newline formats
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.startsWith('data:')) {
              try {
                 // In standard SSE, it's "data: <content>\n\n"
                 // Gin SSEvent sends: "event:message\ndata:<content>\n\n"
                 
                 // Get the data content part
                 const data = trimmedLine.substring(5);
                 
                 let content = data;
                 // Handle optional space after colon
                 if (content.startsWith(' ')) {
                   content = content.substring(1);
                 }
                 
                 if (content) {
                    // Try to parse as JSON first (new format)
                    try {
                      const json = JSON.parse(content);
                      if (json && typeof json === 'object' && 'text' in json) {
                        onData(json.text);
                        continue;
                      }
                    } catch (e) {
                      // Not JSON, fall back to raw text (legacy format)
                    }
                    
                    // Fallback for non-JSON data (legacy or direct text)
                    onData(content);
                 }
              } catch (e) {
                console.error('Error parsing SSE data:', e);
              }
            } else if (trimmedLine.startsWith('event:error')) {
               // Next line should be data: <error message>
               // But we handle it in the loop
            }
          }
        }
        if (onComplete) onComplete();
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          console.log('Stream aborted');
        } else {
          onError(err.message);
        }
      });

    return () => controller.abort();
  }

  // 项目管理
  async getProjects(search?: string): Promise<ApiResponse<Project[]>> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    
    return this.request<ApiResponse<Project[]>>(`/projects?${params}`);
  }

  async getProject(id: string): Promise<Project> {
    return this.request<Project>(`/projects/${id}`);
  }

  async createProject(data: { name: string; description?: string }): Promise<Project> {
    return this.request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: string, data: { name?: string; description?: string }): Promise<Project> {
    return this.request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string): Promise<void> {
    return this.request<void>(`/projects/${id}`, {
      method: 'DELETE',
    });
  }

  // 提示词管理
  async getPrompts(projectId: string, params?: {
    tag?: string;
    version?: string;
    name?: string;
    category?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<ApiResponse<Prompt[]>> {
    const queryParams = new URLSearchParams();
    if (params?.tag) queryParams.append('tag', params.tag);
    if (params?.version) queryParams.append('version', params.version);
    if (params?.name) queryParams.append('name', params.name);
    if (params?.category) queryParams.append('category', params.category);
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);

    return this.request<ApiResponse<Prompt[]>>(`/projects/${projectId}/prompts?${queryParams}`);
  }

  async getPrompt(id: string): Promise<Prompt> {
    return this.request<Prompt>(`/prompts/${id}`);
  }

  async createPrompt(projectId: string, data: {
    name: string;
    content: string;
    tag_ids?: string[];
    category?: string;
    description?: string;
  }): Promise<Prompt> {
    return this.request<Prompt>(`/projects/${projectId}/prompts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePrompt(id: string, data: {
    content?: string;
    description?: string;
    category?: string;
    tag_ids?: string[];
    bump?: 'major' | 'minor' | 'patch' | 'none';
  }): Promise<Prompt> {
    return this.request<Prompt>(`/prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePrompt(id: string): Promise<void> {
    return this.request<void>(`/prompts/${id}`, {
      method: 'DELETE',
    });
  }

  async getPromptDiff(id: string, targetId: string): Promise<{
    source_version: string;
    target_version: string;
    diff: DiffResult;
  }> {
    return this.request(`/prompts/${id}/diff/${targetId}`);
  }

  async rollbackPrompt(id: string): Promise<Prompt> {
    return this.request<Prompt>(`/prompts/${id}/rollback`, {
      method: 'POST',
    });
  }

  // 标签管理
  async getTags(): Promise<ApiResponse<Tag[]>> {
    return this.request<ApiResponse<Tag[]>>('/tags');
  }

  async createTag(data: { name: string; color?: string }): Promise<Tag> {
    return this.request<Tag>('/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTag(id: string, data: { name?: string; color?: string }): Promise<Tag> {
    return this.request<Tag>(`/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTag(id: string): Promise<void> {
    return this.request<void>(`/tags/${id}`, {
      method: 'DELETE',
    });
  }

  // 分类管理
  async getCategories(): Promise<ApiResponse<{ id: string; name: string; color: string; created_at: string }[]>> {
    return this.request<ApiResponse<{ id: string; name: string; color: string; created_at: string }[]>>('/categories');
  }
  async createCategory(data: { name: string; color?: string }): Promise<{ id: string; name: string; color: string; created_at: string }> {
    return this.request<{ id: string; name: string; color: string; created_at: string }>(`/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async updateCategory(id: string, data: { name?: string; color?: string }): Promise<{ id: string; name: string; color: string; created_at: string }> {
    return this.request<{ id: string; name: string; color: string; created_at: string }>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  async deleteCategory(id: string): Promise<void> {
    return this.request<void>(`/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // 导入导出
  async exportData(projectIds: string[], format: 'json' | 'csv'): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_ids: projectIds, format }),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  async exportProject(projectId: string, format: 'json' | 'csv' | 'yaml'): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_ids: [projectId], format }),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  async importData(file: File, format: 'json' | 'csv'): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', format);

    const response = await fetch(`${API_BASE_URL}/import`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `Import failed: ${response.statusText}`);
      } catch (e) {
        throw new Error(`Import failed: ${response.statusText}`);
      }
    }
    
    return response.json();
  }
}

export const apiService = new ApiService();
