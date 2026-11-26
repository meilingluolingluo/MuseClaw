#!/usr/bin/env node

// src/cli.ts
import { execSync as execSync2 } from "node:child_process";
import { existsSync as existsSync6, mkdirSync, readFileSync as readFileSync5, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import os2, { homedir as homedir6, hostname } from "node:os";
import path2, { join as join6 } from "node:path";
import WebSocket from "ws";

// ../../packages/sandbox-core/src/vision.ts
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var NO_IMAGES_REGEX = /image|vision|multimodal|multi-modal|image_url|input_image|content must be a string|invalid type for 'messages\[\d+\]\.content'|unsupported content|does not support|not supported/i;
function saysNoImages(message) {
  return NO_IMAGES_REGEX.test(message || "");
}
function withoutImages(messages) {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const textParts = msg.content.filter((p) => p.type === "text").map((p) => p.text);
    const imageCount = msg.content.filter((p) => p.type === "image_url").length;
    const note = imageCount > 0 ? ` [\u5305\u542B ${imageCount} \u5F20\u56FE\u7247\u9644\u4EF6]` : "";
    return {
      ...msg,
      content: (textParts.join("\n") + note).trim()
    };
  });
}

// ../../packages/sandbox-core/src/vault.ts
var CredentialVault = class {
  secrets = /* @__PURE__ */ new Map();
  minRedactLength = 4;
  constructor() {
    this.initFromEnv();
  }
  /**
   * 从当前进程环境变量中自动探测并纳管敏感凭据
   */
  initFromEnv(env = process.env) {
    const sensitiveKeyPatterns = [
      "KEY",
      "SECRET",
      "PASSWORD",
      "TOKEN",
      "PASS",
      "CREDENTIAL",
      "PRIVATE",
      "AUTH"
    ];
    for (const [key, value] of Object.entries(env)) {
      if (!value || typeof value !== "string") continue;
      const keyUpper = key.toUpperCase();
      const isSensitive = sensitiveKeyPatterns.some((pattern) => keyUpper.includes(pattern));
      if (isSensitive && value.length >= this.minRedactLength && value !== "true" && value !== "false") {
        this.set(key, value);
      }
    }
  }
  set(name, value) {
    if (!name || !value) return;
    this.secrets.set(name, value);
  }
  get(name) {
    return this.secrets.get(name);
  }
  has(name) {
    return this.secrets.has(name);
  }
  delete(name) {
    return this.secrets.delete(name);
  }
  names() {
    return Array.from(this.secrets.keys());
  }
  /**
   * 将参数中的占位符 {{vault:NAME}} 还原为真实的凭据明文
   */
  resolve(input) {
    if (typeof input === "string") {
      return input.replace(/\{\{\s*vault:([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
        const val = this.get(key);
        return val !== void 0 ? val : match;
      });
    }
    if (Array.isArray(input)) {
      return input.map((item) => this.resolve(item));
    }
    if (input !== null && typeof input === "object") {
      const result = {};
      for (const [k, v] of Object.entries(input)) {
        result[k] = this.resolve(v);
      }
      return result;
    }
    return input;
  }
  /**
   * 将字符串中的真实敏感明文打码脱敏为 [REDACTED:KEY_NAME]
   * 采用“最长优先”排序替换，防止子串破坏外层凭据
   */
  redact(text) {
    if (!text || typeof text !== "string") return text;
    let sanitized = text;
    const sortedEntries = Array.from(this.secrets.entries()).filter(([_, val]) => val && val.length >= this.minRedactLength).sort((a, b) => b[1].length - a[1].length);
    for (const [key, val] of sortedEntries) {
      if (!val) continue;
      const escapedVal = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedVal, "g");
      sanitized = sanitized.replace(regex, `[REDACTED:${key}]`);
    }
    return sanitized;
  }
  /**
   * 将输入文本中的真实敏感明文转换为安全占位符 {{vault:KEY_NAME}}
   * 便于提供给 LLM 提示词上下文，使 LLM 能引用占位符而不知晓真实明文
   */
  maskToPlaceholder(text) {
    if (!text || typeof text !== "string") return text;
    let masked = text;
    const sortedEntries = Array.from(this.secrets.entries()).filter(([_, val]) => val && val.length >= this.minRedactLength).sort((a, b) => b[1].length - a[1].length);
    for (const [key, val] of sortedEntries) {
      if (!val) continue;
      const escapedVal = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedVal, "g");
      masked = masked.replace(regex, `{{vault:${key}}}`);
    }
    return masked;
  }
};
var defaultVault = new CredentialVault();

// ../../packages/sandbox-core/src/widget-validator.ts
var MAX_HTML_BYTES = 512 * 1024;

// ../../packages/sandbox-core/src/llm.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function normalizeChatCompletionsUrl(url) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/chat/completions`;
  }
  if (clean.includes(":11434") && !clean.includes("/v1")) {
    return `${clean}/v1/chat/completions`;
  }
  return `${clean}/chat/completions`;
}
function parseDSML(text) {
  const toolCalls = [];
  if (!text) {
    return { cleanedContent: "", toolCalls };
  }
  const dsmlBlockRegex = /<[｜|]{2}DSML[｜|]{2}\s*calls>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*calls>|$)/gi;
  const cleanedContent = text.replace(dsmlBlockRegex, (_, innerBlock) => {
    const invokeRegex = /<[｜|]{2}DSML[｜|]{2}\s*invoke\s+name=["']([^"']+)["']>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*invoke>|$)/gi;
    let invMatch;
    while ((invMatch = invokeRegex.exec(innerBlock)) !== null) {
      const toolName = invMatch[1].trim();
      const paramsInner = invMatch[2];
      const args = {};
      const paramRegex = /<[｜|]{2}DSML[｜|]{2}\s*parameter\s+name=["']([^"']+)["'](?:\s+[^>]*)?>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*parameter>|$)/gi;
      let pMatch;
      while ((pMatch = paramRegex.exec(paramsInner)) !== null) {
        const paramName = pMatch[1].trim();
        const rawVal = pMatch[2].trim();
        let parsedVal = rawVal;
        if (rawVal.startsWith("{") && rawVal.endsWith("}") || rawVal.startsWith("[") && rawVal.endsWith("]")) {
          try {
            parsedVal = JSON.parse(rawVal);
          } catch {
            parsedVal = rawVal;
          }
        } else if (rawVal === "true") {
          parsedVal = true;
        } else if (rawVal === "false") {
          parsedVal = false;
        } else if (/^-?\d+(\.\d+)?$/.test(rawVal) && !isNaN(Number(rawVal))) {
          if (!rawVal.startsWith("0") || rawVal === "0" || rawVal.startsWith("0.")) {
            parsedVal = Number(rawVal);
          }
        }
        args[paramName] = parsedVal;
      }
      toolCalls.push({
        id: `call_dsml_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: toolName,
        args
      });
    }
    return "";
  }).trim();
  return { cleanedContent, toolCalls };
}
function resolveApiKey(explicitKey, providerId) {
  if (explicitKey && explicitKey.trim()) {
    return explicitKey.trim();
  }
  if (providerId === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY.trim();
  }
  if (providerId === "openai" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim();
  }
  if (providerId === "siliconflow" && process.env.SILICONFLOW_API_KEY) {
    return process.env.SILICONFLOW_API_KEY.trim();
  }
  if ((providerId === "google" || providerId === "gemini") && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY).trim();
  }
  if (providerId === "moonshot" && process.env.MOONSHOT_API_KEY) {
    return process.env.MOONSHOT_API_KEY.trim();
  }
  if (providerId === "ollama" && process.env.OLLAMA_API_KEY) {
    return process.env.OLLAMA_API_KEY.trim();
  }
  const candidatePaths = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../.env.local"),
    path.resolve(__dirname, "../../../.env"),
    "/home/mll/workspace/.envkey.local"
  ];
  for (const keyPath of candidatePaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const raw = fs.readFileSync(keyPath, "utf-8").trim();
        if (providerId === "deepseek") {
          if (raw.startsWith("sk-") && !raw.includes("=")) {
            return raw;
          }
          const match = raw.match(/DEEPSEEK_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
        if (providerId === "openai") {
          const match = raw.match(/OPENAI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
        if (providerId === "google" || providerId === "gemini") {
          const match = raw.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
        if (providerId === "siliconflow") {
          const match = raw.match(/SILICONFLOW_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
      }
    } catch {
    }
  }
  return "";
}
function createOpenAICompatibleCaller(config) {
  const targetUrl = normalizeChatCompletionsUrl(config.baseUrl);
  const modelName = config.model;
  return async (messages, tools, onChunk) => {
    const effectiveKey = resolveApiKey(config.apiKey, config.id);
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
    const formatMessageList = (msgList) => msgList.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        const item = {
          role: "assistant",
          content: typeof m.content === "string" ? m.content : m.content ? JSON.stringify(m.content) : "",
          tool_calls: m.tool_calls.map((c) => ({
            id: c.id,
            type: "function",
            function: c.function
          }))
        };
        if (m.reasoning_content !== void 0) {
          item.reasoning_content = m.reasoning_content;
        }
        return item;
      }
      return {
        role: m.role,
        content: Array.isArray(m.content) ? m.content : m.content || ""
      };
    });
    const body = {
      model: modelName,
      messages: formatMessageList(messages)
    };
    if (formattedTools.length > 0) {
      body.tools = formattedTools;
    }
    if (onChunk) {
      body.stream = true;
    }
    const headers = {
      "Content-Type": "application/json"
    };
    if (effectiveKey) {
      const cleanKey = effectiveKey.replace(/[^\x00-\x7F]/g, "").trim();
      if (cleanKey) {
        headers.Authorization = `Bearer ${cleanKey}`;
      }
    }
    let res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text();
      const hadMultimodal = messages.some((m) => Array.isArray(m.content));
      if (hadMultimodal && saysNoImages(errText)) {
        const textOnlyMessages = withoutImages(messages);
        body.messages = formatMessageList(textOnlyMessages);
        res = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
      }
      if (!res.ok) {
        const finalErr = res === void 0 || res.bodyUsed ? errText : await res.text();
        throw new Error(`[${config.name || config.id}] API \u8BF7\u6C42\u5931\u8D25 (HTTP ${res.status}): ${finalErr}`);
      }
    }
    if (onChunk && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      let streamedLength = 0;
      const toolCallMap = /* @__PURE__ */ new Map();
      const flushChunks = () => {
        const dsmlStart = accumulatedContent.search(/<[｜|]{2}DSML/i);
        if (dsmlStart === -1) {
          const lastTagOpen = accumulatedContent.lastIndexOf("<");
          let safeEnd = accumulatedContent.length;
          if (lastTagOpen !== -1 && accumulatedContent.length - lastTagOpen < 15) {
            safeEnd = lastTagOpen;
          }
          if (safeEnd > streamedLength) {
            onChunk(accumulatedContent.slice(streamedLength, safeEnd));
            streamedLength = safeEnd;
          }
        } else {
          if (dsmlStart > streamedLength) {
            onChunk(accumulatedContent.slice(streamedLength, dsmlStart));
            streamedLength = dsmlStart;
          }
          const callsEndRegex = /<\/[｜|]{2}DSML[｜|]{2}\s*calls>/gi;
          callsEndRegex.lastIndex = dsmlStart;
          const endMatch = callsEndRegex.exec(accumulatedContent);
          if (endMatch) {
            const dsmlEnd = endMatch.index + endMatch[0].length;
            if (dsmlEnd > streamedLength) {
              streamedLength = dsmlEnd;
            }
            if (accumulatedContent.length > streamedLength) {
              onChunk(accumulatedContent.slice(streamedLength));
              streamedLength = accumulatedContent.length;
            }
          }
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const data2 = JSON.parse(trimmed.slice(6));
              const choice2 = data2.choices?.[0];
              if (!choice2) continue;
              const delta = choice2.delta;
              if (delta?.reasoning_content) {
                accumulatedReasoning += delta.reasoning_content;
                if (onChunk) {
                  onChunk("", delta.reasoning_content);
                }
              }
              if (delta?.content) {
                accumulatedContent += delta.content;
                flushChunks();
              }
              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallMap.get(idx) || { id: tc.id || "", name: tc.function?.name || "", args: "" };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                  toolCallMap.set(idx, existing);
                }
              }
            } catch {
            }
          }
        }
      }
      const { cleanedContent: cleanedContent2, toolCalls: dsmlToolCalls2 } = parseDSML(accumulatedContent);
      accumulatedContent = cleanedContent2;
      if (accumulatedContent.length > streamedLength && dsmlToolCalls2.length === 0) {
        onChunk(accumulatedContent.slice(streamedLength));
        streamedLength = accumulatedContent.length;
      }
      const toolCalls2 = [];
      for (const item of toolCallMap.values()) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(item.args || "{}");
        } catch {
          parsedArgs = { raw: item.args };
        }
        toolCalls2.push({
          id: item.id || `call_${Date.now()}`,
          name: item.name,
          args: parsedArgs
        });
      }
      for (const dsmlCall of dsmlToolCalls2) {
        toolCalls2.push(dsmlCall);
      }
      return {
        content: accumulatedContent,
        reasoning_content: accumulatedReasoning || void 0,
        toolCalls: toolCalls2.length > 0 ? toolCalls2 : void 0
      };
    }
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    if (!choice) {
      return { content: "" };
    }
    const toolCalls = [];
    if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
      for (const call of choice.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || "{}");
        } catch {
          parsedArgs = { raw: call.function.arguments };
        }
        toolCalls.push({
          id: call.id,
          name: call.function.name,
          args: parsedArgs
        });
      }
    }
    let finalContent = choice.content || "";
    const { cleanedContent, toolCalls: dsmlToolCalls } = parseDSML(finalContent);
    finalContent = cleanedContent;
    for (const dsmlCall of dsmlToolCalls) {
      toolCalls.push(dsmlCall);
    }
    return {
      content: finalContent,
      reasoning_content: choice.reasoning_content,
      toolCalls: toolCalls.length > 0 ? toolCalls : void 0
    };
  };
}
async function testProviderConnection(config) {
  if (config.id === "ollama") {
    const probe = await probeOllamaModels(config.baseUrl || "http://localhost:11434");
    if (!probe.ok) {
      return {
        ok: false,
        latencyMs: 0,
        error: probe.error || "\u672A\u68C0\u6D4B\u5230\u672C\u5730\u6B63\u5728\u8FD0\u884C\u7684 Ollama \u670D\u52A1 (\u7AEF\u53E3 11434 \u672A\u54CD\u5E94)"
      };
    }
  }
  if (config.id === "google") {
    const start2 = Date.now();
    const effectiveKey2 = resolveApiKey(config.apiKey, config.id);
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey2}`);
      const latencyMs = Date.now() - start2;
      if (resp.ok) {
        return {
          ok: true,
          latencyMs,
          model: config.model || "imagen-3.0-generate-002"
        };
      } else {
        const text = await resp.text();
        return {
          ok: false,
          latencyMs,
          error: `Google API \u8BA4\u8BC1\u6216\u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${text.slice(0, 160)}`
        };
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start2,
        error: `\u8FDE\u63A5 Google \u670D\u52A1\u5F02\u5E38: ${err.message}`
      };
    }
  }
  const start = Date.now();
  const targetUrl = normalizeChatCompletionsUrl(config.baseUrl);
  const effectiveKey = resolveApiKey(config.apiKey, config.id);
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (effectiveKey) {
      const cleanKey = effectiveKey.replace(/[^\x00-\x7F]/g, "").trim();
      if (cleanKey) {
        headers.Authorization = `Bearer ${cleanKey}`;
      }
    }
    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5
      })
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${res.status}: ${text.slice(0, 160)}`
      };
    }
    const data = await res.json();
    const replyModel = data.model || config.model;
    let models = [];
    try {
      const modelsRes = await fetchRemoteModels(config.baseUrl, effectiveKey, 3e3);
      if (modelsRes.ok && modelsRes.models.length > 0) {
        models = modelsRes.models;
      }
    } catch {
    }
    return {
      ok: true,
      latencyMs,
      model: replyModel,
      models: models.length > 0 ? models : void 0
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message || "\u7F51\u7EDC\u8FDE\u63A5\u8D85\u65F6\u6216\u65E0\u6CD5\u89E3\u6790\u4E3B\u673A"
    };
  }
}
async function fetchRemoteModels(baseUrl, apiKey, timeoutMs = 6e3) {
  if (!baseUrl || !baseUrl.trim()) {
    return { ok: false, models: [], error: "Base URL \u4E0D\u80FD\u4E3A\u7A7A" };
  }
  const clean = baseUrl.trim().replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
  const candidateUrls = [];
  if (clean.endsWith("/v1")) {
    candidateUrls.push(`${clean}/models`);
  } else {
    candidateUrls.push(`${clean}/models`);
    candidateUrls.push(`${clean}/v1/models`);
  }
  const headers = {};
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  let lastError = "";
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${res.statusText}`;
        continue;
      }
      const json = await res.json();
      let list = [];
      if (Array.isArray(json?.data)) {
        list = json.data.map((m) => m.id || m.name).filter(Boolean);
      } else if (Array.isArray(json?.models)) {
        list = json.models.map((m) => m.name || m.id || m.model).filter(Boolean);
      } else if (Array.isArray(json)) {
        list = json.map((m) => typeof m === "string" ? m : m.id || m.name).filter(Boolean);
      }
      if (list.length > 0) {
        return { ok: true, models: Array.from(new Set(list)) };
      }
    } catch (err) {
      lastError = err.message || "\u7F51\u7EDC\u8FDE\u63A5\u8D85\u65F6";
    }
  }
  return { ok: false, models: [], error: lastError || "\u672A\u8FD4\u56DE\u6709\u6548\u6A21\u578B\u5217\u8868" };
}
async function probeOllamaModels(baseUrl = "http://localhost:11434") {
  const cleanOrigin = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  const tagsUrl = `${cleanOrigin}/api/tags`;
  try {
    const res = await fetch(tagsUrl, { method: "GET", signal: AbortSignal.timeout(3e3) });
    if (!res.ok) {
      return { ok: false, models: [], error: `Ollama \u54CD\u5E94 HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data && Array.isArray(data.models)) {
      const modelNames = data.models.map((m) => m.name || m.model).filter((n) => typeof n === "string" && Boolean(n));
      return { ok: true, models: modelNames };
    }
    return { ok: true, models: [] };
  } catch (err) {
    const errorMsg = err.message && err.message !== "fetch failed" ? err.message : "\u672A\u68C0\u6D4B\u5230\u672C\u5730\u6B63\u5728\u8FD0\u884C\u7684 Ollama \u670D\u52A1 (\u7AEF\u53E3 11434 \u672A\u54CD\u5E94)";
    return { ok: false, models: [], error: errorMsg };
  }
}

// ../../packages/sandbox-core/src/multica-bridge.ts
import { execSync } from "node:child_process";
import { existsSync as existsSync2, readFileSync, readdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";

// ../../packages/sandbox-core/src/providers/executable.ts
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
var WINDOWS_SHIM_EXTENSIONS = /* @__PURE__ */ new Set([".cmd", ".bat", ".ps1"]);
var CLAUDE_PACKAGE_ENTRIES = [
  ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"],
  ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
  ["..", "Packages", "Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe", "claude.exe"]
];
function expandHomePath(inputPath) {
  if (!inputPath) return void 0;
  const trimmed = inputPath.trim();
  if (!trimmed) return void 0;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}
function isExistingFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function getAugmentedPath() {
  const home = homedir();
  const extraDirs = [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
  const currentPath = process.env.PATH || "";
  const currentDirs = currentPath.split(delimiter).filter(Boolean);
  const merged = Array.from(/* @__PURE__ */ new Set([...extraDirs, ...currentDirs]));
  return merged.filter((d) => existsSync(d)).join(delimiter);
}
function findExecutableInPath(command, customPath) {
  const expanded = expandHomePath(command) || command;
  if (!expanded) return null;
  const isExplicitPath = expanded.includes("/") || expanded.includes("\\") || expanded.startsWith(".");
  if (isExplicitPath || isExistingFile(expanded)) {
    if (isExistingFile(expanded)) return expanded;
    if (process.platform === "win32") {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        if (isExistingFile(`${expanded}${ext}`)) return `${expanded}${ext}`;
      }
    }
    if (isExplicitPath) return null;
  }
  const pathEnv = customPath || getAugmentedPath();
  const dirs = pathEnv.split(delimiter);
  const candidates = process.platform === "win32" && !extname(expanded) ? [expanded, `${expanded}.exe`, `${expanded}.cmd`, `${expanded}.bat`] : [expanded];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (isExistingFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}
function resolveExecutableLaunchTarget(executablePath) {
  if (process.platform !== "win32") {
    return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
  }
  const ext = extname(executablePath).toLowerCase();
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
  }
  const shimDir = dirname(executablePath);
  for (const segments of CLAUDE_PACKAGE_ENTRIES) {
    const candidate = join(shimDir, ...segments);
    if (isExistingFile(candidate)) {
      if (candidate.toLowerCase().endsWith(".js")) {
        return { command: process.execPath, argsPrefix: [candidate], sdkExecutablePath: candidate };
      }
      return { command: candidate, argsPrefix: [], sdkExecutablePath: candidate };
    }
  }
  return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
}
function parseCliExtraArgs(raw) {
  if (!raw || !raw.trim()) return [];
  const tokens = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val !== void 0 && val.length > 0) {
      tokens.push(val);
    }
  }
  return tokens;
}
function signalProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
    }
  }
}
function executeVersionProbe(executablePath, args = ["--version"], timeoutMs = 8e3) {
  return new Promise((resolve) => {
    const cleanEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
      CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1"
    };
    delete cleanEnv.OPENAI_API_KEY;
    delete cleanEnv.ANTHROPIC_API_KEY;
    const target = resolveExecutableLaunchTarget(executablePath);
    execFile(
      target.command,
      [...target.argsPrefix, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        env: cleanEnv
      },
      (err, stdout, stderr) => {
        if (err) {
          const errMsg = err.killed ? "\u63A2\u9488\u8C03\u7528\u8D85\u65F6" : (stderr || err.message).trim().slice(0, 200);
          return resolve({ ok: false, error: errMsg });
        }
        const line = (stdout || "").trim().split("\n")[0] || "";
        resolve({ ok: true, version: line });
      }
    );
  });
}

// ../../packages/sandbox-core/src/multica-bridge.ts
var MulticaBridge = class {
  defaultProfile;
  constructor(profile = "qijunhui") {
    this.defaultProfile = process.env.MULTICA_PROFILE || profile;
  }
  /**
   * 探测并获取本地 Multica 配置、守护进程运行状态与已上线运行时
   */
  getStatus() {
    const home = homedir2();
    const multicaBin = findExecutableInPath("multica", `${join2(home, ".local", "bin")}:${getAugmentedPath()}`);
    if (!multicaBin) {
      return {
        installed: false,
        profile: this.defaultProfile,
        daemonRunning: false,
        runtimes: [],
        error: "\u672A\u5728\u7CFB\u7EDF PATH \u6216 ~/.local/bin \u4E2D\u68C0\u6D4B\u5230 multica CLI"
      };
    }
    const profileDir = join2(home, ".multica", "profiles");
    let profile = this.defaultProfile;
    if (existsSync2(profileDir)) {
      try {
        const list = readdirSync(profileDir);
        if (!list.includes(profile) && list.length > 0) {
          profile = list[0];
        }
      } catch {
      }
    }
    const configPath = join2(profileDir, profile, "config.json");
    let config = {};
    if (existsSync2(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf8"));
      } catch {
      }
    }
    let daemonRunning = false;
    let daemonPid;
    let uptime;
    try {
      const statusOut = execSync(`"${multicaBin}" --profile ${profile} daemon status`, {
        timeout: 3e3,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: getAugmentedPath() }
      });
      const pidMatch = statusOut.match(/running\s*\(pid\s*(\d+)(?:,\s*uptime\s*([^)]+))?\)/i);
      if (pidMatch) {
        daemonRunning = true;
        daemonPid = pidMatch[1];
        uptime = pidMatch[2];
      }
    } catch {
    }
    const runtimes = [];
    try {
      const runtimesOut = execSync(`"${multicaBin}" --profile ${profile} runtime list --output json`, {
        timeout: 4e3,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: getAugmentedPath() }
      });
      const rawList = JSON.parse(runtimesOut);
      if (Array.isArray(rawList)) {
        for (const r of rawList) {
          const lowerName = (r.name || "").toLowerCase();
          let agentId = "ducc";
          if (lowerName.includes("ducx") || r.provider === "codex") {
            agentId = "ducx";
          } else if (lowerName.includes("ducc") || r.provider === "claude") {
            agentId = "ducc";
          }
          runtimes.push({
            id: r.id,
            name: r.name,
            provider: r.provider,
            status: r.status,
            lastSeenAt: r.last_seen_at || r.last_seen,
            agentId
          });
        }
      }
    } catch {
    }
    return {
      installed: true,
      executablePath: multicaBin,
      profile,
      serverUrl: config.server_url || "http://team-mesh.loop.baidu-int.com:8006",
      appUrl: config.app_url || "http://team-mesh.loop.baidu-int.com:8004",
      workspaceId: config.workspace_id,
      daemonRunning,
      daemonPid,
      uptime,
      runtimes
    };
  }
  /**
   * 检查 Multica 是否已就绪且后台守护进程正在运行
   */
  isDaemonActive() {
    const status = this.getStatus();
    return status.installed && status.daemonRunning;
  }
};
var globalMulticaBridge = new MulticaBridge();

// ../../packages/sandbox-core/src/reasoning.ts
function splitReasoningAndContent(rawContent, rawReasoning) {
  let content = rawContent || "";
  let reasoning = rawReasoning || "";
  const thinkTagRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinkMatch;
  while ((thinkMatch = thinkTagRegex.exec(content)) !== null) {
    const th = thinkMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}

${th}` : th;
    }
  }
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const quoteReasoningRegex = /(?:^|\n)(?:>\s*💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n(?:>[^\n]*\n?)*)+/g;
  const quoteMatches = content.match(quoteReasoningRegex);
  if (quoteMatches) {
    for (const match of quoteMatches) {
      const extractedLines = match.split("\n").map((line) => line.replace(/^>\s*/, "")).filter((line) => !line.includes("\u{1F4AD}") && !line.includes("\u601D\u8003\u63A8\u7406")).join("\n").trim();
      if (extractedLines) {
        reasoning = reasoning ? `${reasoning}

${extractedLines}` : extractedLines;
      }
    }
    content = content.replace(quoteReasoningRegex, "").trim();
  }
  const unquotedReasoningRegex = /(?:^|\n)💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n([\s\S]*?)(?=(?:\n\n[^\n]+|$))/g;
  let unquotedMatch;
  while ((unquotedMatch = unquotedReasoningRegex.exec(content)) !== null) {
    const th = unquotedMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}

${th}` : th;
    }
  }
  content = content.replace(unquotedReasoningRegex, "").trim();
  const unclosedThinkMatch = content.match(/<think>([\s\S]*)$/i);
  if (unclosedThinkMatch) {
    const th = unclosedThinkMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}

${th}` : th;
    }
    content = content.replace(/<think>[\s\S]*$/i, "").trim();
  }
  return {
    content: content.trim(),
    reasoning: reasoning.trim() || void 0
  };
}

// ../../packages/sandbox-core/src/providers/async-queue.ts
var AsyncPushQueue = class {
  buffer = [];
  waiters = [];
  closed = false;
  failure = void 0;
  hasFailure = false;
  push(item) {
    if (this.closed || this.hasFailure) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return true;
    }
    this.buffer.push(item);
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.resolve({ value: void 0, done: true });
    }
  }
  fail(err) {
    if (this.closed || this.hasFailure) return;
    this.hasFailure = true;
    this.failure = err;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.reject(err);
    }
  }
  isClosed() {
    return this.closed || this.hasFailure;
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift(), done: false });
        }
        if (this.hasFailure) {
          return Promise.reject(this.failure);
        }
        if (this.closed) {
          return Promise.resolve({ value: void 0, done: true });
        }
        return new Promise((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: void 0, done: true });
      }
    };
  }
};

// ../../packages/sandbox-core/src/providers/claude-driver.ts
import * as NodeChildProcess from "node:child_process";
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";
import {
  query as claudeQuery
} from "@anthropic-ai/claude-agent-sdk";
var CLAUDE_HOST_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  "ELECTRON_RUN_AS_NODE"
];
var CURATED_CLAUDE_MODELS = [
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"]
  },
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"]
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    supportsEffort: false
  },
  {
    slug: "sonnet",
    name: "Sonnet (\u522B\u540D)",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"]
  },
  {
    slug: "opus",
    name: "Opus (\u522B\u540D)",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"]
  },
  {
    slug: "haiku",
    name: "Haiku (\u522B\u540D)",
    supportsEffort: false
  }
];
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebSearch",
  "WebFetch",
  "NotebookRead",
  "TodoRead"
]);
var EDIT_TOOLS = /* @__PURE__ */ new Set([
  ...READ_ONLY_TOOLS,
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "TodoWrite"
]);
var SESSION_IDLE_TTL_MS = 15 * 60 * 1e3;
var PROBE_INIT_TIMEOUT_MS = 15e3;
function hasClaudeManagedMcpConfig() {
  const target = process.platform === "darwin" ? "/Library/Application Support/ClaudeCode/managed-mcp.json" : process.platform === "win32" ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json" : "/etc/claude-code/managed-mcp.json";
  return existsSync3(target);
}
function readLocalClaudeSettings(configDir, executablePath) {
  const env = {};
  let activeModel = "";
  const dirs = [];
  const custom = expandHomePath(configDir);
  if (custom) {
    dirs.push(custom);
  } else {
    dirs.push(join3(homedir3(), ".claude"));
    if (executablePath) {
      const winMatch = executablePath.match(/^(\/mnt\/[a-zA-Z]\/Users\/[^/]+)\//);
      if (winMatch?.[1]) {
        dirs.push(join3(winMatch[1], ".claude"));
      }
    }
  }
  for (const dir of dirs) {
    const file = join3(dir, "settings.json");
    if (!isExistingFile(file)) continue;
    try {
      const raw = JSON.parse(readFileSync2(file, "utf8"));
      if (typeof raw.model === "string" && raw.model.trim()) {
        activeModel = raw.model.trim();
      }
      if (raw.env && typeof raw.env === "object") {
        for (const [k, v] of Object.entries(raw.env)) {
          if (typeof v === "string" && v.trim()) env[k] = v.trim();
        }
        if (!activeModel && env.ANTHROPIC_MODEL) activeModel = env.ANTHROPIC_MODEL;
      }
      break;
    } catch {
    }
  }
  return { activeModel: activeModel || void 0, env };
}
function buildClaudeProcessEnv(instance) {
  const env = {
    ...process.env,
    PATH: getAugmentedPath(),
    CLAUDE_CODE_ENTRYPOINT: "museclaw",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false"
  };
  for (const key of CLAUDE_HOST_SESSION_VARS) {
    delete env[key];
  }
  const expandedConfigDir = expandHomePath(instance.configDir);
  if (expandedConfigDir) {
    env.CLAUDE_CONFIG_DIR = expandedConfigDir;
  }
  if (instance.baseUrl && instance.baseUrl.trim() && !instance.baseUrl.startsWith("local://")) {
    env.ANTHROPIC_BASE_URL = instance.baseUrl.trim();
  }
  if (instance.apiKey && instance.apiKey.trim()) {
    const cleanKey = instance.apiKey.trim();
    env.ANTHROPIC_API_KEY = cleanKey;
    if (env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN) {
      env.ANTHROPIC_AUTH_TOKEN = cleanKey;
    }
  }
  if (instance.env) {
    for (const [k, v] of Object.entries(instance.env)) {
      if (typeof v === "string" && v.trim() !== "") {
        env[k] = v.trim();
      }
    }
  }
  return env;
}
function mapSdkModels(reported, customModels, settingsModel) {
  const bySlug = /* @__PURE__ */ new Map();
  if (settingsModel) {
    bySlug.set(settingsModel, { slug: settingsModel, name: settingsModel, isCustom: true });
  }
  for (const m of reported || []) {
    const slug = m.value?.trim();
    if (!slug || slug === "default") continue;
    bySlug.set(slug, {
      slug,
      name: m.displayName?.trim() || slug,
      supportsEffort: Boolean(m.supportsEffort),
      supportedEffortLevels: m.supportedEffortLevels ? [...m.supportedEffortLevels] : void 0
    });
  }
  for (const m of CURATED_CLAUDE_MODELS) {
    if (!bySlug.has(m.slug)) {
      bySlug.set(m.slug, m);
    }
  }
  for (const slug of customModels || []) {
    const clean = slug.trim();
    if (clean && !bySlug.has(clean)) {
      bySlug.set(clean, { slug: clean, name: clean, isCustom: true });
    }
  }
  return Array.from(bySlug.values());
}
function probeCliAuthFallback(executablePath, env) {
  return new Promise((resolve) => {
    const target = resolveExecutableLaunchTarget(executablePath);
    NodeChildProcess.execFile(
      target.command,
      [...target.argsPrefix, "auth", "status"],
      { timeout: 5e3, maxBuffer: 128 * 1024, env },
      (_err, stdout) => {
        try {
          const trimmed = (stdout || "").trim();
          if (trimmed.startsWith("{")) {
            const parsed = JSON.parse(trimmed);
            return resolve({
              loggedIn: Boolean(parsed.loggedIn),
              authMethod: typeof parsed.authMethod === "string" ? parsed.authMethod : void 0,
              email: typeof parsed.email === "string" ? parsed.email : void 0,
              subscriptionType: typeof parsed.subscriptionType === "string" ? parsed.subscriptionType : void 0
            });
          }
        } catch {
        }
        resolve({ loggedIn: false });
      }
    );
  });
}
function resolveSdkPermissionMode(mode) {
  if (mode === "full") return "bypassPermissions";
  if (mode === "auto_edits") return "acceptEdits";
  return "default";
}
function makeConfigFingerprint(instance, cwd) {
  return JSON.stringify({
    binaryPath: instance.binaryPath || "",
    configDir: instance.configDir || "",
    cwd,
    baseUrl: instance.baseUrl || "",
    apiKey: instance.apiKey || "",
    extraArgs: instance.extraArgs || "",
    env: instance.env || {},
    permissionMode: instance.permissionMode || "auto_edits"
  });
}
function summarizeToolInput(toolName, input) {
  if (toolName === "Bash" && typeof input.command === "string") {
    return `\u6267\u884C\u7EC8\u7AEF\u547D\u4EE4: ${input.command.slice(0, 120)}`;
  }
  if ((toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") && typeof input.file_path === "string") {
    return `\u4FEE\u6539\u6587\u4EF6: ${input.file_path}`;
  }
  const preview = JSON.stringify(input).slice(0, 120);
  return `\u8C03\u7528\u5DE5\u5177 ${toolName}: ${preview}`;
}
function formatClaudeError(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes("not logged in") || lower.includes("please run /login") || lower.includes("authentication_failed")) {
    return {
      code: "unauthenticated",
      message: "Claude Code \u5C1A\u672A\u767B\u5F55\u8BA4\u8BC1\u3002\u8BF7\u5728\u7EC8\u7AEF\u6267\u884C `claude auth login` \u6216\u5728\u914D\u7F6E\u4E2D\u5FC3\u586B\u5199\u81EA\u5B9A\u4E49 API \u7F51\u5173\u4E0E\u5BC6\u94A5\u3002"
    };
  }
  if (lower.includes("rate_limit") || lower.includes("429")) {
    return { code: "rate_limit", message: `Claude \u8BF7\u6C42\u89E6\u53D1\u9650\u6D41: ${raw}` };
  }
  return { message: raw };
}
function parseExtraArgsFlags(extraArgs) {
  const tokens = parseCliExtraArgs(extraArgs);
  if (tokens.length === 0) return void 0;
  const extra = {};
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith("-")) continue;
    const key = tok.replace(/^--?/, "");
    const eqIdx = key.indexOf("=");
    if (eqIdx > 0) {
      extra[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
    } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
      extra[key] = tokens[++i];
    } else {
      extra[key] = null;
    }
  }
  return Object.keys(extra).length > 0 ? extra : void 0;
}
var ClaudeProviderDriver = class {
  kind = "claude";
  supportsNativeSession = true;
  sessions = /* @__PURE__ */ new Map();
  pendingApprovals = /* @__PURE__ */ new Map();
  activeTurnQueues = /* @__PURE__ */ new Map();
  idleTimer;
  constructor() {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.sessions.entries()) {
        if (!session.activeTurnAbort && now - session.lastUsedAt > SESSION_IDLE_TTL_MS) {
          void this.closeSession(key);
        }
      }
    }, 6e4);
    this.idleTimer.unref();
  }
  spawnHook(onSpawn, onStderr) {
    return (spawnOptions) => {
      const target = resolveExecutableLaunchTarget(spawnOptions.command);
      const child = NodeChildProcess.spawn(target.command, [...target.argsPrefix, ...spawnOptions.args], {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        signal: spawnOptions.signal,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true
      });
      if (onStderr) {
        child.stderr?.setEncoding("utf8").on("data", onStderr);
      }
      onSpawn?.(child);
      return child;
    };
  }
  async probe(instance, options) {
    const envId = options?.environmentId || instance.environmentId || "local";
    const envLabel = options?.environmentLabel || "\u672C\u673A\u73AF\u5883";
    const now = Date.now();
    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: "claude",
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: "disabled",
        version: null,
        auth: { status: "unknown" },
        models: mapSdkModels(void 0, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @anthropic-ai/claude-code",
        message: "\u5DF2\u5728\u8BBE\u7F6E\u4E2D\u7981\u7528\u6B64\u5B9E\u4F8B"
      };
    }
    const exe = instance.binaryPath ? findExecutableInPath(instance.binaryPath) : findExecutableInPath("claude");
    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: "claude",
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: "not_found",
        version: null,
        auth: { status: "unknown" },
        models: mapSdkModels(void 0, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @anthropic-ai/claude-code",
        message: instance.binaryPath ? `\u672A\u5728\u81EA\u5B9A\u4E49\u8DEF\u5F84\u627E\u5230\u53EF\u6267\u884C\u7A0B\u5E8F: ${instance.binaryPath}` : "\u672A\u5728\u7CFB\u7EDF PATH \u4E2D\u68C0\u6D4B\u5230 claude \u547D\u4EE4"
      };
    }
    const versionRes = await executeVersionProbe(exe, ["--version"], 1e4);
    if (!versionRes.ok) {
      return {
        instanceId: instance.instanceId,
        driver: "claude",
        displayName: instance.displayName,
        enabled: true,
        installed: true,
        status: "error",
        version: null,
        executablePath: exe,
        auth: { status: "unknown" },
        models: mapSdkModels(void 0, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @anthropic-ai/claude-code",
        message: versionRes.error || "Claude Code \u65E0\u6CD5\u54CD\u5E94 --version"
      };
    }
    const processEnv = buildClaudeProcessEnv(instance);
    const localSettings = readLocalClaudeSettings(instance.configDir, exe);
    const mergedProbeEnv = { ...localSettings.env, ...processEnv };
    const managedMcp = hasClaudeManagedMcpConfig();
    const target = resolveExecutableLaunchTarget(exe);
    const probeAbort = new AbortController();
    let probeQuery;
    let initResult;
    try {
      const q = claudeQuery({
        // eslint-disable-next-line require-yield
        prompt: (async function* () {
          await new Promise((resolve) => {
            if (probeAbort.signal.aborted) return resolve();
            probeAbort.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        })(),
        options: {
          persistSession: false,
          pathToClaudeCodeExecutable: target.sdkExecutablePath,
          abortController: probeAbort,
          settingSources: ["user", "project", "local"],
          settings: { disableAllHooks: true },
          allowedTools: [],
          mcpServers: {},
          ...managedMcp ? {} : { strictMcpConfig: true },
          env: mergedProbeEnv,
          spawnClaudeCodeProcess: this.spawnHook()
        }
      });
      probeQuery = q;
      initResult = await Promise.race([
        q.initializationResult(),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Claude SDK \u521D\u59CB\u5316\u63A2\u9488\u8D85\u65F6")), PROBE_INIT_TIMEOUT_MS)
        )
      ]);
    } catch {
      initResult = void 0;
    } finally {
      if (!probeAbort.signal.aborted) probeAbort.abort();
      try {
        probeQuery?.close();
      } catch {
      }
    }
    const account = initResult?.account;
    const customEndpointRaw = mergedProbeEnv.ANTHROPIC_BASE_URL || localSettings.env.ANTHROPIC_BASE_URL || "";
    const customEndpoint = customEndpointRaw.trim() ? (() => {
      try {
        return new URL(customEndpointRaw.trim()).origin;
      } catch {
        return customEndpointRaw.trim();
      }
    })() : void 0;
    const hasCustomKey = Boolean(
      mergedProbeEnv.ANTHROPIC_API_KEY || mergedProbeEnv.ANTHROPIC_AUTH_TOKEN || localSettings.env.ANTHROPIC_API_KEY || localSettings.env.ANTHROPIC_AUTH_TOKEN
    );
    let auth;
    let status;
    let message;
    if (account) {
      const hasFirstPartyToken = Boolean(account.tokenSource && account.tokenSource !== "none");
      const hasSdkApiKey = Boolean(account.apiKeySource && account.apiKeySource !== "none");
      const isThirdPartyProvider = Boolean(account.apiProvider && account.apiProvider !== "firstParty");
      if (hasFirstPartyToken || hasSdkApiKey || isThirdPartyProvider || account.email || account.subscriptionType) {
        const label = customEndpoint ? "\u81EA\u5B9A\u4E49 Anthropic \u7F51\u5173" : account.subscriptionType ? `Claude ${account.subscriptionType}` : hasSdkApiKey || hasCustomKey ? "Anthropic API Key" : "Claude \u8D26\u53F7\u5DF2\u767B\u5F55";
        auth = {
          status: "authenticated",
          method: customEndpoint ? "customEndpoint" : hasSdkApiKey ? "apiKey" : account.tokenSource || "oauth",
          label,
          ...account.email ? { email: account.email } : {},
          ...account.subscriptionType ? { subscriptionType: account.subscriptionType } : {},
          ...customEndpoint ? { endpoint: customEndpoint } : {}
        };
        status = "ready";
      } else if (customEndpoint || hasCustomKey) {
        auth = {
          status: "authenticated",
          method: customEndpoint ? "customEndpoint" : "apiKey",
          label: customEndpoint ? "\u81EA\u5B9A\u4E49 Anthropic \u7F51\u5173" : "Anthropic API Key",
          ...customEndpoint ? { endpoint: customEndpoint } : {}
        };
        status = "ready";
      } else {
        auth = { status: "unauthenticated", method: "none", label: "\u672A\u767B\u5F55\u8BA4\u8BC1" };
        status = "unauthenticated";
        message = "\u5DF2\u68C0\u6D4B\u5230 Claude Code\uFF0C\u4F46\u5C1A\u672A\u5B8C\u6210\u8BA4\u8BC1\u3002\u8BF7\u6267\u884C claude auth login \u6216\u914D\u7F6E\u81EA\u5B9A\u4E49\u7F51\u5173\u4E0E Key\u3002";
      }
    } else {
      const fallback = await probeCliAuthFallback(exe, mergedProbeEnv);
      if (fallback.loggedIn) {
        auth = {
          status: "authenticated",
          method: fallback.authMethod || "oauth",
          label: fallback.subscriptionType ? `Claude ${fallback.subscriptionType}` : "Claude \u8D26\u53F7\u5DF2\u767B\u5F55",
          ...fallback.email ? { email: fallback.email } : {}
        };
        status = "ready";
      } else if (customEndpoint || hasCustomKey) {
        auth = {
          status: "authenticated",
          method: customEndpoint ? "customEndpoint" : "apiKey",
          label: customEndpoint ? "\u81EA\u5B9A\u4E49 Anthropic \u7F51\u5173" : "Anthropic API Key",
          ...customEndpoint ? { endpoint: customEndpoint } : {}
        };
        status = "ready";
      } else {
        auth = { status: "unauthenticated", method: "none", label: "\u672A\u767B\u5F55\u8BA4\u8BC1" };
        status = "unauthenticated";
        message = "\u5DF2\u68C0\u6D4B\u5230 Claude Code\uFF0C\u4F46\u5C1A\u672A\u5B8C\u6210\u8BA4\u8BC1\u3002\u8BF7\u6267\u884C claude auth login \u6216\u914D\u7F6E\u81EA\u5B9A\u4E49\u7F51\u5173\u4E0E Key\u3002";
      }
    }
    const models = mapSdkModels(initResult?.models, instance.customModels, localSettings.activeModel);
    const slashCommands = (initResult?.commands || []).map((c) => c.name?.trim()).filter((n) => Boolean(n));
    return {
      instanceId: instance.instanceId,
      driver: "claude",
      displayName: instance.displayName,
      enabled: true,
      installed: true,
      status,
      version: versionRes.version || null,
      executablePath: exe,
      auth,
      models,
      slashCommands,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: "npm i -g @anthropic-ai/claude-code",
      ...message ? { message } : {}
    };
  }
  openSession(params, executablePath, cwd, resumeSessionId) {
    const env = buildClaudeProcessEnv(params.instance);
    const target = resolveExecutableLaunchTarget(executablePath);
    const managedMcp = hasClaudeManagedMcpConfig();
    const promptQueue = new AsyncPushQueue();
    const stderrTail = [];
    let spawnedChild;
    const permissionMode = resolveSdkPermissionMode(params.permissionMode || params.instance.permissionMode);
    const extraFlags = parseExtraArgsFlags(params.instance.extraArgs);
    const canUseTool = permissionMode === "bypassPermissions" ? void 0 : async (toolName, input, opts) => {
      const effectiveMode = params.permissionMode || params.instance.permissionMode || "auto_edits";
      if (effectiveMode === "auto_edits" && EDIT_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      if (effectiveMode === "ask" && READ_ONLY_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const currentTurnQueue = this.activeTurnQueues.get(params.sessionKey);
      if (!currentTurnQueue) {
        return { behavior: "deny", message: "\u4F1A\u8BDD\u5BA1\u6279\u901A\u9053\u4E0D\u53EF\u7528" };
      }
      currentTurnQueue.push({
        type: "approval.request",
        requestId,
        toolName,
        summary: summarizeToolInput(toolName, input),
        input
      });
      return new Promise((resolve) => {
        const onAbort = () => {
          this.pendingApprovals.delete(requestId);
          resolve({ behavior: "deny", message: "\u7528\u6237\u5DF2\u4E2D\u65AD\u5F53\u524D\u6267\u884C" });
        };
        opts.signal.addEventListener("abort", onAbort, { once: true });
        this.pendingApprovals.set(requestId, {
          requestId,
          toolName,
          resolve: (decision) => {
            opts.signal.removeEventListener("abort", onAbort);
            this.pendingApprovals.delete(requestId);
            if (decision.approved) {
              resolve({
                behavior: "allow",
                updatedInput: decision.updatedInput || input
              });
            } else {
              resolve({
                behavior: "deny",
                message: decision.message || "\u7528\u6237\u62D2\u7EDD\u6267\u884C\u8BE5\u64CD\u4F5C"
              });
            }
          }
        });
      });
    };
    const effort = params.effort && params.effort !== "default" ? params.effort : params.instance.effort && params.instance.effort !== "default" ? params.instance.effort : void 0;
    const options = {
      cwd,
      env,
      pathToClaudeCodeExecutable: target.sdkExecutablePath,
      persistSession: true,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      settings: { disableAllHooks: true },
      mcpServers: {},
      ...managedMcp ? {} : { strictMcpConfig: true },
      permissionMode,
      ...permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {},
      ...canUseTool ? { canUseTool } : {},
      ...params.model && params.model !== "default" && params.model !== "auto" ? { model: params.model } : params.instance.model && params.instance.model !== "default" ? { model: params.instance.model } : {},
      ...effort ? { effort } : {},
      ...params.systemPrompt ? { systemPrompt: params.systemPrompt } : {},
      ...resumeSessionId ? { resume: resumeSessionId } : {},
      ...extraFlags ? { extraArgs: extraFlags } : {},
      spawnClaudeCodeProcess: this.spawnHook(
        (child) => {
          spawnedChild = child;
        },
        (chunk) => {
          for (const line of chunk.split("\n")) {
            const clean = line.trim();
            if (!clean) continue;
            stderrTail.push(clean);
            if (stderrTail.length > 20) stderrTail.shift();
          }
        }
      )
    };
    const queryRuntime = claudeQuery({
      prompt: promptQueue,
      options
    });
    const session = {
      sessionKey: params.sessionKey,
      queryRuntime,
      promptQueue,
      iterator: queryRuntime[Symbol.asyncIterator](),
      providerSessionId: resumeSessionId,
      configFingerprint: makeConfigFingerprint(params.instance, cwd),
      activeModel: params.model || params.instance.model,
      spawnedChild,
      stderrTail,
      lastUsedAt: Date.now()
    };
    this.sessions.set(params.sessionKey, session);
    return session;
  }
  async *runTurn(params) {
    const exe = params.instance.binaryPath ? findExecutableInPath(params.instance.binaryPath) : findExecutableInPath("claude");
    if (!exe) {
      yield {
        type: "turn.failed",
        code: "not_found",
        error: params.instance.binaryPath ? `\u672A\u5728\u81EA\u5B9A\u4E49\u8DEF\u5F84\u627E\u5230 Claude Code: ${params.instance.binaryPath}` : "\u672A\u5728\u7CFB\u7EDF PATH \u4E2D\u68C0\u6D4B\u5230 claude \u547D\u4EE4\uFF0C\u8BF7\u5148\u5B89\u88C5 Claude Code\u3002"
      };
      return;
    }
    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const fingerprint = makeConfigFingerprint(params.instance, cwd);
    const requestedModel = params.model || params.instance.model;
    let session = this.sessions.get(params.sessionKey);
    const canReuse = session && !session.promptQueue.isClosed() && session.configFingerprint === fingerprint && (!params.resumeSessionId || session.providerSessionId === params.resumeSessionId);
    if (!canReuse && session) {
      await this.closeSession(params.sessionKey);
      session = void 0;
    }
    const attemptTurn = async function* (driver, useResumeId, isRetryWithoutResume) {
      const turnStartedAt = Date.now();
      let liveSession = driver.sessions.get(params.sessionKey);
      if (!liveSession) {
        liveSession = driver.openSession(params, exe, cwd, useResumeId);
      } else if (requestedModel && requestedModel !== liveSession.activeModel && requestedModel !== "default") {
        try {
          await liveSession.queryRuntime.setModel(requestedModel);
          liveSession.activeModel = requestedModel;
        } catch {
          await driver.closeSession(params.sessionKey);
          liveSession = driver.openSession(params, exe, cwd, useResumeId);
        }
      }
      liveSession.lastUsedAt = Date.now();
      const turnAbort = new AbortController();
      liveSession.activeTurnAbort = turnAbort;
      const onParentAbort = () => {
        turnAbort.abort();
        void driver.interruptTurn(params.sessionKey);
      };
      params.signal?.addEventListener("abort", onParentAbort, { once: true });
      const turnQueue = new AsyncPushQueue();
      driver.activeTurnQueues.set(params.sessionKey, turnQueue);
      liveSession.promptQueue.push({
        type: "user",
        message: { role: "user", content: params.prompt },
        parent_tool_use_id: null
      });
      const toolStarts = /* @__PURE__ */ new Map();
      let deltaText = "";
      let deltaReasoning = "";
      let assistantText = "";
      let assistantReasoning = "";
      let emittedSessionStarted = false;
      let retrySignal = false;
      const pump = (async () => {
        try {
          while (!turnAbort.signal.aborted) {
            const next = await liveSession.iterator.next();
            if (next.done) {
              if (!turnAbort.signal.aborted) {
                const detail = liveSession.stderrTail.slice(-3).join(" | ");
                turnQueue.push({
                  type: "turn.failed",
                  error: detail || "Claude Code \u8FDB\u7A0B\u5DF2\u9000\u51FA"
                });
              }
              await driver.closeSession(params.sessionKey);
              break;
            }
            const msg = next.value;
            liveSession.lastUsedAt = Date.now();
            if (msg.type === "system" && msg.subtype === "init") {
              const sid = typeof msg.session_id === "string" ? msg.session_id : void 0;
              if (sid) {
                liveSession.providerSessionId = sid;
                if (!emittedSessionStarted) {
                  emittedSessionStarted = true;
                  turnQueue.push({
                    type: "session.started",
                    providerSessionId: sid,
                    model: typeof msg.model === "string" ? msg.model : void 0,
                    version: typeof msg.claude_code_version === "string" ? msg.claude_code_version : void 0
                  });
                }
              }
              continue;
            }
            if (msg.type === "stream_event" && msg.event?.type === "content_block_delta") {
              const d = msg.event.delta;
              if (d?.type === "text_delta" && typeof d.text === "string" && d.text.length > 0) {
                deltaText += d.text;
                turnQueue.push({ type: "text.delta", text: d.text });
              } else if (d?.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking.length > 0) {
                deltaReasoning += d.thinking;
                turnQueue.push({ type: "reasoning.delta", text: d.thinking });
              }
              continue;
            }
            if (msg.type === "assistant" && msg.message && Array.isArray(msg.message.content)) {
              if (msg.is_api_error_message) {
                const errRaw = msg.message.content.map((c) => c.text || "").join("\n").trim();
                const formatted = formatClaudeError(errRaw);
                turnQueue.push({
                  type: "turn.failed",
                  code: formatted.code,
                  error: formatted.message
                });
                continue;
              }
              for (const block of msg.message.content) {
                if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
                  const th = block.thinking.trim();
                  assistantReasoning = (assistantReasoning ? `${assistantReasoning}

` : "") + th;
                  if (!deltaReasoning) {
                    turnQueue.push({ type: "reasoning.delta", text: th });
                  }
                } else if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) {
                  assistantText += block.text;
                  if (!deltaText) {
                    turnQueue.push({ type: "text.delta", text: block.text });
                  }
                } else if (block?.type === "tool_use" && block.id && block.name) {
                  toolStarts.set(block.id, { name: block.name, startedAt: Date.now() });
                  turnQueue.push({
                    type: "tool.start",
                    toolCallId: block.id,
                    toolName: block.name,
                    input: block.input && typeof block.input === "object" ? block.input : {}
                  });
                }
              }
              continue;
            }
            if (msg.type === "user" && msg.message && Array.isArray(msg.message.content)) {
              for (const block of msg.message.content) {
                if (block?.type === "tool_result" && block.tool_use_id) {
                  const started = toolStarts.get(block.tool_use_id);
                  const durationMs = started ? Math.max(0, Date.now() - started.startedAt) : 0;
                  turnQueue.push({
                    type: "tool.end",
                    toolCallId: block.tool_use_id,
                    toolName: started?.name || "tool",
                    output: msg.tool_use_result ?? block.content,
                    isError: Boolean(block.is_error),
                    durationMs
                  });
                }
              }
              continue;
            }
            if (msg.type === "result") {
              const sid = typeof msg.session_id === "string" ? msg.session_id : liveSession.providerSessionId;
              if (sid) liveSession.providerSessionId = sid;
              if (msg.is_error) {
                const rawErr = Array.isArray(msg.errors) && msg.errors.join("; ") || typeof msg.result === "string" && msg.result || "Claude Code \u6267\u884C\u51FA\u9519";
                if (useResumeId && !isRetryWithoutResume && /no conversation found|session.*not found|could not find.*session/i.test(rawErr)) {
                  retrySignal = true;
                  await driver.closeSession(params.sessionKey);
                  break;
                }
                const formatted = formatClaudeError(rawErr);
                turnQueue.push({
                  type: "turn.failed",
                  code: formatted.code,
                  error: formatted.message
                });
              } else {
                const finalText = (deltaText || assistantText || (typeof msg.result === "string" ? msg.result : "")).trim();
                const finalReasoning = (deltaReasoning || assistantReasoning).trim() || void 0;
                turnQueue.push({
                  type: "turn.completed",
                  text: finalText,
                  reasoning: finalReasoning,
                  providerSessionId: sid,
                  usage: msg.usage ? {
                    inputTokens: msg.usage.input_tokens,
                    outputTokens: msg.usage.output_tokens,
                    costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : void 0
                  } : void 0,
                  durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : Date.now() - turnStartedAt
                });
              }
              break;
            }
          }
        } catch (err) {
          const detail = liveSession?.stderrTail.slice(-3).join(" | ");
          const rawMsg = detail || err?.message || String(err);
          if (useResumeId && !isRetryWithoutResume && /no conversation found|session.*not found|could not find.*session/i.test(rawMsg)) {
            retrySignal = true;
          } else if (turnAbort.signal.aborted) {
            turnQueue.push({ type: "turn.interrupted", reason: "\u7528\u6237\u5DF2\u4E2D\u65AD\u6267\u884C" });
          } else {
            const formatted = formatClaudeError(rawMsg);
            turnQueue.push({ type: "turn.failed", code: formatted.code, error: formatted.message });
          }
          await driver.closeSession(params.sessionKey);
        } finally {
          turnQueue.close();
        }
      })();
      try {
        for await (const ev of turnQueue) {
          yield ev;
        }
        await pump;
        if (retrySignal) {
          yield { __retryWithoutResume: true };
        }
      } finally {
        params.signal?.removeEventListener("abort", onParentAbort);
        driver.activeTurnQueues.delete(params.sessionKey);
        if (liveSession) liveSession.activeTurnAbort = void 0;
      }
    };
    const resumeId = session ? void 0 : params.resumeSessionId;
    for await (const ev of attemptTurn(this, resumeId, false)) {
      if ("__retryWithoutResume" in ev) {
        for await (const retryEv of attemptTurn(this, void 0, true)) {
          if (!("__retryWithoutResume" in retryEv)) {
            yield retryEv;
          }
        }
        return;
      }
      yield ev;
    }
  }
  async interruptTurn(sessionKey) {
    const session = this.sessions.get(sessionKey);
    for (const [reqId, pending] of this.pendingApprovals.entries()) {
      this.pendingApprovals.delete(reqId);
      pending.resolve({ approved: false, message: "\u5F53\u524D\u4EFB\u52A1\u5DF2\u88AB\u4E2D\u65AD" });
    }
    if (!session) return;
    session.activeTurnAbort?.abort();
    try {
      await session.queryRuntime.interrupt();
    } catch {
      await this.closeSession(sessionKey);
    }
  }
  async respondApproval(requestId, decision) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    pending.resolve(decision);
    return true;
  }
  async closeSession(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    this.sessions.delete(sessionKey);
    session.activeTurnAbort?.abort();
    session.promptQueue.close();
    try {
      session.queryRuntime.close();
    } catch {
    }
    const pid = session.spawnedChild?.pid;
    if (pid && session.spawnedChild && session.spawnedChild.exitCode === null) {
      signalProcessGroup(pid, "SIGTERM");
      setTimeout(() => {
        if (session.spawnedChild && session.spawnedChild.exitCode === null) {
          signalProcessGroup(pid, "SIGKILL");
        }
      }, 1e3).unref();
    }
  }
  async disposeAll() {
    clearInterval(this.idleTimer);
    for (const key of Array.from(this.sessions.keys())) {
      await this.closeSession(key);
    }
    for (const [reqId, pending] of this.pendingApprovals.entries()) {
      this.pendingApprovals.delete(reqId);
      pending.resolve({ approved: false, message: "\u8FD0\u884C\u65F6\u5DF2\u505C\u6B62" });
    }
  }
};

// ../../packages/sandbox-core/src/providers/codex-driver.ts
import * as NodeChildProcess2 from "node:child_process";
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { join as join4 } from "node:path";
var CURATED_CODEX_MODELS = [
  { slug: "gpt-5.4", name: "GPT-5.4", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
  { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
  { slug: "o3", name: "o3", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] },
  { slug: "gpt-4o", name: "GPT-4o", supportsEffort: false }
];
function discoverCodexLocalConfig(configDir) {
  const home = expandHomePath(configDir) || join4(homedir4(), ".codex");
  const configPath = join4(home, "config.toml");
  const bySlug = /* @__PURE__ */ new Map();
  let activeModel = "";
  let customEndpoint = "";
  if (existsSync4(configPath)) {
    try {
      const content = readFileSync3(configPath, "utf8");
      const modelMatch = content.match(/^model\s*=\s*["']([^"']+)["']/m);
      if (modelMatch?.[1]) {
        activeModel = modelMatch[1].trim();
        bySlug.set(activeModel, { slug: activeModel, name: activeModel });
      }
      const urlMatch = content.match(/^openai_base_url\s*=\s*["']([^"']+)["']/m);
      if (urlMatch?.[1]) {
        customEndpoint = urlMatch[1].trim();
      }
      const catalogMatch = content.match(/^model_catalog_json\s*=\s*["']([^"']+)["']/m);
      if (catalogMatch?.[1] && existsSync4(catalogMatch[1])) {
        const raw = JSON.parse(readFileSync3(catalogMatch[1], "utf8"));
        if (Array.isArray(raw.models)) {
          for (const m of raw.models) {
            const id = m.id || m.slug || m.name || m.display_name;
            if (typeof id === "string" && id.trim()) {
              bySlug.set(id.trim(), { slug: id.trim(), name: m.display_name || id.trim() });
            }
          }
        }
      }
    } catch {
    }
  }
  for (const m of CURATED_CODEX_MODELS) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
  }
  return {
    models: Array.from(bySlug.values()),
    activeModel: activeModel || void 0,
    customEndpoint: customEndpoint || void 0
  };
}
var CodexProviderDriver = class {
  kind = "codex";
  supportsNativeSession = true;
  activeTurns = /* @__PURE__ */ new Map();
  async probe(instance, options) {
    const envId = options?.environmentId || instance.environmentId || "local";
    const envLabel = options?.environmentLabel || "\u672C\u673A\u73AF\u5883";
    const now = Date.now();
    const discovered = discoverCodexLocalConfig(instance.configDir);
    for (const slug of instance.customModels || []) {
      const clean = slug.trim();
      if (clean && !discovered.models.some((m) => m.slug === clean)) {
        discovered.models.push({ slug: clean, name: clean, isCustom: true });
      }
    }
    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: "codex",
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: "disabled",
        version: null,
        auth: { status: "unknown" },
        models: discovered.models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @openai/codex",
        message: "\u5DF2\u5728\u8BBE\u7F6E\u4E2D\u7981\u7528\u6B64\u5B9E\u4F8B"
      };
    }
    const exe = instance.binaryPath ? findExecutableInPath(instance.binaryPath) : findExecutableInPath("codex");
    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: "codex",
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: "not_found",
        version: null,
        auth: { status: "unknown" },
        models: discovered.models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @openai/codex",
        message: "\u672A\u5728\u7CFB\u7EDF PATH \u4E2D\u68C0\u6D4B\u5230 codex \u547D\u4EE4"
      };
    }
    const ver = await executeVersionProbe(exe, ["--version"], 8e3);
    const hasCustomKey = Boolean(instance.apiKey?.trim() || instance.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    const codexHome = expandHomePath(instance.configDir) || join4(homedir4(), ".codex");
    const hasAuthJson = existsSync4(join4(codexHome, "auth.json"));
    const authenticated = hasCustomKey || hasAuthJson || Boolean(discovered.customEndpoint);
    return {
      instanceId: instance.instanceId,
      driver: "codex",
      displayName: instance.displayName,
      enabled: true,
      installed: ver.ok,
      status: !ver.ok ? "error" : authenticated ? "ready" : "unauthenticated",
      version: ver.version || null,
      executablePath: exe,
      auth: authenticated ? {
        status: "authenticated",
        method: hasCustomKey ? "apiKey" : "chatgpt",
        label: discovered.customEndpoint ? "\u81EA\u5B9A\u4E49\u7AEF\u70B9" : hasCustomKey ? "OpenAI API Key" : "Codex \u672C\u5730\u51ED\u636E",
        ...discovered.customEndpoint ? { endpoint: discovered.customEndpoint } : {}
      } : { status: "unauthenticated", method: "none", label: "\u672A\u767B\u5F55\u8BA4\u8BC1" },
      models: discovered.models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: "npm i -g @openai/codex",
      ...!ver.ok ? { message: ver.error } : !authenticated ? { message: "\u8BF7\u5728\u7EC8\u7AEF\u8FD0\u884C codex login \u6216\u914D\u7F6E OPENAI_API_KEY" } : {}
    };
  }
  async *runTurn(params) {
    const exe = params.instance.binaryPath ? findExecutableInPath(params.instance.binaryPath) : findExecutableInPath("codex");
    if (!exe) {
      yield { type: "turn.failed", code: "not_found", error: "\u672A\u68C0\u6D4B\u5230 codex \u53EF\u6267\u884C\u6587\u4EF6" };
      return;
    }
    const startedAt = Date.now();
    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const extraArgs = parseCliExtraArgs(params.instance.extraArgs);
    const model = params.model || params.instance.model;
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (params.resumeSessionId) {
      args.push("resume", params.resumeSessionId);
    } else {
      args.push("--ephemeral");
    }
    if (model && model !== "default") {
      args.push("--model", model);
    }
    const perm = params.permissionMode || params.instance.permissionMode;
    if (perm === "full") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else if (perm === "auto_edits") {
      args.push("--full-auto");
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    args.push("-");
    const env = {
      ...process.env,
      PATH: getAugmentedPath()
    };
    const expandedConfigDir = expandHomePath(params.instance.configDir);
    if (expandedConfigDir) env.CODEX_HOME = expandedConfigDir;
    if (params.instance.apiKey?.trim()) env.OPENAI_API_KEY = params.instance.apiKey.trim();
    if (params.instance.baseUrl?.trim() && !params.instance.baseUrl.startsWith("local://")) {
      env.OPENAI_BASE_URL = params.instance.baseUrl.trim();
    }
    if (params.instance.env) {
      for (const [k, v] of Object.entries(params.instance.env)) {
        if (typeof v === "string" && v.trim()) env[k] = v.trim();
      }
    }
    const target = resolveExecutableLaunchTarget(exe);
    const child = NodeChildProcess2.spawn(target.command, [...target.argsPrefix, ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true
    });
    const activeTurn = { child, interrupted: false };
    this.activeTurns.set(params.sessionKey, activeTurn);
    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    const queue = new AsyncPushQueue();
    const fullPrompt = params.systemPrompt ? `[System]
${params.systemPrompt}

[User]
${params.prompt}` : params.prompt;
    child.stdin?.write(fullPrompt);
    child.stdin?.end();
    let buf = "";
    let stderr = "";
    const messages = [];
    const reasoningParts = [];
    let threadId = params.resumeSessionId;
    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
          threadId = parsed.thread_id;
          queue.push({ type: "session.started", providerSessionId: parsed.thread_id });
        } else if (parsed.type === "item.started" && parsed.item?.type === "command_execution") {
          queue.push({
            type: "tool.start",
            toolCallId: parsed.item.id || `cmd_${Date.now()}`,
            toolName: "Bash",
            input: { command: parsed.item.command || "" }
          });
        } else if (parsed.type === "item.completed" && parsed.item) {
          if (parsed.item.type === "reasoning" && parsed.item.text) {
            const r = String(parsed.item.text).trim();
            if (r) {
              reasoningParts.push(r);
              queue.push({ type: "reasoning.delta", text: r });
            }
          } else if (parsed.item.type === "agent_message" && parsed.item.text) {
            const txt = String(parsed.item.text).replace(/\n\nSkipped:[\s\S]*$/, "").trim();
            if (txt) {
              messages.push(txt);
              queue.push({ type: "text.delta", text: txt });
            }
          } else if (parsed.item.type === "command_execution") {
            queue.push({
              type: "tool.end",
              toolCallId: parsed.item.id || `cmd_${Date.now()}`,
              toolName: "Bash",
              output: parsed.item.aggregated_output || "",
              isError: Boolean(parsed.item.exit_code && parsed.item.exit_code !== 0),
              durationMs: 0
            });
          }
        }
      } catch {
      }
    };
    child.stdout?.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const l of lines) handleLine(l);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (buf.trim()) handleLine(buf);
      this.activeTurns.delete(params.sessionKey);
      if (activeTurn.interrupted) {
        queue.push({ type: "turn.interrupted", reason: "\u7528\u6237\u5DF2\u4E2D\u65AD\u6267\u884C" });
      } else if (code === 0) {
        queue.push({
          type: "turn.completed",
          text: messages.join("\n\n").trim(),
          reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : void 0,
          providerSessionId: threadId,
          durationMs: Date.now() - startedAt
        });
      } else {
        queue.push({
          type: "turn.failed",
          error: stderr.trim() || `Codex \u5F02\u5E38\u9000\u51FA (code ${code})`
        });
      }
      queue.close();
    });
    child.on("error", (err) => {
      this.activeTurns.delete(params.sessionKey);
      queue.push({ type: "turn.failed", error: err.message });
      queue.close();
    });
    try {
      for await (const ev of queue) {
        yield ev;
      }
    } finally {
      params.signal?.removeEventListener("abort", onAbort);
    }
  }
  async interruptTurn(sessionKey) {
    const active = this.activeTurns.get(sessionKey);
    if (!active) return;
    active.interrupted = true;
    if (active.child.pid) signalProcessGroup(active.child.pid, "SIGTERM");
  }
  async respondApproval(_requestId, _decision) {
    return false;
  }
  async closeSession(sessionKey) {
    await this.interruptTurn(sessionKey);
  }
  async disposeAll() {
    for (const key of Array.from(this.activeTurns.keys())) {
      await this.closeSession(key);
    }
  }
};

// ../../packages/sandbox-core/src/providers/pi-driver.ts
import * as NodeChildProcess3 from "node:child_process";
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join5 } from "node:path";
var CURATED_PI_MODELS = [
  { slug: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6 (via Pi)" },
  { slug: "openai/gpt-5.4", name: "GPT-5.4 (via Pi)" },
  { slug: "deepseek/deepseek-chat", name: "DeepSeek Chat (via Pi)" }
];
function discoverPiModels(configDir) {
  const dir = expandHomePath(configDir) || join5(homedir5(), ".pi", "agent");
  const modelsPath = join5(dir, "models.json");
  const bySlug = /* @__PURE__ */ new Map();
  if (existsSync5(modelsPath)) {
    try {
      const raw = JSON.parse(readFileSync4(modelsPath, "utf8"));
      if (raw.providers && typeof raw.providers === "object") {
        for (const [providerName, provider] of Object.entries(raw.providers)) {
          if (Array.isArray(provider?.models)) {
            for (const m of provider.models) {
              const id = m.id || m.name;
              if (typeof id === "string" && id.trim()) {
                const slug = id.includes("/") ? id.trim() : `${providerName}/${id.trim()}`;
                bySlug.set(slug, { slug, name: m.name || slug });
              }
            }
          }
        }
      }
    } catch {
    }
  }
  for (const m of CURATED_PI_MODELS) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
  }
  return Array.from(bySlug.values());
}
var PiProviderDriver = class {
  kind = "pi";
  supportsNativeSession = true;
  sessions = /* @__PURE__ */ new Map();
  async probe(instance, options) {
    const envId = options?.environmentId || instance.environmentId || "local";
    const envLabel = options?.environmentLabel || "\u672C\u673A\u73AF\u5883";
    const now = Date.now();
    const models = discoverPiModels(instance.configDir);
    for (const slug of instance.customModels || []) {
      const clean = slug.trim();
      if (clean && !models.some((m) => m.slug === clean)) {
        models.push({ slug: clean, name: clean, isCustom: true });
      }
    }
    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: "pi",
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: "disabled",
        version: null,
        auth: { status: "unknown" },
        models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @mariozechner/pi-coding-agent",
        message: "\u5DF2\u5728\u8BBE\u7F6E\u4E2D\u7981\u7528\u6B64\u5B9E\u4F8B"
      };
    }
    const exe = instance.binaryPath ? findExecutableInPath(instance.binaryPath) : findExecutableInPath("pi");
    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: "pi",
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: "not_found",
        version: null,
        auth: { status: "unknown" },
        models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "npm i -g @mariozechner/pi-coding-agent",
        message: "\u672A\u5728\u7CFB\u7EDF PATH \u4E2D\u68C0\u6D4B\u5230 pi \u547D\u4EE4"
      };
    }
    const ver = await executeVersionProbe(exe, ["--version"], 8e3);
    return {
      instanceId: instance.instanceId,
      driver: "pi",
      displayName: instance.displayName,
      enabled: true,
      installed: ver.ok,
      status: ver.ok ? "ready" : "error",
      version: ver.version || null,
      executablePath: exe,
      auth: { status: ver.ok ? "authenticated" : "unknown", label: ver.ok ? "\u672C\u5730\u5C31\u7EEA" : "\u72B6\u6001\u672A\u77E5" },
      models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: "npm i -g @mariozechner/pi-coding-agent",
      ...!ver.ok ? { message: ver.error } : {}
    };
  }
  async *runTurn(params) {
    const exe = params.instance.binaryPath ? findExecutableInPath(params.instance.binaryPath) : findExecutableInPath("pi");
    if (!exe) {
      yield { type: "turn.failed", code: "not_found", error: "\u672A\u68C0\u6D4B\u5230 pi \u53EF\u6267\u884C\u6587\u4EF6" };
      return;
    }
    const startedAt = Date.now();
    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const extraArgs = parseCliExtraArgs(params.instance.extraArgs);
    const args = ["-p", "--no-session"];
    const model = params.model || params.instance.model;
    if (model && model !== "default") {
      args.push("--model", model);
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    const env = {
      ...process.env,
      PATH: getAugmentedPath()
    };
    const expandedConfigDir = expandHomePath(params.instance.configDir);
    if (expandedConfigDir) env.PI_CODING_AGENT_DIR = expandedConfigDir;
    if (params.instance.env) {
      for (const [k, v] of Object.entries(params.instance.env)) {
        if (typeof v === "string" && v.trim()) env[k] = v.trim();
      }
    }
    const target = resolveExecutableLaunchTarget(exe);
    const fullPrompt = params.systemPrompt ? `[System]
${params.systemPrompt}

[User]
${params.prompt}` : params.prompt;
    const child = NodeChildProcess3.spawn(target.command, [...target.argsPrefix, ...args, fullPrompt], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true
    });
    const session = {
      child,
      pendingRequests: /* @__PURE__ */ new Map(),
      interrupted: false
    };
    this.sessions.set(params.sessionKey, session);
    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    const queue = new AsyncPushQueue();
    session.activeTurnQueue = queue;
    let fullText = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      const txt = chunk.toString();
      fullText += txt;
      queue.push({ type: "text.delta", text: txt });
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      this.sessions.delete(params.sessionKey);
      if (session.interrupted) {
        queue.push({ type: "turn.interrupted", reason: "\u7528\u6237\u5DF2\u4E2D\u65AD\u6267\u884C" });
      } else if (code === 0 && fullText.trim()) {
        queue.push({
          type: "turn.completed",
          text: fullText.trim(),
          durationMs: Date.now() - startedAt
        });
      } else {
        queue.push({
          type: "turn.failed",
          error: stderr.trim() || `Pi \u5F02\u5E38\u9000\u51FA (code ${code})`
        });
      }
      queue.close();
    });
    child.on("error", (err) => {
      this.sessions.delete(params.sessionKey);
      queue.push({ type: "turn.failed", error: err.message });
      queue.close();
    });
    try {
      for await (const ev of queue) {
        yield ev;
      }
    } finally {
      params.signal?.removeEventListener("abort", onAbort);
    }
  }
  async interruptTurn(sessionKey) {
    const s = this.sessions.get(sessionKey);
    if (!s) return;
    s.interrupted = true;
    if (s.child.pid) signalProcessGroup(s.child.pid, "SIGTERM");
  }
  async respondApproval(_requestId, _decision) {
    return false;
  }
  async closeSession(sessionKey) {
    await this.interruptTurn(sessionKey);
  }
  async disposeAll() {
    for (const key of Array.from(this.sessions.keys())) {
      await this.closeSession(key);
    }
  }
};

// ../../packages/sandbox-core/src/providers/openai-compat-driver.ts
function toModelDescriptors(slugs, customModels) {
  const customSet = new Set((customModels || []).map((m) => m.trim()).filter(Boolean));
  const merged = Array.from(/* @__PURE__ */ new Set([...slugs.map((m) => m.trim()).filter(Boolean), ...customSet]));
  return merged.map((slug) => ({
    slug,
    name: slug,
    ...customSet.has(slug) ? { isCustom: true } : {}
  }));
}
var OpenAICompatProviderDriver = class {
  kind;
  supportsNativeSession = false;
  remoteModelsCache = /* @__PURE__ */ new Map();
  constructor(kind) {
    this.kind = kind;
  }
  async probe(instance, options) {
    const envId = options?.environmentId || instance.environmentId || "local";
    const envLabel = options?.environmentLabel || "\u672C\u673A\u73AF\u5883";
    const now = Date.now();
    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: this.kind,
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: "disabled",
        version: null,
        auth: { status: "unknown" },
        models: toModelDescriptors([], instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel
      };
    }
    if (this.kind === "ollama") {
      const endpoint = instance.baseUrl || "http://127.0.0.1:11434";
      const ollamaBin = findExecutableInPath("ollama");
      const probe = await probeOllamaModels(endpoint);
      const fallback = ["llama3.2", "qwen2.5-coder", "deepseek-r1:8b", "mistral"];
      const models2 = toModelDescriptors(
        probe.models.length > 0 ? probe.models : fallback,
        instance.customModels
      );
      return {
        instanceId: instance.instanceId,
        driver: "ollama",
        displayName: instance.displayName,
        enabled: true,
        installed: probe.ok || Boolean(ollamaBin),
        status: probe.ok ? "ready" : ollamaBin ? "warning" : "not_found",
        version: probe.ok ? "HTTP Service Active" : ollamaBin ? "Installed (Stopped)" : null,
        executablePath: ollamaBin || void 0,
        auth: {
          status: probe.ok ? "authenticated" : "unknown",
          label: probe.ok ? "\u672C\u5730\u670D\u52A1\u5DF2\u5C31\u7EEA" : ollamaBin ? "\u670D\u52A1\u672A\u542F\u52A8" : "\u672A\u68C0\u6D4B\u5230"
        },
        models: models2,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: "brew install ollama && ollama serve",
        ...probe.ok ? {} : {
          message: ollamaBin ? "\u5DF2\u68C0\u6D4B\u5230 ollama\uFF0C\u4F46\u672C\u5730\u670D\u52A1\u672A\u542F\u52A8\uFF08\u8BF7\u6267\u884C ollama serve\uFF09" : "\u672A\u68C0\u6D4B\u5230\u672C\u5730 Ollama \u670D\u52A1"
        }
      };
    }
    const effectiveKey = resolveApiKey(instance.apiKey, instance.instanceId);
    const cacheKey = `${instance.instanceId}:${instance.baseUrl || ""}:${effectiveKey.slice(0, 8)}`;
    const cached = this.remoteModelsCache.get(cacheKey);
    let fetchedModels = [];
    if (cached && cached.expiresAt > now) {
      fetchedModels = cached.models;
    } else if (effectiveKey && instance.baseUrl) {
      const res = await fetchRemoteModels(instance.baseUrl, effectiveKey, 3e3);
      if (res.ok && res.models.length > 0) {
        fetchedModels = res.models;
        this.remoteModelsCache.set(cacheKey, {
          models: res.models,
          expiresAt: now + 10 * 60 * 1e3
        });
      }
    }
    const baseSlugs = fetchedModels.length > 0 ? fetchedModels : instance.model ? [instance.model] : [];
    const models = toModelDescriptors(baseSlugs, instance.customModels);
    const ready = Boolean(effectiveKey);
    return {
      instanceId: instance.instanceId,
      driver: "openai-compat",
      displayName: instance.displayName,
      enabled: true,
      installed: true,
      status: ready ? "ready" : "unauthenticated",
      version: null,
      auth: ready ? {
        status: "authenticated",
        method: "apiKey",
        label: "API Key \u5DF2\u914D\u7F6E",
        ...instance.baseUrl ? { endpoint: instance.baseUrl } : {}
      } : { status: "unauthenticated", method: "none", label: "\u5F85\u914D\u7F6E API Key" },
      models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel
    };
  }
  async testConnection(instance) {
    return testProviderConnection({
      id: instance.instanceId,
      name: instance.displayName,
      baseUrl: instance.baseUrl || (this.kind === "ollama" ? "http://127.0.0.1:11434/v1/chat/completions" : ""),
      apiKey: instance.apiKey,
      model: instance.model
    });
  }
  async *runTurn(params) {
    const startedAt = Date.now();
    const caller = createOpenAICompatibleCaller({
      id: params.instance.instanceId,
      name: params.instance.displayName,
      baseUrl: params.instance.baseUrl || (this.kind === "ollama" ? "http://127.0.0.1:11434/v1/chat/completions" : ""),
      apiKey: params.instance.apiKey,
      model: params.model || params.instance.model
    });
    const messages = [
      ...params.systemPrompt ? [{ role: "system", content: params.systemPrompt }] : [],
      { role: "user", content: params.prompt }
    ];
    try {
      const res = await caller(messages, []);
      if (res.reasoning_content) {
        yield { type: "reasoning.delta", text: res.reasoning_content };
      }
      if (res.content) {
        yield { type: "text.delta", text: res.content };
      }
      yield {
        type: "turn.completed",
        text: res.content || "",
        reasoning: res.reasoning_content,
        durationMs: Date.now() - startedAt
      };
    } catch (err) {
      yield { type: "turn.failed", error: err?.message || String(err) };
    }
  }
  async interruptTurn(_sessionKey) {
  }
  async respondApproval(_requestId, _decision) {
    return false;
  }
  async closeSession(_sessionKey) {
  }
  async disposeAll() {
  }
};

// ../../packages/sandbox-core/src/providers/environment-bridge.ts
import { WebSocketServer } from "ws";
var EnvironmentBridge = class {
  environments = /* @__PURE__ */ new Map();
  turnToEnv = /* @__PURE__ */ new Map();
  approvalToEnv = /* @__PURE__ */ new Map();
  heartbeatTimer;
  constructor() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const env of this.environments.values()) {
        if (env.status === "online" && env.socket) {
          if (now - env.lastSeenAt > 6e4) {
            this.markOffline(env.environmentId);
          } else {
            try {
              env.socket.ping();
            } catch {
              this.markOffline(env.environmentId);
            }
          }
        }
      }
    }, 2e4);
    this.heartbeatTimer.unref();
  }
  handleConnection(socket, meta) {
    const fallbackId = meta.environmentId || `env_${Buffer.from(`${meta.userId || "anon"}:${meta.hostname || Date.now()}`).toString("hex").slice(0, 10)}`;
    let boundId = fallbackId;
    const ensureEntry = (id, info) => {
      const existing = this.environments.get(id);
      if (existing) {
        if (existing.socket && existing.socket !== socket) {
          try {
            existing.socket.close();
          } catch {
          }
        }
        existing.socket = socket;
        existing.status = "online";
        existing.lastSeenAt = Date.now();
        if (info?.hostname) existing.hostname = info.hostname;
        if (info?.label) existing.label = info.label;
        if (info?.platform) existing.platform = info.platform;
        if (info?.arch) existing.arch = info.arch;
        if (info?.userId) existing.userId = info.userId;
        if (info?.snapshots) existing.snapshots = info.snapshots;
        return existing;
      }
      const created = {
        environmentId: id,
        label: info?.label || info?.hostname || id,
        hostname: info?.hostname || "Remote Host",
        platform: info?.platform || "linux",
        arch: info?.arch || "x64",
        userId: info?.userId,
        status: "online",
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        snapshots: info?.snapshots || [],
        socket,
        pendingRequests: /* @__PURE__ */ new Map(),
        activeTurnQueues: /* @__PURE__ */ new Map()
      };
      this.environments.set(id, created);
      return created;
    };
    ensureEntry(boundId, {
      hostname: meta.hostname,
      platform: meta.platform,
      arch: meta.arch,
      userId: meta.userId
    });
    socket.on("pong", () => {
      const env = this.environments.get(boundId);
      if (env) env.lastSeenAt = Date.now();
    });
    socket.on("message", (raw) => {
      const env = this.environments.get(boundId);
      if (env) env.lastSeenAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (msg.id && !msg.method && env) {
        const pending = env.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          env.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || "Remote RPC error"));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }
      if (msg.method === "env.register") {
        const p = msg.params || {};
        boundId = p.environmentId || boundId;
        const entry = ensureEntry(boundId, {
          label: p.label || p.hostname,
          hostname: p.hostname,
          platform: p.platform,
          arch: p.arch,
          userId: meta.userId || p.userId,
          snapshots: Array.isArray(p.snapshots) ? p.snapshots : []
        });
        if (msg.id) {
          this.sendRaw(socket, { jsonrpc: "2.0", id: msg.id, result: { ok: true, environmentId: entry.environmentId } });
        }
        return;
      }
      if (msg.method === "env.snapshots.push" && env) {
        const snapshots = msg.params?.snapshots;
        if (Array.isArray(snapshots)) {
          env.snapshots = snapshots;
        }
        if (msg.id) {
          this.sendRaw(socket, { jsonrpc: "2.0", id: msg.id, result: { ok: true } });
        }
        return;
      }
      if (msg.method === "env.turn.event" && env) {
        const { turnId, event } = msg.params || {};
        const queue = turnId ? env.activeTurnQueues.get(turnId) : void 0;
        if (queue && event) {
          if (event.type === "approval.request" && event.requestId) {
            this.approvalToEnv.set(event.requestId, env.environmentId);
          }
          queue.push(event);
          if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
            queue.close();
            env.activeTurnQueues.delete(turnId);
          }
        }
      }
    });
    socket.on("close", () => {
      this.markOffline(boundId);
    });
    socket.on("error", () => {
      this.markOffline(boundId);
    });
  }
  markOffline(environmentId) {
    const env = this.environments.get(environmentId);
    if (!env) return;
    env.status = "offline";
    env.socket = void 0;
    for (const [reqId, pending] of env.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      env.pendingRequests.delete(reqId);
      pending.reject(new Error(`\u8FDC\u7A0B\u73AF\u5883 (${env.label}) \u8FDE\u63A5\u5DF2\u65AD\u5F00`));
    }
    for (const [turnId, queue] of env.activeTurnQueues.entries()) {
      env.activeTurnQueues.delete(turnId);
      queue.push({ type: "turn.failed", error: `\u8FDC\u7A0B\u73AF\u5883 (${env.label}) \u8FDE\u63A5\u610F\u5916\u65AD\u5F00` });
      queue.close();
    }
  }
  sendRaw(socket, payload) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }
  callRpc(environmentId, method, params, timeoutMs = 2e4) {
    const env = this.environments.get(environmentId);
    if (!env || env.status !== "online" || !env.socket || env.socket.readyState !== env.socket.OPEN) {
      return Promise.reject(new Error(`\u8FDC\u7A0B\u73AF\u5883 ${environmentId} \u4E0D\u5728\u7EBF`));
    }
    const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        env.pendingRequests.delete(id);
        reject(new Error(`\u8FDC\u7A0B\u73AF\u5883 RPC (${method}) \u8D85\u65F6 (${timeoutMs}ms)`));
      }, timeoutMs);
      env.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw(env.socket, { jsonrpc: "2.0", id, method, params });
    });
  }
  canUserAccess(environmentId, userId) {
    const env = this.environments.get(environmentId);
    if (!env) return false;
    if (!env.userId || env.userId === "default-mesh-token" || env.userId === "user_web" || env.userId === "admin") {
      return true;
    }
    return Boolean(userId && env.userId === userId);
  }
  listEnvironments(userId) {
    return Array.from(this.environments.values()).filter((env) => !userId || this.canUserAccess(env.environmentId, userId)).map((env) => ({
      environmentId: env.environmentId,
      label: env.label,
      kind: "remote",
      hostname: env.hostname,
      platform: env.platform,
      arch: env.arch,
      status: env.status,
      connectedAt: env.connectedAt,
      lastSeenAt: env.lastSeenAt,
      snapshots: env.snapshots
    }));
  }
  getEnvironment(environmentId) {
    const env = this.environments.get(environmentId);
    if (!env) return void 0;
    return {
      environmentId: env.environmentId,
      label: env.label,
      kind: "remote",
      hostname: env.hostname,
      platform: env.platform,
      arch: env.arch,
      status: env.status,
      connectedAt: env.connectedAt,
      lastSeenAt: env.lastSeenAt,
      snapshots: env.snapshots
    };
  }
  async probeInstance(instance) {
    const env = this.environments.get(instance.environmentId);
    if (!env || env.status !== "online") {
      return {
        instanceId: instance.instanceId,
        driver: instance.driver,
        displayName: instance.displayName,
        enabled: instance.enabled,
        installed: false,
        status: "not_found",
        version: null,
        auth: { status: "unknown" },
        models: [],
        checkedAt: Date.now(),
        environmentId: instance.environmentId,
        environmentLabel: env?.label || instance.environmentId,
        message: "\u76EE\u6807\u8FDC\u7A0B\u73AF\u5883\u5F53\u524D\u79BB\u7EBF"
      };
    }
    const res = await this.callRpc(
      instance.environmentId,
      "env.probe",
      { instance },
      25e3
    );
    return res.snapshot;
  }
  async *runTurn(params) {
    const envId = params.instance.environmentId;
    const env = this.environments.get(envId);
    if (!env || env.status !== "online") {
      yield {
        type: "turn.failed",
        error: `\u8FDC\u7A0B\u73AF\u5883 (${env?.label || envId}) \u5F53\u524D\u4E0D\u5728\u7EBF\uFF0C\u8BF7\u5148\u5728\u5BF9\u5E94\u7EC8\u7AEF\u4FDD\u6301\u4F34\u4FA3\u8FDE\u63A5\u3002`
      };
      return;
    }
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const queue = new AsyncPushQueue();
    env.activeTurnQueues.set(turnId, queue);
    this.turnToEnv.set(params.sessionKey, envId);
    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await this.callRpc(
        envId,
        "env.turn.start",
        {
          turnId,
          sessionKey: params.sessionKey,
          instance: params.instance,
          prompt: params.prompt,
          systemPrompt: params.systemPrompt,
          cwd: params.cwd,
          model: params.model,
          effort: params.effort,
          permissionMode: params.permissionMode,
          resumeSessionId: params.resumeSessionId
        },
        15e3
      );
      for await (const ev of queue) {
        yield ev;
      }
    } catch (err) {
      env.activeTurnQueues.delete(turnId);
      yield { type: "turn.failed", error: err?.message || String(err) };
    } finally {
      params.signal?.removeEventListener("abort", onAbort);
      env.activeTurnQueues.delete(turnId);
      if (this.turnToEnv.get(params.sessionKey) === envId) {
        this.turnToEnv.delete(params.sessionKey);
      }
    }
  }
  async interruptTurn(sessionKey) {
    const envId = this.turnToEnv.get(sessionKey);
    if (!envId) return;
    await this.callRpc(envId, "env.turn.interrupt", { sessionKey }, 5e3).catch(() => {
    });
  }
  async respondApproval(requestId, decision) {
    const envId = this.approvalToEnv.get(requestId);
    if (!envId) return false;
    this.approvalToEnv.delete(requestId);
    const res = await this.callRpc(
      envId,
      "env.approval.respond",
      { requestId, decision },
      5e3
    ).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }
  async closeSession(sessionKey, environmentId) {
    const envId = environmentId || this.turnToEnv.get(sessionKey);
    if (!envId) return;
    await this.callRpc(envId, "env.session.close", { sessionKey }, 5e3).catch(() => {
    });
  }
  dispose() {
    clearInterval(this.heartbeatTimer);
    for (const env of this.environments.values()) {
      try {
        env.socket?.close();
      } catch {
      }
    }
    this.environments.clear();
  }
};
var globalEnvironmentBridge = new EnvironmentBridge();

// ../../packages/sandbox-core/src/providers/registry.ts
import os from "node:os";
var PROBE_CACHE_TTL_MS = 2e4;
var ProviderRuntimeManager = class {
  drivers;
  bridge;
  probeCache = /* @__PURE__ */ new Map();
  constructor(bridge = globalEnvironmentBridge) {
    this.bridge = bridge;
    const claude = new ClaudeProviderDriver();
    const codex = new CodexProviderDriver();
    const pi = new PiProviderDriver();
    const ollama = new OpenAICompatProviderDriver("ollama");
    const openaiCompat = new OpenAICompatProviderDriver("openai-compat");
    this.drivers = /* @__PURE__ */ new Map([
      ["claude", claude],
      ["codex", codex],
      ["pi", pi],
      ["ollama", ollama],
      ["openai-compat", openaiCompat]
    ]);
  }
  getDriver(kind) {
    return this.drivers.get(kind);
  }
  getEnvironmentBridge() {
    return this.bridge;
  }
  listEnvironments(userId) {
    const localEnv = {
      environmentId: "local",
      label: `\u672C\u673A\u73AF\u5883 (${os.hostname()})`,
      kind: "local",
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      status: "online"
    };
    return [localEnv, ...this.bridge.listEnvironments(userId)];
  }
  async probeInstance(instance, options) {
    const cacheKey = JSON.stringify({
      instanceId: instance.instanceId,
      driver: instance.driver,
      enabled: instance.enabled,
      environmentId: instance.environmentId,
      binaryPath: instance.binaryPath || "",
      configDir: instance.configDir || "",
      baseUrl: instance.baseUrl || "",
      hasApiKey: Boolean(instance.apiKey),
      customModels: instance.customModels || [],
      env: instance.env || {}
    });
    if (!options?.forceRefresh) {
      const cached = this.probeCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.snapshot;
      }
    }
    let snapshot;
    if (instance.environmentId && instance.environmentId !== "local") {
      if (options?.userId && !this.bridge.canUserAccess(instance.environmentId, options.userId)) {
        snapshot = {
          instanceId: instance.instanceId,
          driver: instance.driver,
          displayName: instance.displayName,
          enabled: instance.enabled,
          installed: false,
          status: "error",
          version: null,
          auth: { status: "unknown" },
          models: [],
          checkedAt: Date.now(),
          environmentId: instance.environmentId,
          environmentLabel: instance.environmentId,
          message: "\u65E0\u6743\u8BBF\u95EE\u8BE5\u8FDC\u7A0B\u8BA1\u7B97\u73AF\u5883"
        };
      } else {
        snapshot = await this.bridge.probeInstance(instance);
      }
    } else {
      const driver = this.drivers.get(instance.driver);
      if (!driver) {
        throw new Error(`\u672A\u77E5\u7684 Provider \u9A71\u52A8\u7C7B\u578B: ${instance.driver}`);
      }
      snapshot = await driver.probe(instance, {
        environmentId: "local",
        environmentLabel: `\u672C\u673A\u73AF\u5883 (${os.hostname()})`
      });
    }
    this.probeCache.set(cacheKey, {
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
      snapshot
    });
    return snapshot;
  }
  async *runTurn(params) {
    const envId = params.instance.environmentId || "local";
    if (envId !== "local") {
      for await (const ev of this.bridge.runTurn(params)) {
        yield ev;
      }
      return;
    }
    const driver = this.drivers.get(params.instance.driver);
    if (!driver) {
      yield { type: "turn.failed", error: `\u672A\u6CE8\u518C\u7684\u9A71\u52A8\u7C7B\u578B: ${params.instance.driver}` };
      return;
    }
    for await (const ev of driver.runTurn(params)) {
      yield ev;
    }
  }
  async testInstance(instance) {
    const startedAt = Date.now();
    const snapshot = await this.probeInstance(instance, { forceRefresh: true });
    if (!instance.enabled) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        diagnosticCode: "disabled",
        error: "\u5F53\u524D\u5B9E\u4F8B\u5DF2\u88AB\u7981\u7528"
      };
    }
    if (snapshot.status === "not_found") {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        diagnosticCode: "not_found",
        error: snapshot.message || `\u672A\u68C0\u6D4B\u5230 ${instance.displayName} \u8FD0\u884C\u65F6`
      };
    }
    if (snapshot.status === "unauthenticated") {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: "unauthenticated",
        error: snapshot.message || `${instance.displayName} \u5C1A\u672A\u5B8C\u6210\u8BA4\u8BC1`
      };
    }
    if (instance.driver === "openai-compat" || instance.driver === "ollama") {
      const driver = this.drivers.get(instance.driver);
      const res = await driver.testConnection(instance);
      return {
        ok: res.ok,
        latencyMs: res.latencyMs,
        snapshot,
        model: res.model || instance.model,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: res.ok ? "ready" : "execution_failed",
        error: res.error
      };
    }
    const testSessionKey = `probe_test_${instance.instanceId}_${Date.now()}`;
    const testInstanceConfig = {
      ...instance,
      permissionMode: "full",
      extraArgs: instance.extraArgs
    };
    let replyText = "";
    let failedError = "";
    try {
      for await (const ev of this.runTurn({
        sessionKey: testSessionKey,
        instance: testInstanceConfig,
        prompt: "Reply with just: OK",
        model: instance.model
      })) {
        if (ev.type === "text.delta") {
          replyText += ev.text;
        } else if (ev.type === "turn.completed") {
          if (ev.text) replyText = ev.text;
        } else if (ev.type === "turn.failed") {
          failedError = ev.error;
        }
      }
    } finally {
      await this.closeSession(testSessionKey, instance.environmentId);
    }
    const latencyMs = Date.now() - startedAt;
    if (failedError) {
      return {
        ok: false,
        latencyMs,
        snapshot,
        model: instance.model,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: failedError.includes("\u5C1A\u672A\u767B\u5F55") ? "unauthenticated" : "execution_failed",
        error: failedError
      };
    }
    return {
      ok: true,
      latencyMs,
      snapshot,
      model: instance.model,
      version: snapshot.version,
      auth: snapshot.auth,
      replyPreview: replyText.trim().slice(0, 120) || "OK",
      diagnosticCode: "ready"
    };
  }
  async interruptTurn(sessionKey) {
    await Promise.all([
      ...Array.from(this.drivers.values()).map((d) => d.interruptTurn(sessionKey)),
      this.bridge.interruptTurn(sessionKey)
    ]);
  }
  async respondApproval(requestId, decision) {
    for (const driver of this.drivers.values()) {
      const handled = await driver.respondApproval(requestId, decision);
      if (handled) return true;
    }
    return this.bridge.respondApproval(requestId, decision);
  }
  async closeSession(sessionKey, environmentId) {
    await Promise.all([
      ...Array.from(this.drivers.values()).map((d) => d.closeSession(sessionKey)),
      this.bridge.closeSession(sessionKey, environmentId)
    ]);
  }
  async disposeAll() {
    await Promise.all(Array.from(this.drivers.values()).map((d) => d.disposeAll()));
    this.bridge.dispose();
  }
  /**
   * 创建兼容传统单轮 LLMCaller 的适配器（供记忆反思、巡检、态势流等后台任务复用）
   */
  createLLMCaller(instance, scopeKey) {
    if (instance.driver === "openai-compat" || instance.driver === "ollama") {
      return createOpenAICompatibleCaller({
        id: instance.instanceId,
        name: instance.displayName,
        baseUrl: instance.baseUrl || (instance.driver === "ollama" ? "http://127.0.0.1:11434/v1/chat/completions" : ""),
        apiKey: instance.apiKey,
        model: instance.model
      });
    }
    return async (messages, _tools, onChunk) => {
      const prompt = messages.filter((m) => Boolean(m.content)).map((m) => {
        const txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (m.role === "system") return `[System]
${txt}`;
        if (m.role === "assistant") return `[Assistant]
${txt}`;
        return `[User]
${txt}`;
      }).join("\n\n");
      const sessionKey = scopeKey || `caller_${instance.instanceId}_${Date.now()}`;
      let fullText = "";
      let fullReasoning = "";
      let errorMsg = "";
      try {
        for await (const ev of this.runTurn({
          sessionKey,
          instance: { ...instance, permissionMode: "full" },
          prompt,
          model: instance.model
        })) {
          if (ev.type === "text.delta") {
            fullText += ev.text;
            onChunk?.(ev.text);
          } else if (ev.type === "reasoning.delta") {
            fullReasoning += ev.text;
            onChunk?.("", ev.text);
          } else if (ev.type === "turn.completed") {
            if (ev.text) fullText = ev.text;
            if (ev.reasoning) fullReasoning = ev.reasoning;
          } else if (ev.type === "turn.failed") {
            errorMsg = ev.error;
          }
        }
      } finally {
        await this.closeSession(sessionKey, instance.environmentId);
      }
      if (errorMsg) {
        throw new Error(`[${instance.displayName}] \u6267\u884C\u5931\u8D25: ${errorMsg}`);
      }
      const parsed = splitReasoningAndContent(fullText, fullReasoning || void 0);
      return {
        content: parsed.content,
        reasoning_content: parsed.reasoning,
        toolCalls: []
      };
    };
  }
};
var globalProviderRuntime = new ProviderRuntimeManager();

// src/cli.ts
function getServicePaths() {
  const home = homedir6();
  const museclawDir = join6(home, ".museclaw");
  return {
    home,
    museclawDir,
    configFile: join6(museclawDir, "runner.json"),
    clientScript: join6(museclawDir, "client.js"),
    logFile: join6(museclawDir, "runner.log"),
    errLogFile: join6(museclawDir, "runner.err.log"),
    isMac: os2.platform() === "darwin",
    launchdPlist: join6(home, "Library", "LaunchAgents", "com.museclaw.runner.plist"),
    systemdService: join6(home, ".config", "systemd", "user", "museclaw-runner.service")
  };
}
function loadPersistentConfig() {
  const paths = getServicePaths();
  if (existsSync6(paths.configFile)) {
    try {
      return JSON.parse(readFileSync5(paths.configFile, "utf8"));
    } catch {
    }
  }
  return {};
}
function savePersistentConfig(cfg) {
  const paths = getServicePaths();
  if (!existsSync6(paths.museclawDir)) {
    mkdirSync(paths.museclawDir, { recursive: true });
  }
  try {
    const existing = loadPersistentConfig();
    writeFileSync(paths.configFile, JSON.stringify({ ...existing, ...cfg }, null, 2), "utf8");
  } catch {
  }
}
function installService(config) {
  const paths = getServicePaths();
  if (!existsSync6(paths.museclawDir)) mkdirSync(paths.museclawDir, { recursive: true });
  savePersistentConfig(config);
  try {
    const currentScript = process.argv[1] ? path2.resolve(process.argv[1]) : "";
    if (currentScript && existsSync6(currentScript) && currentScript !== path2.resolve(paths.clientScript)) {
      copyFileSync(currentScript, paths.clientScript);
    }
  } catch {
  }
  if (os2.platform() === "win32") {
    console.log("\n===========================================================");
    console.log("Windows \u73AF\u5883\u4E0B\u8BF7\u4F7F\u7528\u4EE5\u4E0B\u547D\u4EE4\u76F4\u63A5\u542F\u52A8\u5E38\u9A7B\u8FDE\u63A5:");
    console.log(`  node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log("===========================================================\n");
    return;
  }
  const nodeBin = process.execPath;
  const envPath = getAugmentedPath();
  if (paths.isMac) {
    const launchAgentsDir = join6(paths.home, "Library", "LaunchAgents");
    if (!existsSync6(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true });
    try {
      execSync2(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
    }
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.museclaw.runner</string>
  <key>ProgramArguments</key>
  <array><string>${nodeBin}</string><string>${paths.clientScript}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${paths.museclawDir}</string>
  <key>StandardOutPath</key><string>${paths.logFile}</string>
  <key>StandardErrorPath</key><string>${paths.errLogFile}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${envPath}</string><key>HOME</key><string>${paths.home}</string></dict>
</dict>
</plist>`;
    writeFileSync(paths.launchdPlist, plist, "utf8");
    execSync2(`launchctl load -w "${paths.launchdPlist}"`);
    console.log("macOS LaunchAgent \u5B88\u62A4\u670D\u52A1\u5DF2\u5B89\u88C5\u5E76\u542F\u52A8: com.museclaw.runner");
  } else {
    const systemdDir = join6(paths.home, ".config", "systemd", "user");
    if (!existsSync6(systemdDir)) mkdirSync(systemdDir, { recursive: true });
    try {
      execSync2("systemctl --user stop museclaw-runner.service 2>/dev/null", { stdio: "ignore" });
    } catch {
    }
    const service = `[Unit]
Description=MuseClaw WebSocket Environment Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${paths.clientScript}
WorkingDirectory=${paths.museclawDir}
Restart=always
RestartSec=5
StandardOutput=append:${paths.logFile}
StandardError=append:${paths.errLogFile}
Environment="PATH=${envPath}"
Environment="HOME=${paths.home}"

[Install]
WantedBy=default.target
`;
    writeFileSync(paths.systemdService, service, "utf8");
    execSync2("systemctl --user daemon-reload");
    execSync2("systemctl --user enable --now museclaw-runner.service");
    console.log("Linux systemd \u7528\u6237\u5E38\u9A7B\u670D\u52A1\u5DF2\u5B89\u88C5\u5E76\u542F\u52A8: museclaw-runner.service");
  }
}
function uninstallService() {
  const paths = getServicePaths();
  if (paths.isMac) {
    try {
      execSync2(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
    }
    if (existsSync6(paths.launchdPlist)) unlinkSync(paths.launchdPlist);
    console.log("macOS LaunchAgent \u670D\u52A1\u5DF2\u5378\u8F7D");
  } else {
    try {
      execSync2("systemctl --user stop museclaw-runner.service 2>/dev/null", { stdio: "ignore" });
      execSync2("systemctl --user disable museclaw-runner.service 2>/dev/null", { stdio: "ignore" });
    } catch {
    }
    if (existsSync6(paths.systemdService)) {
      unlinkSync(paths.systemdService);
      execSync2("systemctl --user daemon-reload 2>/dev/null || true");
    }
    console.log("Linux systemd \u670D\u52A1\u5DF2\u5378\u8F7D");
  }
}
var MuseClawEnvironmentDaemon = class {
  serverUrl;
  token;
  machineName;
  environmentId;
  drivers;
  socket = null;
  isRunning = true;
  reconnectAttempt = 0;
  constructor(options) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.token = options.token || process.env.MUSECLAW_TOKEN || "default-mesh-token";
    this.machineName = options.name || hostname();
    this.environmentId = options.environmentId || `env_${Buffer.from(`${this.token}:${this.machineName}`).toString("hex").slice(0, 10)}`;
    this.drivers = /* @__PURE__ */ new Map([
      ["claude", new ClaudeProviderDriver()],
      ["codex", new CodexProviderDriver()],
      ["pi", new PiProviderDriver()],
      ["ollama", new OpenAICompatProviderDriver("ollama")],
      ["openai-compat", new OpenAICompatProviderDriver("openai-compat")]
    ]);
  }
  async probeAll() {
    const defaults = [
      {
        instanceId: "claude",
        driver: "claude",
        displayName: "Claude Code",
        enabled: true,
        environmentId: this.environmentId,
        model: "claude-sonnet-4-6"
      },
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "OpenAI Codex",
        enabled: true,
        environmentId: this.environmentId,
        model: "gpt-5.4"
      },
      {
        instanceId: "pi",
        driver: "pi",
        displayName: "Pi Coding Agent",
        enabled: true,
        environmentId: this.environmentId,
        model: "anthropic/claude-sonnet-4-6"
      },
      {
        instanceId: "ollama",
        driver: "ollama",
        displayName: "Ollama Local",
        enabled: true,
        environmentId: this.environmentId,
        model: "llama3.2",
        baseUrl: "http://127.0.0.1:11434"
      }
    ];
    return Promise.all(
      defaults.map(
        (inst) => this.drivers.get(inst.driver).probe(inst, {
          environmentId: this.environmentId,
          environmentLabel: this.machineName
        })
      )
    );
  }
  buildWsUrl() {
    const parsed = new URL(this.serverUrl);
    const proto = parsed.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = new URL(`${proto}//${parsed.host}/ws/environment`);
    wsUrl.searchParams.set("token", this.token);
    wsUrl.searchParams.set("environmentId", this.environmentId);
    wsUrl.searchParams.set("hostname", this.machineName);
    wsUrl.searchParams.set("platform", os2.platform());
    wsUrl.searchParams.set("arch", os2.arch());
    return wsUrl.toString();
  }
  send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
  async start() {
    console.log("\n===========================================================");
    console.log("MuseClaw Environment Daemon (WebSocket RPC)");
    console.log(`\u4E3B\u673A: ${this.machineName} (${os2.platform()}-${os2.arch()})`);
    console.log(`\u7F51\u5173: ${this.serverUrl}`);
    console.log("===========================================================\n");
    await this.connect();
  }
  async connect() {
    if (!this.isRunning) return;
    const url = this.buildWsUrl();
    const ws = new WebSocket(url);
    this.socket = ws;
    ws.on("open", async () => {
      this.reconnectAttempt = 0;
      const snapshots = await this.probeAll();
      const readyNames = snapshots.filter((s) => s.installed).map((s) => `${s.driver}(${s.status})`).join(", ");
      console.log(`\u5DF2\u8FDE\u63A5\u81F3\u7F51\u5173 [${this.environmentId}]\uFF0C\u5DF2\u53D1\u73B0\u672C\u5730\u8FD0\u884C\u73AF\u5883: ${readyNames || "\u65E0"}`);
      this.send({
        jsonrpc: "2.0",
        id: `reg_${Date.now()}`,
        method: "env.register",
        params: {
          environmentId: this.environmentId,
          label: this.machineName,
          hostname: this.machineName,
          platform: os2.platform(),
          arch: os2.arch(),
          userId: this.token,
          snapshots
        }
      });
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (!msg.method) return;
      void this.handleRpcRequest(msg);
    });
    ws.on("close", () => {
      this.socket = null;
      if (!this.isRunning) return;
      const delayMs = Math.min(3e4, 1e3 * Math.pow(2, Math.min(this.reconnectAttempt++, 5)));
      console.log(`\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C${Math.round(delayMs / 1e3)}s \u540E\u81EA\u52A8\u91CD\u8FDE...`);
      setTimeout(() => void this.connect(), delayMs).unref();
    });
    ws.on("error", (err) => {
      console.error(`WebSocket \u5F02\u5E38: ${err.message}`);
    });
  }
  async handleRpcRequest(msg) {
    const { id, method, params } = msg;
    try {
      if (method === "env.probe") {
        const instance = params.instance;
        const driver = this.drivers.get(instance.driver);
        if (!driver) throw new Error(`\u672A\u77E5\u9A71\u52A8: ${instance.driver}`);
        const snapshot = await driver.probe(instance, {
          environmentId: this.environmentId,
          environmentLabel: this.machineName
        });
        if (id) this.send({ jsonrpc: "2.0", id, result: { snapshot } });
        return;
      }
      if (method === "env.turn.start") {
        const { turnId, ...turnParams } = params;
        const driver = this.drivers.get(turnParams.instance.driver);
        if (!driver) throw new Error(`\u672A\u77E5\u9A71\u52A8: ${turnParams.instance.driver}`);
        if (id) this.send({ jsonrpc: "2.0", id, result: { ok: true, turnId } });
        void (async () => {
          try {
            for await (const ev of driver.runTurn(turnParams)) {
              this.send({
                jsonrpc: "2.0",
                method: "env.turn.event",
                params: { turnId, event: ev }
              });
            }
          } catch (err) {
            this.send({
              jsonrpc: "2.0",
              method: "env.turn.event",
              params: {
                turnId,
                event: { type: "turn.failed", error: err?.message || String(err) }
              }
            });
          }
        })();
        return;
      }
      if (method === "env.turn.interrupt") {
        const sessionKey = String(params?.sessionKey || "");
        await Promise.all(Array.from(this.drivers.values()).map((d) => d.interruptTurn(sessionKey)));
        if (id) this.send({ jsonrpc: "2.0", id, result: { ok: true } });
        return;
      }
      if (method === "env.approval.respond") {
        const requestId = String(params?.requestId || "");
        const decision = params?.decision;
        let handled = false;
        for (const d of this.drivers.values()) {
          if (await d.respondApproval(requestId, decision)) {
            handled = true;
            break;
          }
        }
        if (id) this.send({ jsonrpc: "2.0", id, result: { ok: handled } });
        return;
      }
      if (method === "env.session.close") {
        const sessionKey = String(params?.sessionKey || "");
        await Promise.all(Array.from(this.drivers.values()).map((d) => d.closeSession(sessionKey)));
        if (id) this.send({ jsonrpc: "2.0", id, result: { ok: true } });
        return;
      }
      if (id) {
        this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (err) {
      if (id) {
        this.send({ jsonrpc: "2.0", id, error: { message: err?.message || String(err) } });
      }
    }
  }
  async stop() {
    this.isRunning = false;
    try {
      this.socket?.close();
    } catch {
    }
    await Promise.all(Array.from(this.drivers.values()).map((d) => d.disposeAll()));
  }
};
function parseCliArgs() {
  const args = process.argv.slice(2);
  const fileConfig = loadPersistentConfig();
  let serverUrl = process.env.MUSECLAW_SERVER_URL || fileConfig.serverUrl || "http://localhost:8799";
  let token = process.env.MUSECLAW_TOKEN || fileConfig.token || "default-mesh-token";
  let name = fileConfig.name || hostname();
  let action = "run";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--server" || arg === "-s") && args[i + 1]) serverUrl = args[++i];
    else if ((arg === "--token" || arg === "-t") && args[i + 1]) token = args[++i];
    else if ((arg === "--name" || arg === "-n") && args[i + 1]) name = args[++i];
    else if (arg === "--install-service" || arg === "--daemon") action = "install-service";
    else if (arg === "--uninstall-service") action = "uninstall-service";
    else if (arg === "--probe") action = "probe";
  }
  return { serverUrl, token, name, action };
}
var isEntryMain = process.argv[1] && (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("client.js"));
if (isEntryMain) {
  const cliConfig = parseCliArgs();
  if (cliConfig.action === "probe") {
    const daemon = new MuseClawEnvironmentDaemon(cliConfig);
    daemon.probeAll().then(async (snapshots) => {
      console.log(JSON.stringify(snapshots, null, 2));
      await daemon.stop();
      process.exit(0);
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else if (cliConfig.action === "install-service") {
    installService({ serverUrl: cliConfig.serverUrl, token: cliConfig.token, name: cliConfig.name });
    process.exit(0);
  } else if (cliConfig.action === "uninstall-service") {
    uninstallService();
    process.exit(0);
  } else {
    savePersistentConfig({
      serverUrl: cliConfig.serverUrl,
      token: cliConfig.token,
      name: cliConfig.name
    });
    const daemon = new MuseClawEnvironmentDaemon(cliConfig);
    daemon.start().catch((err) => {
      console.error("Fatal daemon error:", err);
      process.exit(1);
    });
    process.on("SIGINT", () => {
      void daemon.stop().then(() => process.exit(0));
    });
  }
}
export {
  MuseClawEnvironmentDaemon
};
