import React, { useState, useEffect } from 'react';
import { Save, ArrowLeft, Settings as SettingsIcon, Plus, Trash2, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { LLMProvider } from '../types/models';

const createEmptyProvider = (isDefault = false): LLMProvider => ({
  id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `provider-${Date.now()}`,
  name: '',
  provider: 'custom',
  api_key: '',
  api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  model: '',
  system_prompt: '',
  is_default: isDefault,
});

const normalizeProviders = (providers: LLMProvider[]): LLMProvider[] => {
  if (providers.length === 0) return providers;
  let defaultAssigned = false;
  return providers.map((provider, index) => {
    if (provider.is_default) {
      if (defaultAssigned) {
        return { ...provider, is_default: false };
      }
      defaultAssigned = true;
      return provider;
    }
    if (!defaultAssigned && index === 0) {
      defaultAssigned = true;
      return { ...provider, is_default: true };
    }
    return provider;
  });
};

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const result = await apiService.getLLMProviders();
      if (result.length === 0) {
        setProviders([createEmptyProvider(true)]);
      } else {
        setProviders(result);
      }
      setError(null);
    } catch (err) {
      console.error('Failed to load providers:', err);
      setError('加载模型配置失败，请检查后端服务。');
      setProviders([createEmptyProvider(true)]);
    } finally {
      setLoading(false);
    }
  };

  const updateProviderField = (id: string, field: keyof LLMProvider, value: string | boolean) => {
    setProviders(prev =>
      prev.map(provider => (provider.id === id ? { ...provider, [field]: value } : provider))
    );
  };

  const handleSetDefault = (id: string) => {
    setProviders(prev =>
      prev.map(provider => ({
        ...provider,
        is_default: provider.id === id,
      }))
    );
  };

  const handleRemoveProvider = (id: string) => {
    setProviders(prev => {
      const filtered = prev.filter(provider => provider.id !== id);
      if (filtered.length === 0) {
        return [createEmptyProvider(true)];
      }
      if (!filtered.some(provider => provider.is_default)) {
        return filtered.map((provider, index) => (index === 0 ? { ...provider, is_default: true } : provider));
      }
      return filtered;
    });
  };

  const handleAddProvider = () => {
    setProviders(prev => [
      ...prev,
      createEmptyProvider(prev.length === 0),
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (providers.some(provider => !provider.name.trim() || !provider.api_key.trim() || !provider.model.trim())) {
      alert('请为每个模型填写名称、API Key 和模型名称。');
      return;
    }

    const normalized = normalizeProviders(providers);
    setSaving(true);
    try {
      await apiService.saveLLMProviders(normalized);
      setProviders(normalized);
      alert('设置已保存');
    } catch (err) {
      console.error('Failed to save providers:', err);
      alert('保存设置失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center text-gray-300 hover:text-white transition-colors mb-6 group"
          >
            <ArrowLeft className="w-5 h-5 mr-2 transform group-hover:-translate-x-1 transition-transform" />
            返回首页
          </button>
          
          <div className="flex items-center mb-2">
            <div className="p-2 bg-white/10 rounded-lg mr-3 backdrop-blur-sm">
              <SettingsIcon className="w-6 h-6 text-gray-300" />
            </div>
            <h1 className="text-3xl font-bold">系统设置</h1>
          </div>
          <p className="text-gray-400 max-w-2xl text-lg leading-relaxed ml-12">
            配置全局系统参数和第三方服务集成。
          </p>
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-16 w-full pb-12">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-600"></div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">大模型供应商配置</h2>
                <button
                  type="button"
                  onClick={handleAddProvider}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100 hover:bg-indigo-100 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  新增模型
                </button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                {providers.map((provider, index) => (
                  <div key={provider.id} className="border border-gray-200 rounded-xl p-6 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-4">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wide">模型 #{index + 1}</p>
                        <div className="flex items-center space-x-2 mt-1">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {provider.name || '未命名模型'}
                          </h3>
                          {provider.is_default && (
                            <span className="inline-flex items-center text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">
                              <Star className="w-3 h-3 mr-1" />
                              默认
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleSetDefault(provider.id)}
                          className={`inline-flex items-center px-3 py-1.5 rounded-md text-sm border transition-colors ${
                            provider.is_default
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <Star className="w-4 h-4 mr-1" />
                          设为默认
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveProvider(provider.id)}
                          disabled={providers.length === 1}
                          className="inline-flex items-center px-3 py-1.5 rounded-md text-sm border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          删除
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">显示名称</label>
                        <input
                          type="text"
                          value={provider.name}
                          onChange={(e) => updateProviderField(provider.id, 'name', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="例如：阿里云·通义千问 Turbo"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">厂商/来源</label>
                        <input
                          type="text"
                          value={provider.provider}
                          onChange={(e) => updateProviderField(provider.id, 'provider', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="aliyun / openai / deepseek..."
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          API URL (OpenAI 兼容接口地址)
                        </label>
                        <input
                          type="text"
                          value={provider.api_url || ''}
                          onChange={(e) => updateProviderField(provider.id, 'api_url', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          对接 OpenAI 兼容协议的地址，末尾带 /chat/completions（若留空则采用厂商默认值）。
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                        <input
                          type="password"
                          value={provider.api_key}
                          onChange={(e) => updateProviderField(provider.id, 'api_key', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="sk-..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">默认模型名称</label>
                        <input
                          type="text"
                          value={provider.model}
                          onChange={(e) => updateProviderField(provider.id, 'model', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="例如：qwen-turbo / gpt-4o-mini"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          默认优化 System Prompt（可选）
                        </label>
                        <textarea
                          rows={4}
                          value={provider.system_prompt || ''}
                          onChange={(e) => updateProviderField(provider.id, 'system_prompt', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="用于提示词优化、作为系统角色指令"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <p className="text-sm text-gray-500">
                  默认模型将用于提示词优化与测试，具体操作仍可在功能页选择不同模型。
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm hover:shadow transition-all disabled:opacity-50"
                >
                  <Save className="w-5 h-5 mr-2" />
                  {saving ? '保存中...' : '保存设置'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
