import fs from 'node:fs';
import path from 'node:path';

export type AttachmentKind = 'image' | 'pdf' | 'data' | 'text' | 'other';

export interface AttachmentMetadata {
  path: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  mime: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.xlsx', '.xls', '.parquet', '.db', '.sqlite']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.rtf', '.html', '.htm', '.xml', '.yaml', '.yml',
  '.toml', '.py', '.js', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.css', '.scss',
  '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp'
]);

export class Attachment implements AttachmentMetadata {
  public path: string;
  public name: string;
  public size: number;
  public kind: AttachmentKind;
  public mime: string;

  constructor(meta: AttachmentMetadata) {
    this.path = meta.path;
    this.name = meta.name;
    this.size = meta.size;
    this.kind = meta.kind;
    this.mime = meta.mime;
  }

  public static kindOf(nameOrPath: string, mime?: string): AttachmentKind {
    if (mime) {
      const lowerMime = mime.toLowerCase();
      if (lowerMime.startsWith('image/')) return 'image';
      if (lowerMime === 'application/pdf') return 'pdf';
      if (lowerMime.includes('json') || lowerMime.includes('csv') || lowerMime.includes('spreadsheet')) return 'data';
      if (lowerMime.startsWith('text/')) return 'text';
    }

    const ext = path.extname(nameOrPath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (PDF_EXTENSIONS.has(ext)) return 'pdf';
    if (DATA_EXTENSIONS.has(ext)) return 'data';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return 'other';
  }

  public static formatSize(sizeInBytes: number): string {
    if (sizeInBytes < 1024) return `${sizeInBytes} B`;
    if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  public describe(): string {
    const readableSize = Attachment.formatSize(this.size);
    const kindLabel: Record<AttachmentKind, string> = {
      image: 'image',
      pdf: 'PDF',
      data: 'data file',
      text: 'text document',
      other: this.mime || 'file'
    };
    return `${kindLabel[this.kind] || 'file'}, ${readableSize}`;
  }

  public static fromFile(filePath: string, displayName?: string): Attachment {
    const filename = displayName || path.basename(filePath);
    let size = 0;
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        size = stat.size;
      }
    } catch {
      // 容错处理未落在实际磁盘上的路径
    }
    const kind = Attachment.kindOf(filename);
    const mime = kind === 'image'
      ? `image/${path.extname(filename).replace('.', '') || 'png'}`
      : kind === 'pdf'
        ? 'application/pdf'
        : 'application/octet-stream';

    return new Attachment({
      path: filePath,
      name: filename,
      size,
      kind,
      mime
    });
  }
}

/**
 * 格式化提示词中的附件说明列表，引导模型按需读取或识别
 */
export function formatAttachmentNote(attachments: Attachment[], modelTakesImages = false): string {
  if (!attachments || attachments.length === 0) return '';

  const lines = attachments.map((a) => `- ${a.path} (${a.describe()})`);
  let note = `[Attached files]\n${lines.join('\n')}`;

  const hasNonImage = attachments.some((a) => a.kind !== 'image');
  const hasImages = attachments.some((a) => a.kind === 'image');

  if (hasNonImage) {
    note += '\n* 非图片文档与数据文件请使用 read_file 工具读取，或使用 ocr_document 解析复杂 PDF/Word/PPT。';
  }

  if (hasImages) {
    if (modelTakesImages) {
      note += '\n* 图片已通过视觉通道直接呈现给你。';
    } else {
      note += '\n* 当前接入的模型为纯文本模式（无直接视觉像素通道）。请勿盲目猜测图片内容；如需读取图片、截图中的文字与数据，请直接调用 ocr_document 工具进行高精度图文识别。';
    }
  }

  return note;
}
