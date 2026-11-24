/**
 * MuseClaw Skill Sidecar Telemetry & Managed Env Store
 * 将技能调用频次、生命周期状态及托管环境变量独立落盘存储，避免污染 SKILL.md 正文
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillLifecycleState, SkillSource, SkillUsageStats } from '@museclaw/protocol';

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

interface UsageRecord {
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt?: number;
  lastViewedAt?: number;
  pinned?: boolean;
  lifecycleState?: SkillLifecycleState;
  firstSeenAt?: number;
}

interface UsageFile {
  skills: Record<string, UsageRecord>;
}

interface ManagedEnvFile {
  vars: Record<string, string>;
  updatedAt: number;
}

export function maskEnvValue(value: string): string {
  const clean = String(value || '');
  if (!clean) return '';
  if (clean.length <= 4) return '****';
  return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
}

export class SkillTelemetryAndEnvStore {
  private usageFilePath: string;
  private envFilePath: string;
  private usageMap: Record<string, UsageRecord> = {};
  private managedEnv: Record<string, string> = {};
  private managedKeysInjected = new Set<string>();

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.usageFilePath = path.join(dataDir, '.usage.json');
    this.envFilePath = path.join(dataDir, '.env-store.json');
    this.loadUsage();
    this.loadManagedEnv();
  }

  private loadUsage() {
    if (!fs.existsSync(this.usageFilePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.usageFilePath, 'utf-8')) as UsageFile;
      if (parsed && typeof parsed.skills === 'object' && parsed.skills) {
        this.usageMap = parsed.skills;
      }
    } catch {
      this.usageMap = {};
    }
  }

  private saveUsage() {
    try {
      const payload: UsageFile = { skills: this.usageMap };
      fs.writeFileSync(this.usageFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[SkillTelemetry] 保存遥测文件失败:', err);
    }
  }

  private loadManagedEnv() {
    if (!fs.existsSync(this.envFilePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.envFilePath, 'utf-8')) as ManagedEnvFile;
      if (parsed && typeof parsed.vars === 'object' && parsed.vars) {
        this.managedEnv = { ...parsed.vars };
        for (const [k, v] of Object.entries(this.managedEnv)) {
          if (v && !process.env[k]) {
            process.env[k] = v;
            this.managedKeysInjected.add(k);
          }
        }
      }
    } catch {
      this.managedEnv = {};
    }
  }

  private saveManagedEnv() {
    try {
      const payload: ManagedEnvFile = {
        vars: this.managedEnv,
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.envFilePath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      console.warn('[SkillEnvStore] 保存环境变量配置失败:', err);
    }
  }

  private ensureRecord(name: string): UsageRecord {
    const key = name.trim().toLowerCase();
    if (!this.usageMap[key]) {
      this.usageMap[key] = {
        useCount: 0,
        viewCount: 0,
        patchCount: 0,
        firstSeenAt: Date.now(),
        lifecycleState: 'active'
      };
    }
    return this.usageMap[key];
  }

  public computeLifecycleState(record: UsageRecord, source: SkillSource): SkillLifecycleState {
    if (record.lifecycleState === 'archived') return 'archived';
    if (record.pinned || source === 'builtin') return 'active';
    const lastActivity = record.lastUsedAt || record.lastViewedAt || record.firstSeenAt;
    if (lastActivity && Date.now() - lastActivity > STALE_THRESHOLD_MS) {
      return 'stale';
    }
    return 'active';
  }

  public getUsage(name: string, source: SkillSource = 'custom'): SkillUsageStats {
    const key = name.trim().toLowerCase();
    const record = this.usageMap[key] || {
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      lifecycleState: 'active' as SkillLifecycleState
    };
    return {
      useCount: record.useCount || 0,
      viewCount: record.viewCount || 0,
      patchCount: record.patchCount || 0,
      lastUsedAt: record.lastUsedAt,
      pinned: Boolean(record.pinned),
      lifecycleState: this.computeLifecycleState(record, source)
    };
  }

  public recordUse(name: string) {
    const rec = this.ensureRecord(name);
    rec.useCount = (rec.useCount || 0) + 1;
    rec.lastUsedAt = Date.now();
    if (rec.lifecycleState === 'stale') rec.lifecycleState = 'active';
    this.saveUsage();
  }

  public recordView(name: string) {
    const rec = this.ensureRecord(name);
    rec.viewCount = (rec.viewCount || 0) + 1;
    rec.lastViewedAt = Date.now();
    this.saveUsage();
  }

  public recordPatch(name: string) {
    const rec = this.ensureRecord(name);
    rec.patchCount = (rec.patchCount || 0) + 1;
    rec.lastViewedAt = Date.now();
    this.saveUsage();
  }

  public setPinned(name: string, pinned: boolean) {
    const rec = this.ensureRecord(name);
    rec.pinned = pinned;
    if (pinned && rec.lifecycleState === 'stale') {
      rec.lifecycleState = 'active';
    }
    this.saveUsage();
  }

  public setLifecycleState(name: string, state: SkillLifecycleState) {
    const rec = this.ensureRecord(name);
    rec.lifecycleState = state;
    this.saveUsage();
  }

  public removeUsage(name: string) {
    const key = name.trim().toLowerCase();
    if (this.usageMap[key]) {
      delete this.usageMap[key];
      this.saveUsage();
    }
  }

  public resolveEnv(key: string): { value?: string; source?: 'process' | 'managed' } {
    if (Object.prototype.hasOwnProperty.call(this.managedEnv, key) && this.managedEnv[key]) {
      return { value: this.managedEnv[key], source: 'managed' };
    }
    if (process.env[key]) {
      return { value: process.env[key], source: 'process' };
    }
    return {};
  }

  public getManagedEnvKeys(): Record<string, { configured: boolean; source?: 'process' | 'managed'; maskedValue?: string }> {
    const result: Record<string, { configured: boolean; source?: 'process' | 'managed'; maskedValue?: string }> = {};
    for (const [k, v] of Object.entries(this.managedEnv)) {
      if (v) {
        result[k] = {
          configured: true,
          source: 'managed',
          maskedValue: maskEnvValue(v)
        };
      }
    }
    return result;
  }

  public setManagedEnv(entries: Record<string, string | null>): void {
    for (const [rawKey, rawVal] of Object.entries(entries)) {
      const key = rawKey.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (rawVal === null || rawVal.trim() === '') {
        delete this.managedEnv[key];
        if (this.managedKeysInjected.has(key)) {
          delete process.env[key];
          this.managedKeysInjected.delete(key);
        }
      } else {
        const cleanVal = rawVal.trim();
        this.managedEnv[key] = cleanVal;
        process.env[key] = cleanVal;
        this.managedKeysInjected.add(key);
      }
    }
    this.saveManagedEnv();
  }
}
