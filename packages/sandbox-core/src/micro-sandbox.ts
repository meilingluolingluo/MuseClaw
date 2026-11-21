import fs from 'node:fs';
import path from 'node:path';
import {
  BaseEnvironment,
  BwrapEnvironment,
  LocalEnvironment,
  createExecutionEnvironment,
  commandNeedsNetwork,
  NETWORK_PROGRAMS,
  SAFE_BASE_ENV,
  scrubEnvironmentVariables,
  isSafeWritePath,
  isSafeReadPath,
  type ExecutionOptions,
  type ExecutionResult,
  type EnvironmentStatus,
  type EnvironmentConfig
} from './environment.ts';

export {
  BaseEnvironment,
  BwrapEnvironment,
  LocalEnvironment,
  createExecutionEnvironment,
  commandNeedsNetwork,
  NETWORK_PROGRAMS,
  SAFE_BASE_ENV,
  scrubEnvironmentVariables,
  isSafeWritePath,
  isSafeReadPath,
  type ExecutionOptions,
  type ExecutionResult,
  type EnvironmentStatus,
  type EnvironmentConfig
};

export type MicroSandboxConfig = EnvironmentConfig;
export type MicroSandboxExecutionResult = ExecutionResult;
export type MicroSandboxStatus = EnvironmentStatus;

/**
 * 剥离宿主敏感环境变量，仅保留安全基础白名单
 */
export function getSanitizedEnv(customEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return scrubEnvironmentVariables(customEnv);
}

/**
 * Bubblewrap 微沙箱隔离引擎
 * 继承统一环境抽象层 BaseEnvironment 与 BwrapEnvironment，向上暴露统一接口，对下实施内核级隔离与安全防护
 */
export class MicroSandbox extends BwrapEnvironment {
  constructor(config: MicroSandboxConfig = {}) {
    super(config);
  }
}
