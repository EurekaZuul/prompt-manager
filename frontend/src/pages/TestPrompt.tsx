import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ArrowLeft, Trash2, Play, GripVertical, StopCircle, Calculator, Copy, Settings, X, Check, RefreshCw, History, Pen } from 'lucide-react';
import { apiService } from '../services/api';
import { LLMProvider, PromptTestHistory } from '../types/models';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { encode } from 'gpt-tokenizer';

interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelSettings {
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

const HISTORY_TITLE_LIMIT = 30;

const buildHistoryTitle = (
  messageList: { role: string; content?: string }[] | undefined,
  fallbackLabel?: string,
  createdAt?: string,
) => {
  if (messageList) {
    for (const entry of messageList) {
      if (entry.role === 'user') {
        const text = (entry.content || '').trim();
        if (text) {
          return text.length > HISTORY_TITLE_LIMIT ? `${text.slice(0, HISTORY_TITLE_LIMIT)}...` : text;
        }
      }
    }
  }
  const base = fallbackLabel || '测试记录';
  const timestamp = createdAt ? new Date(createdAt).toLocaleString() : new Date().toLocaleString();
  return `${base} · ${timestamp}`;
};

const buildHistoryPreview = (messageList: { role: string; content?: string }[] | undefined) => {
  if (!messageList || messageList.length === 0) {
    return '无内容';
  }
  const userMessage = messageList.find(msg => msg.role === 'user' && (msg.content || '').trim());
  const source = userMessage || messageList[0];
  const text = (source?.content || '').trim();
  if (!text) {
    return '无内容';
  }
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
};

export const TestPrompt: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    { id: 'system-1', role: 'system', content: '' },
    { id: 'user-1', role: 'user', content: '' }
  ]);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamAbort, setStreamAbort] = useState<(() => void) | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [cost, setCost] = useState(0);
  const [showCostSettings, setShowCostSettings] = useState(false);
  const [inputPrice, setInputPrice] = useState(0.002);
  const [outputPrice, setOutputPrice] = useState(0.006);
  
  // New features state
  const [variables, setVariables] = useState<string[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    model: 'qwen-turbo',
    temperature: 0.7,
    topP: 0.8,
    maxTokens: 2000
  });
  const [copied, setCopied] = useState(false);
  const [variablePrefix, setVariablePrefix] = useState('{{');
  const [variableSuffix, setVariableSuffix] = useState('}}');
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [histories, setHistories] = useState<PromptTestHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [historyMutation, setHistoryMutation] = useState<{ id: string; type: 'rename' | 'delete' } | null>(null);
  const responseRef = useRef('');
  const getHistoryTitle = (history: PromptTestHistory) =>
    (history.title && history.title.trim()) ||
    buildHistoryTitle(history.messages, history.provider_name || history.model, history.created_at);
  const getHistoryPreview = (history: PromptTestHistory) => buildHistoryPreview(history.messages);

  // Escape regex special characters
  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  useEffect(() => {
    // Extract variables from messages
    const vars = new Set<string>();
    if (!variablePrefix || !variableSuffix) return;

    try {
        const escapedPrefix = escapeRegExp(variablePrefix);
        const escapedSuffix = escapeRegExp(variableSuffix);
        const regex = new RegExp(`${escapedPrefix}\\s*(.+?)\\s*${escapedSuffix}`, 'g');

        messages.forEach(msg => {
            const matches = msg.content.match(regex);
            if (matches) {
                // match returns full match, we need to extract groups manually or use exec
                let match;
                const globalRegex = new RegExp(`${escapedPrefix}\\s*(.+?)\\s*${escapedSuffix}`, 'g');
                while ((match = globalRegex.exec(msg.content)) !== null) {
                    if (match[1]) {
                        vars.add(match[1].trim());
                    }
                }
            }
        });
        setVariables(Array.from(vars));
    } catch (e) {
        console.error('Regex error:', e);
    }
  }, [messages, variablePrefix, variableSuffix]);

  useEffect(() => {
    calculateTokens();
  }, [messages, response, inputPrice, outputPrice]);

  useEffect(() => {
    responseRef.current = response;
  }, [response]);

  const calculateTokens = () => {
    try {
      let totalTokens = 0;
      // Calculate input tokens
      messages.forEach(msg => {
        const tokens = encode(msg.content || '');
        totalTokens += tokens.length;
      });
      
      const inputTokens = totalTokens;
      
      // Calculate output tokens
      const outputTokens = encode(response || '').length;
      totalTokens += outputTokens;

      setTokenCount(totalTokens);
      
      // Calculate estimated cost
      const estimatedCost = (inputTokens / 1000 * inputPrice) + (outputTokens / 1000 * outputPrice);
      setCost(estimatedCost);
    } catch (e) {
      console.error('Token calculation error:', e);
    }
  };

  const loadPrompt = async (promptId: string) => {
    try {
      const prompt = await apiService.getPrompt(promptId);
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages[0].role === 'system') {
          newMessages[0].content = prompt.content;
        } else {
            newMessages.unshift({ id: 'system-' + Date.now(), role: 'system', content: prompt.content });
        }
        return newMessages;
      });
    } catch (error) {
      console.error('Failed to load prompt:', error);
    }
  };

  const loadTestHistories = async (promptId: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await apiService.getPromptTestHistories(promptId, { limit: 30 });
      setHistories(response.data || []);
    } catch (error) {
      console.error('Failed to load test histories:', error);
      setHistoryError('历史记录加载失败，请稍后重试');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      loadPrompt(id);
      loadTestHistories(id);
    }
  }, [id]);

  const loadProviders = async () => {
    setProviderLoading(true);
    try {
      const list = await apiService.getLLMProviders();
      setProviders(list);
      if (list.length === 0) {
        setProviderError('尚未配置任何模型，请前往系统设置。');
        setSelectedProviderId('');
      } else {
        const defaultProvider = list.find(provider => provider.is_default) || list[0];
        setSelectedProviderId(defaultProvider?.id || '');
        if (defaultProvider) {
          setModelSettings(prev => ({ ...prev, model: defaultProvider.model }));
        }
        setProviderError(null);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
      setProviderError('加载可用模型失败，请检查系统设置。');
    } finally {
      setProviderLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const normalizeHistoryMessages = (historyMessages?: PromptTestHistory['messages']): Message[] => {
    if (!historyMessages || historyMessages.length === 0) {
      const now = Date.now();
      return [
        { id: `system-${now}`, role: 'system', content: '' },
        { id: `user-${now + 1}`, role: 'user', content: '' },
      ];
    }
    const timestamp = Date.now();
    return historyMessages.map((msg, index) => {
      const role: Message['role'] = msg.role === 'system' || msg.role === 'assistant' ? msg.role : 'user';
      return {
        id: msg.id || `${role}-${timestamp + index}`,
        role,
        content: msg.content || '',
      };
    });
  };

  const handleHistorySelect = (history: PromptTestHistory) => {
    setEditingHistoryId(null);
    setEditingTitle('');
    setSelectedHistoryId(history.id);
    const normalizedMessages = normalizeHistoryMessages(history.messages);
    setMessages(normalizedMessages);
    setVariableValues(history.variable_values || {});
    setVariablePrefix(history.variable_prefix ?? variablePrefix);
    setVariableSuffix(history.variable_suffix ?? variableSuffix);
    if (typeof history.input_price === 'number') {
      setInputPrice(history.input_price);
    }
    if (typeof history.output_price === 'number') {
      setOutputPrice(history.output_price);
    }
    setSelectedProviderId(history.provider_id ?? selectedProviderId);
    setModelSettings(prev => ({
      ...prev,
      model: history.model || prev.model,
      temperature: typeof history.temperature === 'number' ? history.temperature : prev.temperature,
      topP: typeof history.top_p === 'number' ? history.top_p : prev.topP,
      maxTokens: typeof history.max_tokens === 'number' ? history.max_tokens : prev.maxTokens,
    }));
    const restoredResponse = history.response || '';
    setResponse(restoredResponse);
    responseRef.current = restoredResponse;
  };

  const handleHistoryRefresh = () => {
    if (id) {
      loadTestHistories(id);
      setEditingHistoryId(null);
      setEditingTitle('');
    }
  };

  const handleStartNewTest = () => {
    setSelectedHistoryId(null);
    setResponse('');
    responseRef.current = '';
    setEditingHistoryId(null);
    setEditingTitle('');
  };

  const startHistoryTitleEdit = (history: PromptTestHistory) => {
    setEditingHistoryId(history.id);
    setEditingTitle(history.title || '');
  };

  const cancelHistoryTitleEdit = () => {
    setEditingHistoryId(null);
    setEditingTitle('');
  };

  const handleHistoryTitleSave = async () => {
    if (!editingHistoryId) return;
    const titlePayload = editingTitle.trim();
    try {
      setHistoryMutation({ id: editingHistoryId, type: 'rename' });
      const updated = await apiService.updatePromptTestHistory(editingHistoryId, { title: titlePayload });
      setHistories(prev => prev.map(item => (item.id === updated.id ? updated : item)));
    } catch (error) {
      console.error('Failed to rename history:', error);
      alert('重命名失败，请稍后再试。');
    } finally {
      setHistoryMutation(null);
      cancelHistoryTitleEdit();
    }
  };

  const handleHistoryTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleHistoryTitleSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelHistoryTitleEdit();
    }
  };

  const handleHistoryDelete = async (history: PromptTestHistory) => {
    const confirmed = window.confirm('确定要删除这条测试历史吗？此操作无法撤销。');
    if (!confirmed) return;

    try {
      setHistoryMutation({ id: history.id, type: 'delete' });
      await apiService.deletePromptTestHistory(history.id);
      setHistories(prev => prev.filter(item => item.id !== history.id));
      if (selectedHistoryId === history.id) {
        setSelectedHistoryId(null);
        setResponse('');
        responseRef.current = '';
      }
    } catch (error) {
      console.error('Failed to delete history:', error);
      alert('删除失败，请稍后再试。');
    } finally {
      setHistoryMutation(null);
    }
  };

  const persistHistory = async (
    messagesSnapshot: Message[],
    finalResponse: string,
    metadata: {
      variableValues: Record<string, string>;
      providerId?: string;
      providerName?: string;
      modelSettings: ModelSettings;
      variablePrefix: string;
      variableSuffix: string;
      inputPrice: number;
      outputPrice: number;
    }
  ) => {
    if (!id || !finalResponse.trim()) {
      return;
    }

    try {
      let inputTokens = 0;
      messagesSnapshot.forEach(msg => {
        const tokens = encode(msg.content || '');
        inputTokens += tokens.length;
      });
      const outputTokens = encode(finalResponse || '').length;
      const totalTokens = inputTokens + outputTokens;
      const estimatedCost = (inputTokens / 1000 * metadata.inputPrice) + (outputTokens / 1000 * metadata.outputPrice);
      const generatedTitle = buildHistoryTitle(
        messagesSnapshot,
        metadata.providerName || metadata.modelSettings.model,
      );

      const payload = {
        messages: messagesSnapshot.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
        })),
        response: finalResponse,
        title: generatedTitle,
        provider_id: metadata.providerId,
        provider_name: metadata.providerName,
        model: metadata.modelSettings.model,
        temperature: metadata.modelSettings.temperature,
        top_p: metadata.modelSettings.topP,
        max_tokens: metadata.modelSettings.maxTokens,
        variable_values: Object.keys(metadata.variableValues || {}).length ? metadata.variableValues : undefined,
        variable_prefix: metadata.variablePrefix,
        variable_suffix: metadata.variableSuffix,
        token_count: totalTokens,
        cost: Number.isFinite(estimatedCost) ? estimatedCost : undefined,
        input_price: metadata.inputPrice,
        output_price: metadata.outputPrice,
      };
      const saved = await apiService.savePromptTestHistory(id, payload);
      setHistories(prev => {
        const filtered = prev.filter(item => item.id !== saved.id);
        return [saved, ...filtered].slice(0, 30);
      });
      setSelectedHistoryId(saved.id);
      setHistoryError(null);
    } catch (error) {
      console.error('Failed to save test history:', error);
    }
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    
    const items = Array.from(messages);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setMessages(items);
  };

  const updateMessage = (id: string, content: string) => {
    setMessages(messages.map(m => m.id === id ? { ...m, content } : m));
  };

  const addMessage = (role: 'user' | 'assistant') => {
    setMessages([...messages, { id: role + '-' + Date.now(), role, content: '' }]);
  };

  const removeMessage = (id: string) => {
    setMessages(messages.filter(m => m.id !== id));
  };

  const handleCopy = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleTest = async () => {
    if (loading) {
        // Stop generation
        if (streamAbort) {
            streamAbort();
            setStreamAbort(null);
        }
        setLoading(false);
        return;
    }

    if (!providerLoading && providers.length === 0) {
      alert('请先在系统设置中配置至少一个模型供应商');
      return;
    }

    const timestamp = Date.now();
    const messageSnapshot = messages.map((msg, index) => ({
      ...msg,
      id: msg.id || `${msg.role}-${timestamp + index}`,
    }));
    const variableValuesSnapshot = { ...variableValues };
    const modelSettingsSnapshot = { ...modelSettings };
    const selectedProvider = providers.find(item => item.id === selectedProviderId);
    const metadata = {
      variableValues: variableValuesSnapshot,
      providerId: selectedProviderId || undefined,
      providerName: selectedProvider?.name || selectedProvider?.model,
      modelSettings: modelSettingsSnapshot,
      variablePrefix,
      variableSuffix,
      inputPrice,
      outputPrice,
    };

    setLoading(true);
    setResponse('');
    responseRef.current = '';
    setSelectedHistoryId(null);
    
    // Replace variables
    const apiMessages = messageSnapshot.map(({ role, content }) => {
      let newContent = content;
      if (variablePrefix && variableSuffix) {
          const escapedPrefix = escapeRegExp(variablePrefix);
          const escapedSuffix = escapeRegExp(variableSuffix);
          
          variables.forEach(v => {
            try {
                const regex = new RegExp(`${escapedPrefix}\\s*${escapeRegExp(v)}\\s*${escapedSuffix}`, 'g');
                newContent = newContent.replace(regex, variableValues[v] || '');
            } catch (e) {
                console.error('Replace error:', e);
            }
          });
      }
      return { role, content: newContent };
    });
    
    // Prepare request options (passing model settings if supported by API service wrapper)
    const llmOptions = {
      providerId: selectedProviderId || undefined,
      model: modelSettings.model,
      temperature: modelSettings.temperature,
      topP: modelSettings.topP,
      maxTokens: modelSettings.maxTokens,
    };

    const abort = apiService.testPromptStream(
      apiMessages,
      (text) => {
        setResponse(prev => {
          const next = prev + text;
          responseRef.current = next;
          return next;
        });
      },
      (error) => {
        console.error('Stream error:', error);
        setLoading(false);
        setStreamAbort(null);
        alert('生成出错: ' + error);
      },
      () => {
          setLoading(false);
          setStreamAbort(null);
          void persistHistory(messageSnapshot, responseRef.current, metadata);
      },
      llmOptions
    );
    
    setStreamAbort(() => abort);
  };

  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = providers.find(item => item.id === providerId);
    if (provider) {
      setModelSettings(prev => ({ ...prev, model: provider.model }));
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <section className="flex items-center justify-between">
            <div className="flex items-center">
              <button
                onClick={() => navigate(-1)}
                className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">提示词测试</h1>
            </div>

            <section className="flex items-center space-x-4">
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 mb-1">调用模型</span>
                {providerLoading ? (
                  <span className="text-sm text-gray-400">加载中...</span>
                ) : (
                  <select
                    value={selectedProviderId}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    disabled={providers.length === 0}
                    className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:ring-indigo-500 focus:border-indigo-500 min-w-[200px] bg-white disabled:text-gray-400"
                  >
                    {providers.length === 0 ? (
                      <option value="">无可用模型</option>
                    ) : (
                      providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name || provider.model}
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              <section className="relative">
                <button
                  onClick={() => setShowModelSettings(!showModelSettings)}
                  className={`p-2 rounded-lg border transition-colors ${
                    showModelSettings
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                  title="模型设置"
                >
                  <Settings className="w-5 h-5" />
                </button>
                {showModelSettings && (
                  <div className="absolute top-full right-0 mt-2 p-4 bg-white rounded-xl shadow-xl border border-gray-100 w-72 z-20">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-sm font-bold text-gray-900">模型参数设置</h3>
                      <button onClick={() => setShowModelSettings(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">模型 (Model)</label>
                        <input
                          type="text"
                          value={modelSettings.model}
                          onChange={(e) => setModelSettings({ ...modelSettings, model: e.target.value })}
                          className="w-full text-sm border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500 mb-2"
                          placeholder="输入模型名称..."
                        />
                        <div className="flex flex-wrap gap-2">
                          {['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'].map((m) => (
                            <button
                              key={m}
                              onClick={() => setModelSettings({ ...modelSettings, model: m })}
                              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                                modelSettings.model === m
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-600 font-medium'
                                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <label className="block text-xs font-medium text-gray-700">随机性 (Temperature)</label>
                          <span className="text-xs text-gray-500">{modelSettings.temperature}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={modelSettings.temperature}
                          onChange={(e) =>
                            setModelSettings({ ...modelSettings, temperature: parseFloat(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <label className="block text-xs font-medium text-gray-700">核采样 (Top P)</label>
                          <span className="text-xs text-gray-500">{modelSettings.topP}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={modelSettings.topP}
                          onChange={(e) =>
                            setModelSettings({ ...modelSettings, topP: parseFloat(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">最大Token数</label>
                        <input
                          type="number"
                          value={modelSettings.maxTokens}
                          onChange={(e) =>
                            setModelSettings({ ...modelSettings, maxTokens: parseInt(e.target.value, 10) })
                          }
                          className="w-full text-sm border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
                {showModelSettings && <div className="fixed inset-0 z-10" onClick={() => setShowModelSettings(false)} />}
              </section>

              <div className="relative">
                <button
                  onClick={() => setShowCostSettings(!showCostSettings)}
                  className="flex flex-col items-end px-3 py-1 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors cursor-pointer"
                  title="点击设置模型单价"
                >
                  <div className="flex items-center text-xs text-gray-500 space-x-2">
                    <Calculator className="w-3 h-3" />
                    <span>Tokens: {tokenCount}</span>
                  </div>
                  <div className="text-xs font-medium text-gray-700">≈ ¥{cost.toFixed(5)}</div>
                </button>

                {showCostSettings && (
                  <div className="absolute top-full right-0 mt-2 p-4 bg-white rounded-xl shadow-xl border border-gray-100 w-64 z-20">
                    <h3 className="text-sm font-bold text-gray-900 mb-3">模型价格设置 (每1k tokens)</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">输入价格 (Input)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">¥</span>
                          <input
                            type="number"
                            step="0.001"
                            value={inputPrice}
                            onChange={(e) => setInputPrice(parseFloat(e.target.value) || 0)}
                            className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">输出价格 (Output)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">¥</span>
                          <input
                            type="number"
                            step="0.001"
                            value={outputPrice}
                            onChange={(e) => setOutputPrice(parseFloat(e.target.value) || 0)}
                            className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 text-center">点击外部关闭设置</div>
                  </div>
                )}
                {showCostSettings && <div className="fixed inset-0 z-10" onClick={() => setShowCostSettings(false)} />}
              </div>

              <button
                onClick={handleTest}
                className={`px-4 py-2 rounded-lg flex items-center font-medium transition-all ${
                  loading
                    ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow-md'
                }`}
              >
                {loading ? (
                  <>
                    <StopCircle className="w-4 h-4 mr-2" />
                    停止生成
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    开始测试
                  </>
                )}
              </button>
            </section>
          </section>
          {providerError && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
              {providerError}
            </div>
          )}
        </section>
      </header>

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full lg:w-80 flex-shrink-0 flex flex-col lg:h-[calc(100vh-140px)]">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div>
                <div className="flex items-center text-gray-800 font-semibold">
                  <History className="w-4 h-4 mr-2 text-indigo-500" />
                  测试历史
                </div>
                <p className="text-xs text-gray-500 mt-1">自动保存最近的测试会话，点击即可回放</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleHistoryRefresh}
                  className="p-2 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
                  title="刷新历史"
                >
                  <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleStartNewTest}
                  className="px-3 py-1.5 text-sm rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  新测试
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center p-6 text-sm text-gray-500">
                  加载历史记录...
                </div>
              ) : histories.length === 0 ? (
                <div className="p-6 text-sm text-gray-400 text-center">
                  暂无测试历史，完成一次测试后会自动保存。
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {histories.map(history => {
                    const title = getHistoryTitle(history);
                    const preview = getHistoryPreview(history);
                    const isSelected = selectedHistoryId === history.id;
                    const isEditing = editingHistoryId === history.id;
                    const mutation = historyMutation?.id === history.id ? historyMutation : null;
                    const isRenaming = mutation?.type === 'rename';
                    const isDeleting = mutation?.type === 'delete';
                    return (
                      <div
                        key={history.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleHistorySelect(history)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleHistorySelect(history);
                          }
                        }}
                        className={`group px-4 py-3 transition-colors cursor-pointer ${
                          isSelected ? 'bg-indigo-50 border-l-4 border-indigo-400' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          {isEditing ? (
                            <div
                              className="flex items-center w-full space-x-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                value={editingTitle}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onKeyDown={handleHistoryTitleKeyDown}
                                className="flex-1 text-sm border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder="输入标题"
                                autoFocus
                              />
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleHistoryTitleSave();
                                }}
                                className="p-1.5 rounded-md bg-green-50 text-green-600 hover:bg-green-100"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  cancelHistoryTitleEdit();
                                }}
                                className="p-1.5 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1">
                              <div className="font-medium text-sm text-gray-900 line-clamp-2">{title}</div>
                              <div className="text-[11px] text-gray-500 mt-1">
                                {(history.provider_name || '默认模型')} · {(history.model || '未指定模型')}
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {new Date(history.created_at).toLocaleString()}
                              </div>
                            </div>
                          )}
                          {!isEditing && (
                            <div className="flex flex-col items-end space-y-1">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startHistoryTitleEdit(history);
                                }}
                                className="p-1 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                                title="重命名"
                                disabled={isDeleting}
                              >
                                <Pen className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleHistoryDelete(history);
                                }}
                                className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                                title="删除记录"
                                disabled={isRenaming || isDeleting}
                              >
                                {isDeleting ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                        {!isEditing && (
                          <>
                            <div className="text-xs text-gray-500 mt-2 line-clamp-2">
                              {preview}
                            </div>
                            <div className="flex items-center text-[11px] text-gray-400 mt-2 space-x-4">
                              <span>消息 {history.messages?.length || 0}</span>
                              {typeof history.token_count === 'number' && (
                                <span>Tokens {history.token_count}</span>
                              )}
                              {typeof history.cost === 'number' && (
                                <span>≈ ¥{history.cost.toFixed(4)}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {historyError && (
              <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">
                {historyError}
              </div>
            )}
          </div>
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-140px)]">
          {/* Left Column: Chat Config */}
          <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h2 className="font-semibold text-gray-700">对话消息配置</h2>
              <div className="space-x-2">
                <button 
                    onClick={() => addMessage('user')}
                    className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                >
                    + 用户
                </button>
                <button 
                    onClick={() => addMessage('assistant')}
                    className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                >
                    + 助手
                </button>
              </div>
            </div>
            
            {/* Variables Section */}
            {(variables.length > 0 || true) && (
                <div className="p-4 border-b border-gray-100 bg-yellow-50/30">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mr-2"></span>
                            变量设置
                        </h3>
                        <div className="flex items-center space-x-2">
                            <span className="text-xs text-gray-500">变量格式:</span>
                            <div className="flex items-center space-x-1">
                                <input 
                                    type="text" 
                                    value={variablePrefix}
                                    onChange={(e) => setVariablePrefix(e.target.value)}
                                    className="w-12 text-xs border-gray-200 rounded py-0.5 px-1 text-center focus:ring-yellow-400 focus:border-yellow-400"
                                    placeholder="前缀"
                                />
                                <span className="text-xs text-gray-400">变量名</span>
                                <input 
                                    type="text" 
                                    value={variableSuffix}
                                    onChange={(e) => setVariableSuffix(e.target.value)}
                                    className="w-12 text-xs border-gray-200 rounded py-0.5 px-1 text-center focus:ring-yellow-400 focus:border-yellow-400"
                                    placeholder="后缀"
                                />
                            </div>
                        </div>
                    </div>
                    {variables.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3">
                            {variables.map(v => (
                                <div key={v} className="flex items-center space-x-2">
                                    <label className="text-xs font-medium text-gray-600 min-w-[60px] text-right truncate" title={v}>{v}:</label>
                                    <input
                                        type="text"
                                        value={variableValues[v] || ''}
                                        onChange={(e) => setVariableValues({...variableValues, [v]: e.target.value})}
                                        placeholder={`输入 ${variablePrefix}${v}${variableSuffix} 的值...`}
                                        className="flex-1 text-sm border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1.5"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-gray-400 text-center py-2">
                            未检测到变量。尝试在提示词中使用 {variablePrefix}变量名{variableSuffix}
                        </div>
                    )}
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="messages">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="space-y-4"
                    >
                      {messages.map((msg, index) => (
                        <Draggable key={msg.id} draggableId={msg.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`bg-white border rounded-lg p-3 transition-shadow ${
                                snapshot.isDragging ? 'shadow-lg border-indigo-300 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <div {...provided.dragHandleProps} className="cursor-grab text-gray-400 hover:text-gray-600">
                                    <GripVertical className="w-4 h-4" />
                                  </div>
                                  <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                                    msg.role === 'system' ? 'bg-purple-100 text-purple-700' :
                                    msg.role === 'user' ? 'bg-blue-100 text-blue-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>
                                    {msg.role}
                                  </span>
                                </div>
                                <button
                                  onClick={() => removeMessage(msg.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors"
                                  title="删除消息"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <textarea
                                value={msg.content}
                                onChange={(e) => updateMessage(msg.id, e.target.value)}
                                placeholder={`输入${msg.role === 'system' ? '系统提示词' : msg.role === 'user' ? '用户消息' : '助手消息'}...`}
                                className="w-full text-sm border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500 min-h-[80px] resize-y"
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          {/* Right Column: Response */}
          <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h2 className="font-semibold text-gray-700">模型响应</h2>
              <button
                onClick={handleCopy}
                disabled={!response}
                className={`p-1.5 rounded-md transition-all ${
                    copied 
                        ? 'bg-green-100 text-green-600' 
                        : 'hover:bg-gray-200 text-gray-500'
                } ${!response ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="复制响应"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white">
              {response ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                        code({node, inline, className, children, ...props}: any) {
                            return !inline ? (
                                <pre className="bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto my-4">
                                    <code {...props} className={className}>
                                        {children}
                                    </code>
                                </pre>
                            ) : (
                                <code {...props} className="bg-gray-100 text-red-500 px-1 py-0.5 rounded text-sm font-mono">
                                    {children}
                                </code>
                            )
                        }
                    }}
                  >
                    {response}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  {loading ? (
                    <div className="flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
                        <p>正在生成响应...</p>
                    </div>
                  ) : (
                    <>
                      <Play className="w-12 h-12 mb-2 opacity-20" />
                      <p>点击"开始测试"查看效果</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
);
};
