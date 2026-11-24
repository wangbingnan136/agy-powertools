import { isAbsolute, join, relative } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOmniGateway, resolveSafePreviewPath } from './omni-gateway.mjs';
import { exportSanitizedSettings, importSanitizedSettings } from './settings.mjs';

const routes = new Set(['settings.export', 'settings.import', 'chatFolders.get', 'chatFolders.save', 'diff.inline']);
const importKeys = ['multiAccount', 'autoSwitchAccount', 'sshSyncAuth', 'thoughtTranslate', 'translateSessionTitles', 'thoughtCustomPrompt'];

export function createPrismService({ settings, dataDir, workspaceOf }) {
  const files = createOmniGateway(dataDir);

  return {
    handles: method => routes.has(method),
    async request(payload, { remoteWindow = false } = {}) {
      const opts = settings.get();
      if (!opts.enabled) throw new Error('Powertools 已关闭');
      switch (payload.method) {
        case 'settings.export': {
          const bundle = exportSanitizedSettings(opts);
          for (const key of importKeys) delete bundle.settings[key];
          return { bundle };
        }
        case 'settings.import': {
          const patch = importSanitizedSettings(payload.bundle, opts);
          for (const key of importKeys) delete patch[key];
          if (!Object.keys(patch).length) throw new Error('没有可以导入的设置');
          return { patch };
        }
        case 'chatFolders.get':
        case 'chatFolders.save':
          if (!opts.chatModeBeta) throw new Error('Chat 模式未开启');
          return payload.method === 'chatFolders.get' ? files.chatFoldersGet() : files.chatFoldersSave(payload);
        case 'diff.inline': {
          if (!opts.inlineStepDiff || remoteWindow) throw new Error('当前窗口不支持行内差异');
          const { conversationId, path } = payload;
          if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(conversationId) || typeof path !== 'string' || !path || path.length > 4096) throw new Error('会话或文件路径无效');
          const workspace = workspaceOf(conversationId);
          if (typeof workspace !== 'string' || !workspace.startsWith('file:///')) throw new Error('未找到本地工作区');
          const rootPath = fileURLToPath(workspace);
          const root = realpathSync(rootPath);
          if (root !== rootPath && root !== rootPath.replace(/[\\/]$/, '')) throw new Error('不支持符号链接工作区');
          if (!lstatSync(join(root, '.git')).isDirectory()) throw new Error('行内差异需要普通 Git 仓库');
          const file = resolveSafePreviewPath(path.startsWith('file:') || isAbsolute(path) ? path : join(root, path));
          const rel = relative(root, file.realPath);
          if (!rel || rel === '..' || isAbsolute(rel) || rel.split(/[\\/]/).some(part => /^\.\.?$|^\.git$/i.test(part))) throw new Error('文件路径越出工作区');
          return files.inlineDiff({ workspaceUri: root, path: rel, safeRead: true });
        }
        default: throw new Error('不支持的操作');
      }
    }
  };
}
