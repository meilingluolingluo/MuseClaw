import fs from 'node:fs';
import path from 'node:path';
import type { LLMMessage, LLMMessageContent, LLMContentPart } from './loop.ts';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB 单图上限
export const REMOVED_IMAGE_NOTE = ' (历史附图已自动降维归档以优化上下文窗口)';

const NO_IMAGES_REGEX = /image|vision|multimodal|multi-modal|image_url|input_image|content must be a string|invalid type for 'messages\[\d+\]\.content'|unsupported content|does not support|not supported/i;

/**
 * 判断文件名或路径是否为支持的图片格式
 */
export function isImage(filePathOrName: string): boolean {
  if (!filePathOrName) return false;
  const ext = path.extname(filePathOrName).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * 校验 API 报错信息是否为端点明确拒绝多模态图片输入
 */
export function saysNoImages(message: string): boolean {
  return NO_IMAGES_REGEX.test(message || '');
}

/**
 * 依据模型 ID/名称判断其是否具备原生多模态视觉处理能力
 */
export function modelTakesImages(model: string): boolean | null {
  const name = (model || '').toLowerCase().split('/').pop()?.trim() || '';
  if (!name) return null;

  // DeepSeek 体系：纯文本与视觉模型区分
  if (name.includes('deepseek')) {
    if (name === 'deepseek-flash' || name.startsWith('deepseek-v4-flash') || name.includes('vision') || name.includes('v4.1') || name.includes('ocr')) {
      return true;
    }
    if (name === 'deepseek-chat' || name === 'deepseek-reasoner' || name.includes('deepseek-v4-pro') || name.includes('deepseek-v3') || name.includes('deepseek-r1')) {
      return false;
    }
    return null;
  }

  // 通义千问 Qwen 视觉系列
  if (name.includes('qwen')) {
    if (name.includes('-vl') || name.startsWith('qwen3.8') || name.includes('vl-')) {
      return true;
    }
    return false;
  }

  // OpenAI 系列
  if (name.includes('gpt-4o') || name.includes('gpt-4.5') || name.includes('gpt-4-turbo') || name.startsWith('o1') || name.startsWith('o3')) {
    return true;
  }
  if (name.includes('gpt-3.5') || name.includes('gpt-4-0613') || name.includes('gpt-4-0314')) {
    return false;
  }

  // Claude 系列
  if (name.includes('claude-3') || name.includes('claude-sonnet') || name.includes('claude-opus')) {
    return true;
  }

  // Gemini 系列
  if (name.includes('gemini')) {
    return true;
  }

  return null;
}

/**
 * 读取本地图片文件并编码为标准 Data URL
 */
export function imageToDataUrl(filePath: string, maxBytes: number = MAX_IMAGE_BYTES): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes || stat.size === 0) return null;

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff'
    };
    const mime = mimeMap[ext] || 'image/jpeg';
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * 组装多模态消息体（支持文本 + 多图片 content parts）
 */
export function buildMultimodalContent(
  text: string,
  imagePaths: string[],
  modelTakesVision: boolean
): LLMMessageContent {
  if (!imagePaths || imagePaths.length === 0) {
    return text || '';
  }

  if (modelTakesVision) {
    const parts: LLMContentPart[] = [];
    const validText = text.trim() || '请查看附图';
    parts.push({ type: 'text', text: validText });

    const failedImages: string[] = [];
    for (const imgPath of imagePaths) {
      const dataUrl = imageToDataUrl(imgPath);
      if (dataUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: dataUrl, detail: 'auto' }
        });
      } else {
        failedImages.push(path.basename(imgPath));
      }
    }

    if (failedImages.length > 0) {
      parts.push({
        type: 'text',
        text: `\n[提示: 附件图片 ${failedImages.join(', ')} 由于过大或读取失败未直接载入视觉通道，文件已完整保存在沙箱工作区]`
      });
    }

    return parts;
  }

  // 纯文本降级模式
  const filenames = imagePaths.map((p) => path.basename(p));
  const fallbackNote = `\n\n[附图提示: 用户上传了 ${filenames.length} 张图片 (${filenames.join(', ')})，文件保存在工作区。当前模型为纯文本模式无直接视觉通道，如需读取图中内容请调用 ocr_document 工具识别。]`;
  return `${text || ''}${fallbackNote}`.trim();
}

/**
 * 在多轮会话中保留最新的 keepCount 轮图片，较早的图片替换为轻量占位说明，防止 Token 爆炸
 */
export function keepNewestImages(messages: LLMMessage[], keepCount = 2): LLMMessage[] {
  if (keepCount <= 0) return [...messages];

  // 找出所有包含 image_url 的 user 消息索引
  const withImageIndices: number[] = [];
  messages.forEach((msg, idx) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const hasImage = msg.content.some((p) => p.type === 'image_url');
      if (hasImage) withImageIndices.push(idx);
    }
  });

  if (withImageIndices.length <= keepCount) {
    return [...messages];
  }

  const dropIndices = new Set(withImageIndices.slice(0, withImageIndices.length - keepCount));

  return messages.map((msg, idx) => {
    if (!dropIndices.has(idx) || !Array.isArray(msg.content)) {
      return msg;
    }

    // 剔除 image_url，保留文本并追加占位标记
    const textParts = msg.content
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text);
    const flattenedText = textParts.join('\n') + REMOVED_IMAGE_NOTE;

    return {
      ...msg,
      content: flattenedText
    };
  });
}

/**
 * 将整组消息彻底降维为纯文本（用于端点拒绝多模态时的降级重试）
 */
export function withoutImages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const textParts = msg.content
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text);
    const imageCount = msg.content.filter((p) => p.type === 'image_url').length;
    const note = imageCount > 0 ? ` [包含 ${imageCount} 张图片附件]` : '';

    return {
      ...msg,
      content: (textParts.join('\n') + note).trim()
    };
  });
}
