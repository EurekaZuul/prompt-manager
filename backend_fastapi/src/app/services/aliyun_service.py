from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, Iterable, List

import httpx

DEFAULT_SYSTEM_PROMPT = """
# 提示词优化专家系统提示词

你是一位专业的AI提示词优化专家,擅长将用户的模糊需求转化为清晰、有效的提示词。你的目标是帮助用户获得更好的AI交互体验。

## 核心职责

1. **理解用户意图**:深入分析用户的真实需求,识别其目标、约束条件和期望输出
2. **优化提示词结构**:重构提示词使其更清晰、具体、易于AI理解
3. **提供专业建议**:基于最佳实践给出改进方案

## 优化原则

### 1. 清晰性原则
- 使用明确、具体的语言,避免模糊表达
- 将复杂任务分解为清晰的步骤
- 明确指定输出格式和要求

### 2. 上下文完整性
- 提供充足的背景信息
- 说明任务目标和使用场景
- 包含必要的约束条件和限制

### 3. 结构化原则
- 使用合理的层次结构组织信息
- 采用标题、列表等格式提高可读性
- 将指令、示例、约束分开表述

### 4. 示例驱动
- 在适当时提供正面和负面示例
- 用具体案例说明期望的输出风格
- 展示边界情况的处理方式

### 5. 角色定位
- 明确AI应扮演的角色或身份
- 说明所需的专业水平和语气风格
- 定义与用户的交互方式

## 优化流程

当用户提供一个提示词时,按以下步骤处理:

### 步骤1:分析原提示词
- 识别用户的核心需求
- 发现模糊或不清晰的部分
- 找出缺失的关键信息

### 步骤2:提出优化方案
提供优化后的提示词,包含:
- **角色定义**:明确AI的身份和专业领域
- **任务描述**:清晰说明要完成的任务
- **输出要求**:具体的格式、长度、风格要求
- **约束条件**:限制、禁止事项或特殊注意点
- **示例**(如需要):展示期望的输出样式

### 步骤3:说明改进要点
简要解释:
- 做了哪些关键改进
- 为什么这些改进能提升效果
- 可能还需要补充的信息

## 输出格式

**📋 原提示词分析**
[简要分析原提示词的优缺点]

**✨ 优化后的提示词**
```
[完整的优化后提示词]
```
**💡 改进要点**
[列出3-5个关键改进点及理由]

**🎯 使用建议**
[提供使用该提示词的注意事项或调整方向]

## 注意事项

- 保持原提示词的核心意图不变
- 优化应基于实际需求,不过度复杂化
- 如果原提示词信息不足,主动询问补充细节
- 根据不同的AI模型特点调整优化策略
- 尊重用户的语言习惯和表达风格

## 交互风格

- 专业但易懂,避免过多术语
- 提供可操作的具体建议
- 鼓励迭代改进,欢迎用户反馈
- 必要时询问澄清性问题

现在,请告诉我你想优化的提示词,我将为你提供专业的改进方案。
""".strip()


def normalize_api_url(url: str | None) -> str:
    if not url:
        return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    url = url.rstrip("/")
    if url.endswith("/chat/completions"):
        return url
    return f"{url}/chat/completions"


@dataclass(slots=True)
class ChatOptions:
    model: str
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None


Message = Dict[str, str]


async def call_aliyun(
    api_key: str,
    api_url: str | None,
    model: str,
    system_prompt: str | None,
    user_prompt: str,
) -> str:
    messages: List[Message] = []
    messages.append({"role": "system", "content": system_prompt or DEFAULT_SYSTEM_PROMPT})
    messages.append({"role": "user", "content": user_prompt})
    options = ChatOptions(model=model)
    return await call_aliyun_chat(api_key, api_url, options, messages)


async def call_aliyun_chat(
    api_key: str,
    api_url: str | None,
    options: ChatOptions,
    messages: Iterable[Message],
) -> str:
    payload = _build_payload(options, messages, stream=False)
    response = await _post(api_key, api_url, payload)
    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError("Malformed response from Aliyun") from exc

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("Empty response from Aliyun")
    return choices[0].get("message", {}).get("content", "")


async def call_aliyun_stream(
    api_key: str,
    api_url: str | None,
    model: str,
    system_prompt: str | None,
    user_prompt: str,
) -> AsyncGenerator[str, None]:
    messages: List[Message] = [
        {"role": "system", "content": system_prompt or DEFAULT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    async for chunk in call_aliyun_chat_stream(api_key, api_url, ChatOptions(model=model), messages):
        yield chunk


async def call_aliyun_chat_stream(
    api_key: str,
    api_url: str | None,
    options: ChatOptions,
    messages: Iterable[Message],
) -> AsyncGenerator[str, None]:
    payload = _build_payload(options, messages, stream=True)
    async for data in _post_stream(api_key, api_url, payload):
        if data == "[DONE]":
            break
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            yield data
            continue
        for choice in parsed.get("choices", []):
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if content:
                yield content


def _build_payload(options: ChatOptions, messages: Iterable[Message], stream: bool) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": options.model or "qwen-turbo",
        "messages": list(messages),
        "stream": stream,
    }
    if options.temperature is not None:
        payload["temperature"] = options.temperature
    if options.top_p is not None:
        payload["top_p"] = options.top_p
    if options.max_tokens is not None:
        payload["max_tokens"] = options.max_tokens
    return payload


async def _post(api_key: str, api_url: str | None, payload: Dict[str, Any]) -> httpx.Response:
    url = normalize_api_url(api_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=None) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response


async def _post_stream(
    api_key: str,
    api_url: str | None,
    payload: Dict[str, Any],
) -> AsyncGenerator[str, None]:
    url = normalize_api_url(api_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    yield line[5:].strip()
